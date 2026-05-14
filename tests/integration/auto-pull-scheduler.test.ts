/**
 * Auto-pull scheduler — integration tests against a faked engine via
 * sync-attach. Uses vitest fake timers + the test reconcile helper.
 *
 * Note: we drive the scheduler via `__test_reconcile()` rather than relying on
 * subscribe() ordering, because the production wiring calls reconcile inside
 * the subscribe() callback after every patchSlice. Tests focus on the
 * eligibility logic + interval lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __test_isRunning,
  __test_currentCadence,
  __test_reconcile,
  __test_stop,
  __test_lastPullAt,
  __test_maybeCatchUpOnVisible,
} from '../../src/sync/auto-pull-scheduler';
import { attachSyncEngine, detachSyncEngine } from '../../src/sync/sync-attach';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setSyncCadenceMs, setSyncPauseAll, setPin } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry } from '../../src/core/types';

function makeApiLinkedEntry(): WorldRegistryEntry {
  return {
    id: 'w1',
    name: 'Test World',
    state: 'api-linked',
    api: { world_id: 'srv-1', api_key: 'test-key' },
    folder: { handle_key: 'vault-1', folder_name: 'test-world' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

async function setupAttached(): Promise<MockFolderStore> {
  const folder = new MockFolderStore();
  await folder.open(null);
  attachSyncEngine(makeApiLinkedEntry(), folder);
  return folder;
}

beforeEach(() => {
  vi.useFakeTimers();
  __test_stop();
  detachSyncEngine();
  // Reset registry to a known baseline with PIN set so attach succeeds.
  patchSlice('registry', setPin(defaultRegistry(), '1234'));
});

afterEach(() => {
  vi.useRealTimers();
  __test_stop();
  detachSyncEngine();
});

describe('auto-pull scheduler', () => {
  it('does not schedule when cadence is null', async () => {
    await setupAttached();
    __test_reconcile();
    expect(__test_isRunning()).toBe(false);
  });

  it('does not schedule when cadence is 0', async () => {
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 0));
    __test_reconcile();
    expect(__test_isRunning()).toBe(false);
  });

  it('does not schedule when no engine is attached', () => {
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_isRunning()).toBe(false);
  });

  it('schedules when cadence is set and engine is attached', async () => {
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);
    expect(__test_currentCadence()).toBe(5000);
  });

  it('stops when global pause-all is set', async () => {
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);

    patchSlice('registry', setSyncPauseAll(getState().registry, true));
    __test_reconcile();
    expect(__test_isRunning()).toBe(false);
  });

  it('stops when engine is paused', async () => {
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);

    // Simulate engine entering paused state.
    patchSlice('sync', {
      byWorld: getState().sync.byWorld,
      activeSync: { kind: 'paused', reason: 'manual', pending_changes: 0 },
      activeConflictsCount: 0,
    });
    __test_reconcile();
    expect(__test_isRunning()).toBe(false);
  });

  // After Bout T (session 205), auth-failed rounds transition the engine to
  // `error` state (not `paused`). The scheduler must treat `error` the same
  // as `paused` for eligibility — otherwise it keeps ticking and burns
  // pullNow calls every cadence cycle against an engine that's internally
  // paused. The pull short-circuits inside the engine but the timer waste
  // accumulates until the user fixes the PIN.
  it('stops when engine is in error state (auth-failed round)', async () => {
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);

    // Simulate engine entering error state (as setAuthError does internally).
    patchSlice('sync', {
      byWorld: getState().sync.byWorld,
      activeSync: { kind: 'error', message: 'authentication failed', recoverable: true },
      activeConflictsCount: 0,
    });
    __test_reconcile();
    expect(__test_isRunning()).toBe(false);
  });

  it('restarts when cadence changes', async () => {
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_currentCadence()).toBe(5000);

    patchSlice('registry', setSyncCadenceMs(getState().registry, 15_000));
    __test_reconcile();
    expect(__test_currentCadence()).toBe(15_000);
    expect(__test_isRunning()).toBe(true);
  });

  it('keeps the interval running while the tab is hidden (cadence is continuous)', async () => {
    // Earlier versions clear()'d the interval on visibilitychange. That reset
    // the cadence countdown every time the user alt-tabbed to make a change on
    // the web app — they could never reach a full cadence cycle. The fix:
    // keep the timer running; the tick callback skips the pull when hidden.
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);
    expect(__test_currentCadence()).toBe(5000);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);
    expect(__test_currentCadence()).toBe(5000);
  });

  it('stops when engine detaches', async () => {
    await setupAttached();
    patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
    __test_reconcile();
    expect(__test_isRunning()).toBe(true);

    detachSyncEngine();
    __test_reconcile();
    expect(__test_isRunning()).toBe(false);
  });

  describe('catch-up on becoming visible', () => {
    beforeEach(() => {
      // Ensure tab is visible at test start; individual tests can flip it.
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    });

    it('does nothing when no cadence is running', () => {
      __test_maybeCatchUpOnVisible();
      // No assertion beyond "doesn't throw" — just verifies the early return
      // when activeCadenceMs is null.
      expect(__test_lastPullAt()).toBeNull();
    });

    it('does nothing while the tab is still hidden', async () => {
      await setupAttached();
      patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
      __test_reconcile();

      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      __test_maybeCatchUpOnVisible();
      expect(__test_lastPullAt()).toBeNull();
    });

    it('does nothing when sync is paused', async () => {
      await setupAttached();
      patchSlice('registry', setSyncCadenceMs(getState().registry, 5000));
      __test_reconcile();

      patchSlice('registry', setSyncPauseAll(getState().registry, true));
      __test_maybeCatchUpOnVisible();
      expect(__test_lastPullAt()).toBeNull();
    });

    // The "fires when elapsed > cadence" path calls pullNowAndRefresh which
    // wraps real engine.pullNow + real folder reads + real listener
    // notifications. That's covered end-to-end by the sync-engine.pullNow
    // tests; here we verify the eligibility checks only. The cadence-bug
    // regression that motivated this whole bout is covered by the "keeps the
    // interval running while the tab is hidden" test above.
  });
});
