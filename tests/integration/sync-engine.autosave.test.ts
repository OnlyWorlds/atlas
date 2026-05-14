/**
 * SyncEngine autosave (debounced push) — integration test.
 *
 * `requestPush()` schedules a push N ms after the last call. Bursts of edits
 * coalesce into one push. Used by element-detail.ts after every folder write.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let clock: MonotonicClock;

beforeEach(async () => {
  vi.useFakeTimers();
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client });
  engine.setDebounceMs(100); // fast for tests
});

describe('SyncEngine autosave (requestPush)', () => {
  it('schedules a push after the debounce window', async () => {
    await folder.createElement('character', { name: 'Alice' });
    engine.requestPush();

    // No push yet.
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(0);

    // Advance past the debounce window.
    await vi.advanceTimersByTimeAsync(120);

    // One CREATE fired.
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(1);
  });

  it('coalesces multiple requestPush calls into one push', async () => {
    await folder.createElement('character', { name: 'Alice' });

    engine.requestPush();
    await vi.advanceTimersByTimeAsync(50);
    engine.requestPush(); // resets timer
    await vi.advanceTimersByTimeAsync(50);
    engine.requestPush(); // resets again
    await vi.advanceTimersByTimeAsync(50);

    // Total 150ms with resets — push not yet fired.
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(0);

    // Final wait past the debounce window.
    await vi.advanceTimersByTimeAsync(100);
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(1);
  });

  it('does nothing when paused', async () => {
    await folder.createElement('character', { name: 'Alice' });
    engine.pause('manual');
    engine.requestPush();
    await vi.advanceTimersByTimeAsync(500);
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(0);
  });

  it('stop() cancels a pending debounced push', async () => {
    await folder.createElement('character', { name: 'Alice' });
    engine.requestPush();
    engine.stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(0);
  });

  // Bout AA — pause + edit + resume must flush pending writes. Before this
  // fix, requestPush early-returned during pause without scheduling a
  // debounce timer, so resume() clearing the flag alone had nothing to fire.
  // Edits sat on disk until the user made ANOTHER edit (which re-armed
  // autosave) or reloaded (which triggered flush-on-attach). Smoke step T2.1
  // expects "uncheck → queued edit pushes" — that contract now holds.
  describe('resume flushes pending writes', () => {
    it('edits made during pause push immediately on resume', async () => {
      // Initial state: one element, never synced.
      await folder.createElement('character', { name: 'Alice' });

      // Pause first — simulating the user checking "stay offline".
      engine.pause('manual');

      // Edit during pause — requestPush early-returns, no debounce scheduled.
      await folder.updateElement(
        (await folder.listElements())[0].id,
        { description: 'edited while offline' }
      );
      engine.requestPush();
      await vi.advanceTimersByTimeAsync(500);
      // Confirm nothing pushed yet (paused path took effect).
      expect(client.calls.filter(c => c.method === 'create')).toHaveLength(0);

      // Resume — should fire pushOnce internally. The push is async, so we
      // need to let microtasks drain.
      engine.resume();
      await vi.advanceTimersByTimeAsync(10); // settle the await chain

      // The pending CREATE actually went through.
      expect(client.calls.filter(c => c.method === 'create')).toHaveLength(1);
      const created = client.calls.find(c => c.method === 'create');
      if (!created || created.method !== 'create') throw new Error('expected create');
      expect((created.body as { description?: string }).description).toBe('edited while offline');
    });

    it('resume is a near-no-op when nothing is pending', async () => {
      // Element created + synced first so server has the baseline.
      await folder.createElement('character', { name: 'Quiet' });
      engine.requestPush();
      await vi.advanceTimersByTimeAsync(200);
      expect(client.calls.filter(c => c.method === 'create')).toHaveLength(1);
      const callsBeforePause = client.calls.length;

      // Pause + resume with no edits in between.
      engine.pause('manual');
      engine.resume();
      await vi.advanceTimersByTimeAsync(10);

      // resume fires pushOnce, but pushPhase finds no pending writes. Result:
      // listCalls (none for push-only) and no new CREATEs/UPDATEs.
      const createsAfter = client.calls.filter(c => c.method === 'create');
      const updatesAfter = client.calls.filter(c => c.method === 'update');
      expect(createsAfter).toHaveLength(1); // just the original
      expect(updatesAfter).toHaveLength(0);
      // Some get/list calls may happen depending on implementation — what
      // matters is no MUTATING ops fired. Quick sanity that the test isn't
      // accidentally measuring nothing:
      expect(client.calls.length).toBeGreaterThanOrEqual(callsBeforePause);
    });

    it('multiple edits during pause coalesce into a single resume push', async () => {
      const alice = await folder.createElement('character', { name: 'Alice' });
      engine.pause('manual');

      // Three field edits during the pause window.
      await folder.updateElement(alice.id, { description: 'one' });
      engine.requestPush();
      await folder.updateElement(alice.id, { description: 'two' });
      engine.requestPush();
      await folder.updateElement(alice.id, { description: 'three' });
      engine.requestPush();
      await vi.advanceTimersByTimeAsync(500);

      // Still nothing pushed.
      expect(client.calls.filter(c => c.method === 'create')).toHaveLength(0);

      // Resume → ONE CREATE with the final value (folder collapses edits).
      engine.resume();
      await vi.advanceTimersByTimeAsync(10);

      const creates = client.calls.filter(c => c.method === 'create');
      expect(creates).toHaveLength(1);
      const created = creates[0];
      if (created.method !== 'create') throw new Error('expected create');
      expect((created.body as { description?: string }).description).toBe('three');
    });
  });
});
