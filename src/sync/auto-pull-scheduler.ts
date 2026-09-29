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
  // Treat `error` like `paused` — both indicate the engine isn't pushing or
  // pulling against the api. After Bout T (session 205) auth failures
  // transition the engine to `error` (not `paused`); without this guard the
  // scheduler kept ticking and each tick invoked `pullNowAndRefresh` which
  // engine.pullNow short-circuits because the engine itself is paused. No
  // network spam, but wasted timer churn every cadence cycle until either
  // the user fixes the PIN (which spins up a fresh engine) or unlinks.
  const engineInactive =
    engineState?.kind === 'paused' || engineState?.kind === 'error';
  const globalPause = !!reg.sync_pause_all;

  const shouldRun =
    !!cadence &&
    cadence > 0 &&
    !!engine &&
    !engineInactive &&
    !globalPause;

  if (!shouldRun) {
    if (intervalId !== null) {
      console.info('[auto-pull] stopping scheduler', {
        previousCadenceMs: activeCadenceMs,
        reason: { cadence, hasEngine: !!engine, engineInactive, engineKind: engineState?.kind, globalPause },
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
    console.debug('[auto-pull] tick: no engine attached — skipping');
    return;
  }
  // Skip while hidden but keep the interval running. The catch-up handler in
  // visibilitychange below covers the case where the tab was hidden across
  // a cadence boundary.
  if (typeof document !== 'undefined' && document.hidden) {
    console.debug('[auto-pull] tick: tab hidden — skipping');
    return;
  }
  const s = getState().sync.activeSync;
  // Defense-in-depth: even if reconcile didn't yet stop the interval (e.g.
  // engine transitioned mid-tick), the tick itself bails for any non-idle
  // engine. Includes `error` so post-Bout-T auth-failed engines don't burn
  // pullNow calls (engine.pullNow already no-ops while paused — this just
  // skips the wrapper plumbing too).
  if (s?.kind === 'paused' || s?.kind === 'syncing' || s?.kind === 'error') {
    console.debug('[auto-pull] tick: engine busy/paused/error — skipping', { kind: s?.kind });
    return;
  }
  if (getState().registry.sync_pause_all) {
    console.debug('[auto-pull] tick: global pause active — skipping');
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
  // Same set as tickPull — include `error` so the catch-up doesn't fire
  // against an auth-failed engine.
  if (s?.kind === 'paused' || s?.kind === 'syncing' || s?.kind === 'error') return;
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
      // Ask the engine, not the pill: during a re-key the pill says "held"
      // while the network pause sits underneath it (S363 gate lens B F1).
      if (engine?.isNetworkPaused()) {
        // Came back online — resume engine. `resume()` now also fires
        // pushOnce internally so pending writes from the offline window
        // flush immediately (previously they sat on disk until the next
        // user edit re-armed autosave). Pulls still wait for the next
        // cadence tick or manual click — the cadence scheduler also
        // reconciles on this state change.
        engine.resume();
      }
      reconcileScheduler();
    });
    window.addEventListener('offline', () => {
      const engine = getCurrentSyncEngine();
      if (engine && !engine.isPaused()) {
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
