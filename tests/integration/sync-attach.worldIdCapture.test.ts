/**
 * sync-attach worldId-capture race regression test (M1).
 *
 * Under `local-wins`, a pull-conflict triggers a deferred `pushOnce()` via
 * `setTimeout(0)` so the local version actually propagates server-side without
 * waiting for the 5s autosave debounce. The defer escapes the engine's
 * `inFlight` lock; without it, calling pushOnce() synchronously inside the
 * pull's onSyncResult callback would silently return the in-flight PULL
 * promise (see SYNC_NOTES "In-flight promise dedup gotcha").
 *
 * The race: if the user switches worlds between the setTimeout schedule and
 * its firing (sub-millisecond, but possible), `currentEngine` would refer to
 * the NEW world's engine. Without the guard, the push would land on the wrong
 * world — and worse, the original conflict's local version would stay
 * un-converged.
 *
 * The fix (sync-attach.ts:278-293): capture `currentWorldId` at schedule time,
 * compare at fire time, bail with a console log if mismatched.
 *
 * This test exercises the bail-out path via the __test_emitConflictToasts
 * seam — no MSW needed.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachSyncEngine,
  detachSyncEngine,
  getCurrentSyncEngine,
  getCurrentSyncWorldId,
  __test_emitConflictToasts,
} from '../../src/sync/sync-attach';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry, SyncResult, Conflict } from '../../src/core/types';

function makeEntry(id: string, name: string): WorldRegistryEntry {
  return {
    id,
    name,
    state: 'api-linked',
    api: { world_id: `srv-${id}`, api_key: `key-${id}` },
    folder: { handle_key: `vault-${id}`, folder_name: name },
    created_at: '2026-01-01T00:00:00Z',
  };
}

function fakeConflictResult(): SyncResult {
  const conflict: Conflict = {
    element_id: 'c1',
    type: 'character',
    detected_at: '2026-01-01T00:00:00.000Z',
    local_updated_at: '2026-01-01T00:00:01.000Z',
    server_updated_at: '2026-01-01T00:00:02.000Z',
    fields: ['description'],
  };
  return {
    pushed: { creates: 0, updates: 0, deletes: 0 },
    pulled: { creates: 0, updates: 0, deletes: 0 },
    conflicts: [conflict],
    failures: [],
  };
}

/**
 * The round ran under Local wins, as the engine says it did (B12 Q1): right
 * after attach the engine is still settling (pause-and-review until keel's
 * roster answers), and a conflict met then is held, never pushed, so these
 * bail-outs would pass for the wrong reason.
 */
const underLocalWins = () => ({ worldId: getCurrentSyncWorldId(), current: true, policy: 'local-wins' as const });

beforeEach(() => {
  vi.useFakeTimers();
  detachSyncEngine();
  patchSlice('registry', setPin(defaultRegistry(), '1234'));
});

afterEach(() => {
  vi.useRealTimers();
  detachSyncEngine();
});

describe('sync-attach pull-conflict defer guards against world-switch race', () => {
  it('fires pushOnce on the same world when no switch happens', async () => {
    const folderA = new MockFolderStore();
    await folderA.open(null);
    attachSyncEngine(makeEntry('w1', 'A'), folderA);
    const engineA = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engineA, 'pushOnce').mockResolvedValue({
      pushed: { creates: 0, updates: 0, deletes: 0 },
      pulled: { creates: 0, updates: 0, deletes: 0 },
      conflicts: [],
      failures: [],
    });

    __test_emitConflictToasts('pull', fakeConflictResult(), underLocalWins());
    // Before timer fires, no push.
    expect(pushSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    // Flush microtasks (the setTimeout body awaits the spy).
    await Promise.resolve();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('bails out when the world has switched before the defer fires', async () => {
    const folderA = new MockFolderStore();
    await folderA.open(null);
    attachSyncEngine(makeEntry('w1', 'A'), folderA);
    const engineA = getCurrentSyncEngine()!;
    const pushSpyA = vi.spyOn(engineA, 'pushOnce').mockResolvedValue({
      pushed: { creates: 0, updates: 0, deletes: 0 },
      pulled: { creates: 0, updates: 0, deletes: 0 },
      conflicts: [],
      failures: [],
    });

    // Schedule the deferred push on world A.
    __test_emitConflictToasts('pull', fakeConflictResult(), underLocalWins());

    // User switches to world B before the timer fires.
    const folderB = new MockFolderStore();
    await folderB.open(null);
    attachSyncEngine(makeEntry('w2', 'B'), folderB);
    const engineB = getCurrentSyncEngine()!;
    const pushSpyB = vi.spyOn(engineB, 'pushOnce').mockResolvedValue({
      pushed: { creates: 0, updates: 0, deletes: 0 },
      pulled: { creates: 0, updates: 0, deletes: 0 },
      conflicts: [],
      failures: [],
    });

    vi.advanceTimersByTime(0);
    await Promise.resolve();

    // Neither engine should be pushed: A is no longer current (would land on
    // the wrong world), B never had the conflict (would propagate the wrong
    // intent).
    expect(pushSpyA).not.toHaveBeenCalled();
    expect(pushSpyB).not.toHaveBeenCalled();
  });

  it('bails out when the world has been fully detached', async () => {
    const folderA = new MockFolderStore();
    await folderA.open(null);
    attachSyncEngine(makeEntry('w1', 'A'), folderA);
    const engineA = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engineA, 'pushOnce').mockResolvedValue({
      pushed: { creates: 0, updates: 0, deletes: 0 },
      pulled: { creates: 0, updates: 0, deletes: 0 },
      conflicts: [],
      failures: [],
    });

    __test_emitConflictToasts('pull', fakeConflictResult(), underLocalWins());
    detachSyncEngine();

    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does not schedule a deferred push for push-phase conflicts', async () => {
    const folderA = new MockFolderStore();
    await folderA.open(null);
    attachSyncEngine(makeEntry('w1', 'A'), folderA);
    const engineA = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engineA, 'pushOnce').mockResolvedValue({
      pushed: { creates: 0, updates: 0, deletes: 0 },
      pulled: { creates: 0, updates: 0, deletes: 0 },
      conflicts: [],
      failures: [],
    });

    // Push-phase conflicts under local-wins are already resolved (server was
    // overwritten by the push); no follow-up needed.
    __test_emitConflictToasts('push', fakeConflictResult(), underLocalWins());

    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
