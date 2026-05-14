/**
 * sync-attach flush-before-pull sequencing test (Bout BB).
 *
 * Pre-Bout-BB, `attachSyncEngine` fired pull-on-activate and flush-on-attach as
 * two separate fire-and-forget paths. Both then raced for the engine's shared
 * `inFlight` lock. In practice the pull always won (its `pullNow()` is
 * synchronous through the inFlight assignment, while flush awaits two folder
 * reads first), so `flushPendingOnAttach`'s `pushOnce()` saw `inFlight` set
 * and returned the pull's promise. The visible symptom: result.pushed.*
 * counts came back zero, no "synced N pending change(s) from previous session"
 * toast fired, and the stranded edits never reached the server until the next
 * user-driven write re-armed the autosave debounce.
 *
 * Fix: sequence flush BEFORE pull-on-activate via a single async IIFE inside
 * attachSyncEngine. Flush completes (release inFlight) before pull starts.
 *
 * The pre-fix invocation order can be observed via spies installed after
 * `attachSyncEngine` returns. Because pre-fix pullNow ran SYNCHRONOUSLY at
 * the line-105 fire-and-forget call site (before any await), the real method
 * fired before our spy was installed, and pullSpy.toHaveBeenCalled() returned
 * false. Post-fix, the IIFE awaits flush first, so by the time pullNow is
 * called the spy has already been swapped in. That asymmetry makes the test
 * fail naturally without the fix.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachSyncEngine,
  detachSyncEngine,
  getCurrentSyncEngine,
} from '../../src/sync/sync-attach';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin, setSyncPullOnActivate } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry } from '../../src/core/types';

function makeEntry(): WorldRegistryEntry {
  return {
    id: 'w1',
    name: 'Test World',
    state: 'api-linked',
    api: { world_id: 'srv-1', api_key: 'k1' },
    folder: { handle_key: 'vault-1', folder_name: 'test-world' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

const noopResult = {
  pushed: { creates: 0, updates: 0, deletes: 0 },
  pulled: { creates: 0, updates: 0, deletes: 0 },
  conflicts: [],
  failures: [],
};

async function flushMicrotasks(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

beforeEach(() => {
  detachSyncEngine();
  patchSlice(
    'registry',
    setSyncPullOnActivate(setPin(defaultRegistry(), '1234'), true)
  );
});

afterEach(() => {
  detachSyncEngine();
  vi.restoreAllMocks();
});

describe('sync-attach: flush runs before pull-on-activate (Bout BB)', () => {
  it('calls engine.pushOnce before engine.pullNow when pending writes + pull-on-activate are both present', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    // Pending element — flush will fire pushOnce iff it isn't starved by pull.
    await folder.createElement('character', { name: 'Pending' });

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;

    // Mock both methods AFTER attach. Post-fix, both invocations happen inside
    // the async IIFE which only reaches them after an await, so the spies see
    // both. Pre-fix, pullNow fires SYNCHRONOUSLY at line 105 before any spy is
    // installed, so pullSpy.toHaveBeenCalled() returns false and the test fails
    // — exactly the regression signature we want this test to catch.
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);
    const pullSpy = vi.spyOn(engine, 'pullNow').mockResolvedValue(noopResult);

    await flushMicrotasks();

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pullSpy).toHaveBeenCalledTimes(1);

    const pushOrder = pushSpy.mock.invocationCallOrder[0];
    const pullOrder = pullSpy.mock.invocationCallOrder[0];
    expect(pushOrder).toBeLessThan(pullOrder);
  });

  it('still pulls when pull-on-activate is enabled and the folder has no pending writes', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    // No pending element — flush should no-op (no pushOnce), but pull-on-activate
    // should still fire.

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;

    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);
    const pullSpy = vi.spyOn(engine, 'pullNow').mockResolvedValue(noopResult);

    await flushMicrotasks();

    expect(pushSpy).not.toHaveBeenCalled();
    expect(pullSpy).toHaveBeenCalledTimes(1);
  });

  it('skips both flush and pull when pause-all is set, even with pending writes', async () => {
    patchSlice(
      'registry',
      {
        ...setSyncPullOnActivate(setPin(defaultRegistry(), '1234'), true),
        sync_pause_all: true,
      }
    );
    const folder = new MockFolderStore();
    await folder.open(null);
    await folder.createElement('character', { name: 'Pending' });

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;

    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);
    const pullSpy = vi.spyOn(engine, 'pullNow').mockResolvedValue(noopResult);

    await flushMicrotasks();

    expect(pushSpy).not.toHaveBeenCalled();
    expect(pullSpy).not.toHaveBeenCalled();
  });
});
