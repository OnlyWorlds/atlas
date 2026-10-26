/**
 * SyncEngine resume() last_sync_at preservation (Bout BB / M7 fix).
 *
 * Pre-fix, `resume()` unconditionally set state to `{kind:'idle', last_sync_at:
 * null}` — even if a prior sync round had stamped a fresh `last_sync_at`. The
 * pill's "synced X min ago" tooltip would briefly reset to "never synced" the
 * moment the user toggled stay-offline. Cosmetic but smoke-observable since
 * publishSyncState fires on every state transition.
 *
 * Fix: engine tracks the most recent successful `last_sync_at` in a private
 * field; `resume()` restores it. The push round that fires right after resume
 * will overwrite with a fresher timestamp once it completes; but the brief
 * idle window between `resume()` setState and runPushOnly's first setState
 * now carries the preserved value instead of null.
 *
 * Observation strategy: `resume()` synchronously sets idle, then synchronously
 * calls pushOnce() which (async runPushOnly) immediately sets syncing before
 * its first await. So `engine.getState()` AFTER resume returns shows syncing.
 * To verify the brief idle-window state, we capture the full state sequence
 * via the onStateChange callback.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { SyncEngineState } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

// One fork for every file: fake timers must not outlive this one.
afterEach(() => { vi.useRealTimers(); });

beforeEach(async () => {
  vi.useFakeTimers();
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('SyncEngine.resume(): preserves last_sync_at across pause/resume', () => {
  it('emits idle with preserved last_sync_at when resuming after a successful sync', async () => {
    const states: SyncEngineState[] = [];
    const engine = new SyncEngine({
      folder,
      client,
      onStateChange: (s) => states.push({ ...s }),
    });
    engine.setDebounceMs(100);

    // Run an initial push so the engine captures a last_sync_at.
    await folder.createElement('character', { name: 'Alice' });
    await engine.pushOnce();
    // Last idle in the sequence should have last_sync_at stamped.
    const lastIdleBeforePause = [...states].reverse().find((s) => s.kind === 'idle');
    expect(lastIdleBeforePause?.kind).toBe('idle');
    if (lastIdleBeforePause?.kind !== 'idle') throw new Error('unreachable');
    const captured = lastIdleBeforePause.last_sync_at;
    expect(captured).not.toBeNull();

    states.length = 0; // reset capture

    // Pause + resume.
    engine.pause();
    engine.resume();
    // resume() synchronously emits: idle(preserved last_sync_at) → then
    // pushOnce kicks off runPushOnly which synchronously emits syncing.
    // Both transitions are in the sync-call window, captured before the await
    // microtask boundary.

    // First emit: paused (from engine.pause()).
    expect(states[0].kind).toBe('paused');
    // Second emit: idle with preserved last_sync_at (from resume's setState).
    expect(states[1].kind).toBe('idle');
    if (states[1].kind !== 'idle') throw new Error('unreachable');
    expect(states[1].last_sync_at).toBe(captured);
    // Third emit: syncing (from post-resume runPushOnly first line).
    expect(states[2].kind).toBe('syncing');
  });

  it('emits idle with null last_sync_at when resuming with no prior successful sync', () => {
    const states: SyncEngineState[] = [];
    const engine = new SyncEngine({
      folder,
      client,
      onStateChange: (s) => states.push({ ...s }),
    });

    // No sync run → no captured timestamp.
    engine.pause();
    engine.resume();

    expect(states[0].kind).toBe('paused');
    expect(states[1].kind).toBe('idle');
    if (states[1].kind !== 'idle') throw new Error('unreachable');
    expect(states[1].last_sync_at).toBeNull();
  });

});
