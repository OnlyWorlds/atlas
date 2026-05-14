/**
 * Auto-pull scheduler — periodic background pull for the active api-linked
 * world (Phase 3.5+).
 *
 * Reads `registry.sync_cadence_ms` to decide whether to schedule (null/0 = off).
 * Only ever pulls the currently-attached engine — never reaches across worlds.
 *
 * Visibility handling:
 *   The interval keeps RUNNING regardless of tab visibility — we just skip the
 *   pull call when hidden, so the cadence countdown stays continuous. Earlier
 *   versions clear()'d the interval on visibilitychange, which reset the timer
 *   every time the user alt-tabbed to make changes on the web app and back to
 *   atlas — they could never reach a full cadence cycle. On becoming visible
 *   again, if enough time has elapsed since the last successful pull, fire a
 *   one-shot catch-up so the user doesn't wait an extra cadence cycle.
 *
 * Engine-pause handling:
 *   When the engine is paused (manual or network), we stop the interval — no
 *   point burning a timer slot. Reconcile re-schedules when paused clears.
 *
 * Triggered re-configuration from settings is handled by `reconcileScheduler()`,
 * which is called whenever the registry's cadence or any pause flag changes.
 */

import { getState, subscribe } from '../core/state';
import { pullNowAndRefresh, getCurrentSyncEngine } from './sync-attach';

let intervalId: ReturnType<typeof setInterval> | null = null;
let activeCadenceMs: number | null = null;
let lastPullAt: number | null = null;
let listenersWired = false;

/**
 * Internal: schedule the periodic pull if eligible, or stop if not.
 *
 * Eligible iff:
 *   - cadence is set (positive number)
 *   - an engine is attached (api-linked active world)
 *   - the engine is not paused (manual or network)
 *   - global pause flag is off
 *
 * Note: visibility is NOT part of eligibility — we keep the timer running
 * while the tab is hidden, just skip the pull call in the tick. Resetting the
 * timer on every visibility change defeats the cadence: the user typically
 * alt-tabs to make changes on the web app and back to atlas, and we want them
 * to see updates within the configured window, not every-time-they-return + N.
 */
function reconcileScheduler(): void {
  const state = getState();
  const reg = state.registry;
  const cadence = reg.sync_cadence_ms ?? null;
  const engine = getCurrentSyncEngine();
  const engineState = state.sync.activeSync;
  const enginePaused = engineState?.kind === 'paused';
  const globalPause = !!reg.sync_pause_all;

  const shouldRun =
    !!cadence &&
    cadence > 0 &&
    !!engine &&
    !enginePaused &&
    !globalPause;

  if (!shouldRun) {
    if (intervalId !== null) {
      console.info('[auto-pull] stopping scheduler', {
        previousCadenceMs: activeCadenceMs,
        reason: { cadence, hasEngine: !!engine, enginePaused, globalPause },
      });
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
  console.info('[auto-pull] scheduling periodic pull', {
    cadenceMs: cadence,
    engineState: engineState?.kind ?? 'none',
  });
  intervalId = setInterval(tickPull, cadence);
}

/**
 * Fire a pull if eligible AT TICK TIME. Skips when the tab is hidden, the
 * engine has gone away, or sync is paused. The interval keeps counting through
 * skipped ticks — a user returning to a hidden tab finds the cadence preserved.
 */
function tickPull(): void {
  const e = getCurrentSyncEngine();
  if (!e) {
    console.info('[auto-pull] tick: no engine attached — skipping');
    return;
  }
  // Skip while hidden but keep the interval running. The catch-up handler in
  // visibilitychange below covers the case where the tab was hidden across
  // a cadence boundary.
  if (typeof document !== 'undefined' && document.hidden) {
    console.info('[auto-pull] tick: tab hidden — skipping');
    return;
  }
  const s = getState().sync.activeSync;
  if (s?.kind === 'paused' || s?.kind === 'syncing') {
    console.info('[auto-pull] tick: engine busy/paused — skipping', { kind: s?.kind });
    return;
  }
  if (getState().registry.sync_pause_all) {
    console.info('[auto-pull] tick: global pause active — skipping');
    return;
  }
  console.info('[auto-pull] tick: firing pullNow');
  lastPullAt = Date.now();
  pullNowAndRefresh().catch(err => {
    console.warn('[auto-pull] scheduled pull failed:', err);
  });
}

/**
 * On becoming visible: if a cadence is running and the last pull was longer
 * ago than the cadence window, fire a catch-up pull immediately. Otherwise the
 * user would wait up to one full cadence after returning before seeing updates.
 */
function maybeCatchUpOnVisible(): void {
  if (typeof document === 'undefined' || document.hidden) return;
  if (activeCadenceMs === null) return;
  if (!getCurrentSyncEngine()) return;
  const s = getState().sync.activeSync;
  if (s?.kind === 'paused' || s?.kind === 'syncing') return;
  if (getState().registry.sync_pause_all) return;
  const elapsed = lastPullAt === null ? Infinity : Date.now() - lastPullAt;
  if (elapsed < activeCadenceMs) return;
  console.info('[auto-pull] became visible after a cadence window — firing catch-up pull', {
    elapsedMs: elapsed === Infinity ? null : elapsed,
    cadenceMs: activeCadenceMs,
  });
  lastPullAt = Date.now();
  pullNowAndRefresh().catch(err => {
    console.warn('[auto-pull] catch-up pull failed:', err);
  });
}

/**
 * Wire visibility + online/offline listeners and subscribe to state changes.
 * Idempotent — safe to call multiple times. Call once from app boot.
 */
export function initAutoPullScheduler(): void {
  if (listenersWired) return;
  listenersWired = true;

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      // Reconcile in case visibility-change correlates with another state
      // change (defensive; reconcile no longer reads visibility for
      // eligibility, but we want consistent logging).
      reconcileScheduler();
      maybeCatchUpOnVisible();
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      const engine = getCurrentSyncEngine();
      if (engine && getState().sync.activeSync?.kind === 'paused' &&
          (getState().sync.activeSync as { reason?: string }).reason === 'network') {
        // Came back online — resume engine. NOTE: SyncEngine.resume() only
        // clears the paused flag; it does NOT trigger a sync round. Pending
        // local writes wait for the next debounced push (re-armed on the next
        // user edit) and pulls wait for the next cadence tick or manual click.
        // If you need "immediately catch up on resume," call engine.syncNow()
        // explicitly here.
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
  lastPullAt = null;
}
export function __test_lastPullAt(): number | null {
  return lastPullAt;
}
export function __test_maybeCatchUpOnVisible(): void {
  maybeCatchUpOnVisible();
}
