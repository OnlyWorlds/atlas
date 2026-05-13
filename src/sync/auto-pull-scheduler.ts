/**
 * Auto-pull scheduler — periodic background pull for the active api-linked
 * world (Phase 3.5+).
 *
 * Reads `registry.sync_cadence_ms` to decide whether to schedule (null/0 = off).
 * Only ever pulls the currently-attached engine — never reaches across worlds.
 * Pauses when the tab is hidden (visibilitychange). Pauses when the engine is
 * paused for any reason (no point firing a no-op). Resumes when conditions
 * change back.
 *
 * Triggered re-configuration from settings is handled by `reconcileScheduler()`,
 * which is called whenever the registry's cadence or any pause flag changes.
 *
 * Network online/offline events handle a separate concern: auto-pause/resume
 * the engine itself when connectivity changes. The scheduler tracks the engine's
 * paused state via the published sync slice.
 */

import { getState, subscribe } from '../core/state';
import { pullNowAndRefresh, getCurrentSyncEngine } from './sync-attach';

let intervalId: ReturnType<typeof setInterval> | null = null;
let activeCadenceMs: number | null = null;
let listenersWired = false;

/**
 * Internal: schedule the periodic pull if eligible, or stop if not.
 *
 * Eligible iff:
 *   - cadence is set (positive number)
 *   - tab is visible
 *   - an engine is attached (api-linked active world)
 *   - the engine is not paused (manual or network)
 *   - global pause flag is off
 */
function reconcileScheduler(): void {
  const state = getState();
  const reg = state.registry;
  const cadence = reg.sync_cadence_ms ?? null;
  const visible = typeof document !== 'undefined' ? !document.hidden : true;
  const engine = getCurrentSyncEngine();
  const engineState = state.sync.activeSync;
  const enginePaused = engineState?.kind === 'paused';
  const globalPause = !!reg.sync_pause_all;

  const shouldRun =
    !!cadence &&
    cadence > 0 &&
    visible &&
    !!engine &&
    !enginePaused &&
    !globalPause;

  if (!shouldRun) {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
      activeCadenceMs = null;
    }
    return;
  }

  // Already running at the right cadence? leave alone.
  if (intervalId !== null && activeCadenceMs === cadence) return;

  // Cadence changed or fresh start: replace interval.
  if (intervalId !== null) clearInterval(intervalId);
  activeCadenceMs = cadence;
  intervalId = setInterval(() => {
    // Re-check on each tick in case the world detached or paused mid-cadence.
    const e = getCurrentSyncEngine();
    if (!e) return;
    const s = getState().sync.activeSync;
    if (s?.kind === 'paused' || s?.kind === 'syncing') return;
    if (getState().registry.sync_pause_all) return;
    pullNowAndRefresh().catch(err => {
      console.warn('[auto-pull] scheduled pull failed:', err);
    });
  }, cadence);
}

/**
 * Wire visibility + online/offline listeners and subscribe to state changes.
 * Idempotent — safe to call multiple times. Call once from app boot.
 */
export function initAutoPullScheduler(): void {
  if (listenersWired) return;
  listenersWired = true;

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', reconcileScheduler);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      const engine = getCurrentSyncEngine();
      if (engine && getState().sync.activeSync?.kind === 'paused' &&
          (getState().sync.activeSync as { reason?: string }).reason === 'network') {
        // Came back online — resume engine. SyncEngine.resume() also fires syncNow.
        engine.resume();
      }
      reconcileScheduler();
    });
    window.addEventListener('offline', () => {
      const engine = getCurrentSyncEngine();
      if (engine && getState().sync.activeSync?.kind !== 'paused') {
        engine.pause('network');
      }
      reconcileScheduler();
    });
  }

  // React to any state change that might affect eligibility.
  subscribe(reconcileScheduler);

  // First reconciliation in case settings already match.
  reconcileScheduler();
}

/** Test helpers — exported for unit tests. Not used in production code. */
export function __test_isRunning(): boolean {
  return intervalId !== null;
}
export function __test_currentCadence(): number | null {
  return activeCadenceMs;
}
export function __test_reconcile(): void {
  reconcileScheduler();
}
export function __test_stop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    activeCadenceMs = null;
  }
}
