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
});
