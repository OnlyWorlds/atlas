/**
 * Sync attachment — opens a SyncEngine for an api-linked world and wires its
 * state changes into `state.sync.activeSync` (consumed by the sync pill).
 *
 * Module-level singleton: at most one engine is attached at a time, matching
 * the "one active world" UI model. World switches detach the previous engine.
 *
 * Used by:
 * - `activateWorld` (worlds-sidebar.ts) when the activated entry is `api-linked`.
 * - `attachApi`-flipping flows (Make-Online, Link-Existing-API) after the
 *   registry state transitions.
 *
 * The PIN comes from `state.registry.pin` — it's a global identity field, the
 * same for every api-linked world. If the PIN is missing when attach is called,
 * we log + skip engine creation; the UI surfaces this via the pill state.
 */

import { adoptPersistedDiskHold } from '../core/live-folder';
import { OwV2ClientAdapter } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import { SyncEngine } from './sync-engine';
import { patchSlice, getState, setState } from '../core/state';
import { toastManager } from '../ui/toast-manager';
import { rekeyRouteHash } from './rekey-route';
import type { FolderStore } from '../store/folder-store';
import { rewriteChartScopeIds } from '../visualization/timeline/charts-store';
import type { Element, WorldRegistryEntry, SyncEngineState, ElementType } from '../core/types';
import { setWorldFavoriteElement, saveRegistry } from '../registry/registry';
import { failureToastOnce, classifyFailure } from './sync-failure-copy';

let currentEngine: SyncEngine | null = null;
let currentWorldId: string | null = null;

// Chart-scope migrations are read-modify-writes on .atlas/charts.json with no
// store-level serialization (unlike sync-state.json / tombstones.json). Two
// swaps landing during one make-online could interleave reads and clobber each
// other's rewrite — serialize them through a module-level chain.
let chartsMigrationChain: Promise<void> = Promise.resolve();

/**
 * Attach a fresh SyncEngine to the given (api-linked) world's folder. Returns
 * the engine for callers that want to invoke `pushOnce()` etc. immediately,
 * or null if attachment isn't possible (not api-linked, missing PIN).
 *
 * Detaches the previous engine first (if any). Engines are not preserved
 * across world switches; if the user switches back, a fresh engine is built.
 *
 * Side effects (Phase 3.5+):
 *   - If `registry.sync_pause_all` is true OR `entry.sync_paused` is true,
 *     the engine starts paused (no autosave, no pulls).
 *   - If `registry.sync_pull_on_activate` is true AND not paused, fires a
 *     one-shot `pullNow()` after attach to catch up.
 *   - Default conflict policy comes from `registry.sync_default_policy` (or
 *     `local-wins` if not set).
 */
export function attachSyncEngine(entry: WorldRegistryEntry, folder: FolderStore): SyncEngine | null {
  // Always detach the previous engine first — at most one active at a time.
  detachSyncEngine();

  if (entry.state !== 'api-linked' || !entry.api) {
    return null;
  }

  const reg = getState().registry;
  const readOnly = !!entry.api.read_only;
  const pin = reg.pin;
  // View-only worlds (S264) run on a READ key — no PIN exists or is needed
  // (keel reads are keyless-PIN; the engine never writes).
  if (!pin && !readOnly) {
    console.warn('[sync-attach] PIN missing — engine not attached for', entry.name);
    return null;
  }

  // v2 port: the engine talks the keel v2 dialect through the thin fetch
  // adapter — no SDK client in the sync path (the SDK survives only for
  // worlds.get validation at the link/settings surfaces, gate 10.7).
  const adapter = new OwV2ClientAdapter({
    apiKey: entry.api.api_key,
    apiPin: readOnly ? '' : (pin as string),
    baseUrl: devV2Base() ?? undefined,
  });
  const engine = new SyncEngine({
    folder,
    client: adapter,
    readOnly,
    apiWorldId: entry.api.world_id,
    policy: reg.sync_default_policy ?? 'local-wins',
    onStateChange: (s) => publishSyncState(entry.id, s),
    onSyncResult: (phase, result) => emitConflictToasts(phase, result),
    // NOTE: the engine no longer has an onIdSwap hook — keel preserves client
    // ids on CREATE (id-swap create-path excised 2026-07-12). handleIdSwap
    // below survives for the Route 2 MATCH-phase swaps via applyIdSwapToUi.
  });
  // Apply persisted debounce preference if the user configured one. Engine
  // default (5000ms) stands when registry has no value.
  if (typeof reg.sync_debounce_ms === 'number' && reg.sync_debounce_ms >= 0) {
    engine.setDebounceMs(reg.sync_debounce_ms);
  }

  currentEngine = engine;
  currentWorldId = entry.id;
  // A batch of outside edits that was waiting for the user's answer when the
  // world was left (or the page reloaded) keeps waiting (S364 gate lens B B3):
  // the hold goes on BEFORE the flush-on-attach below, which would push it.
  if (!readOnly) adoptPersistedDiskHold(entry.id, engine);
  currentFolder = folder;

  console.info('[atlas:sync] engine attached', {
    world: entry.name,
    worldId: entry.id,
    apiWorldId: entry.api.world_id,
    policy: reg.sync_default_policy ?? 'local-wins',
    pullOnActivate: !!reg.sync_pull_on_activate,
    cadenceMs: reg.sync_cadence_ms ?? null,
    globalPaused: !!reg.sync_pause_all,
    worldPaused: !!entry.sync_paused,
  });

  // Pause if either global or per-world pause flag is set.
  const shouldPause = !!reg.sync_pause_all || !!entry.sync_paused;
  if (shouldPause) {
    engine.pause('manual');
  }

  // Seed the slice with the engine's initial state.
  publishSyncState(entry.id, engine.getState());
  // Refresh conflict count from sync-state.json — engine doesn't know yet.
  void refreshConflictsCount();

  // Sequence flush + pull-on-activate via a single async chain. Without this
  // ordering, both fire-and-forget and race for the engine's shared `inFlight`
  // lock: whichever loses the race silently returns the winner's promise. In
  // practice that meant `flushPendingOnAttach`'s `pushOnce()` returned the
  // pull's promise, `pushed.* === 0`, no "synced N pending" toast, and the
  // stranded edits never reached the server until the next user-driven write
  // re-armed the autosave debounce.
  //
  // Order: flush goes FIRST. Pending writes already encode user intent (they
  // typed in a prior session, lost the debounce to a reload) and should land
  // server-side before pull-on-activate looks for newer remote changes. Flush
  // is unconditional when pending exist; pull-on-activate is opt-in.
  if (!shouldPause) {
    void (async () => {
      // View-only: nothing local can be pending (writes are blocked at the
      // store seam), so the flush is skipped — and the pull-on-activate runs
      // UNCONDITIONALLY: a viewer's whole intent is seeing the world's current
      // state, and the local-first push asymmetry doesn't apply (no pushes).
      if (!readOnly) {
        try {
          await flushPendingOnAttach(engine, folder, entry.name);
        } catch (err) {
          // flushPendingOnAttach swallows its own errors; outer catch is defense-
          // in-depth in case the helper is ever refactored to throw.
          console.warn('[sync-attach] flush-on-attach failed:', err);
        }
      }
      if (reg.sync_pull_on_activate || readOnly) {
        try {
          await pullNowAndRefresh();
        } catch (err) {
          console.warn('[sync-attach] pull-on-activate failed:', err);
        }
      }
    })();
  }

  return engine;
}

/**
 * Fire a pushOnce() iff the folder has any locally-changed elements or
 * pending tombstones. Surfaces a one-shot toast on recovery so the user can
 * see "we caught up writes that were stuck from your last session."
 *
 * Failure-tolerant: per-element errors are recorded in result.failures and
 * surfaced via the normal engine state path. A complete network failure
 * throws and we just log — next push attempt (autosave / cadence / manual)
 * will retry.
 */
async function flushPendingOnAttach(
  engine: SyncEngine,
  folder: FolderStore,
  worldName: string
): Promise<void> {
  try {
    const changed = await folder.listLocallyChangedSince(null);
    const tombstones = await folder.listTombstonesSince(null);
    const pending = changed.length + tombstones.length;
    if (pending === 0) return;
    console.info('[atlas:sync] flush-on-attach: pending writes found', {
      world: worldName,
      changed: changed.length,
      tombstones: tombstones.length,
    });
    const result = await engine.pushOnce();
    const synced = result.pushed.creates + result.pushed.updates + result.pushed.deletes;
    if (synced > 0) {
      // Notify the user — these writes were stuck from a prior session.
      toastManager.success(`Synced ${synced} pending change${synced === 1 ? '' : 's'} from previous session`);
    }
    if (result.failures.length > 0) {
      console.warn('[atlas:sync] flush-on-attach: some writes failed', result.failures);
      // Surface to user — silent failures here are how Captain hit the "lying
      // pill" bug: pending writes from a prior session bounced off a dead
      // world (deleted server-side / bad PIN), failures collected but never
      // shown. Auth failures get their own dedicated toast via emitRoundToasts
      // below (pill also goes red); skip the generic warning in that case.
      if (!result.auth_blocked && !result.transient_blocked) {
        const text = failureToastOnce(result.failures);
        if (text) toastManager.error(text);
      }
    }
  } catch (err) {
    console.warn('[atlas:sync] flush-on-attach failed:', err);
  }
}

/**
 * Detach the current engine: pause it, clear the world's slice entry, and
 * reset `activeSync` to null. Safe to call when no engine is attached.
 */
export function detachSyncEngine(): void {
  if (currentWorldId !== null) {
    currentEngine?.stop();
    const sync = getState().sync;
    const byWorld = { ...sync.byWorld };
    delete byWorld[currentWorldId];
    patchSlice('sync', { byWorld, activeSync: null, activeConflictsCount: 0 });
  }
  currentEngine = null;
  currentWorldId = null;
  currentFolder = null;
}

/**
 * Convenience helper for UI callers that just want to schedule a debounced
 * push after a folder write. No-ops if no engine is attached (local-only world
 * or engine startup failed). Used by element-detail.ts after every save.
 */
export function requestPushIfLinked(): void {
  currentEngine?.requestPush();
}

/**
 * Refresh `state.data.elements` from disk + schedule a debounced push.
 *
 * Standard post-write pattern: after `store.createElement` / `updateElement` /
 * `deleteElement`, the caller wants the in-memory cache to reflect the new
 * state AND wants the change to flow to the server (for api-linked worlds).
 * This three-liner used to appear at ~25 call sites — see SWEEP-2026-05-20.md
 * F8. Returns the fresh element list so callers that need it (e.g. for
 * building a writingHash from the new state) can chain.
 */
export async function refreshElementsAfterWrite(store: FolderStore): Promise<Element[]> {
  const elements = await store.listElements();
  patchSlice('data', { elements });
  requestPushIfLinked();
  return elements;
}

/** Currently-attached engine, or null. Used by element-edit autosave wiring. */
export function getCurrentSyncEngine(): SyncEngine | null {
  return currentEngine;
}

/** Currently-attached engine's world id, or null. */
export function getCurrentSyncWorldId(): string | null {
  return currentWorldId;
}

/** Currently-attached folder store, or null. Set by attachSyncEngine. */
let currentFolder: FolderStore | null = null;
export function getCurrentSyncFolder(): FolderStore | null {
  return currentFolder;
}

/**
 * Diagnose why the sync engine isn't available right now. UI surfaces use
 * this when a sync action (pull, refresh, conflict resolve, etc.) would no-op
 * because `getCurrentSyncEngine()` returns null. The original toasts were
 * generic ("Engine not ready" / "Refresh is only available on API-linked
 * worlds") which misled users — by far the most common cause is a missing
 * PIN on an otherwise-valid api-linked world. This helper returns a
 * structured reason so callers can pick the right toast and (if applicable)
 * deep-link the user to the right settings tab.
 *
 * Returns null if the engine should be considered ready by any UI surface
 * (i.e. an engine is attached). Callers should still gate on the engine
 * pointer itself; this helper only diagnoses the absence.
 */
export type SyncUnavailableReason =
  | { kind: 'no-active-world' }
  | { kind: 'local-only'; worldId: string }
  | { kind: 'pin-missing'; worldId: string }
  // ('attached-but-paused' removed S307 — declared here and handled in
  //  sync-toasts, but never CONSTRUCTED by the function below, so the branch
  //  was unreachable and its toast had never fired. A definition with no
  //  producer is not a feature.)
  | { kind: 'engine-not-ready' };

export function diagnoseSyncUnavailable(): SyncUnavailableReason | null {
  if (currentEngine) return null;
  const state = getState();
  const worldId = state.active?.worldId;
  if (!worldId) return { kind: 'no-active-world' };
  const entry = state.registry.worlds.find((w) => w.id === worldId);
  if (!entry) return { kind: 'engine-not-ready' };
  if (entry.state !== 'api-linked') return { kind: 'local-only', worldId };
  if (!state.registry.pin) return { kind: 'pin-missing', worldId };
  return { kind: 'engine-not-ready' };
}

/**
 * Pull-now wrapper that also refreshes `state.data.elements` from the folder
 * after a successful pull. Use this from UI surfaces (pill click, refresh
 * button, periodic scheduler) so the UI reflects newly-pulled elements.
 *
 * Post-pull side effects (3.5+):
 *   - Refresh conflict + server-delete counts on `state.sync`.
 *   - If `registry.sync_confirm_server_deletes` is true (default) AND there
 *     are server-deleted records detected this pull, auto-open the review
 *     modal so the user can decide.
 *
 * Returns the SyncResult or null if no engine is attached. Throws on failure
 * — callers surface as toast.
 */
export async function pullNowAndRefresh(): Promise<import('../core/types').SyncResult | null> {
  if (!currentEngine || !currentFolder) {
    console.info('[atlas:sync] pullNowAndRefresh: no engine attached');
    return null;
  }
  console.info('[atlas:sync] pull starting');
  const result = await currentEngine.pullNow();
  console.info('[atlas:sync] pull complete', {
    creates: result.pulled.creates,
    updates: result.pulled.updates,
    conflicts: result.conflicts.length,
  });
  // Re-read folder elements to reflect any creates/updates from the pull.
  try {
    const elements = await currentFolder.listElements();
    patchSlice('data', { elements });
  } catch (err) {
    console.warn('[sync-attach] refresh-after-pull failed:', err);
  }
  await refreshConflictsCount();
  await maybeAutoOpenServerDeleteModal();
  // Surface a count toast when scheduled / pull-on-activate / catch-up pulls
  // actually land changes. Without this, automatic pulls are silent and the
  // user can't tell if their web-app edits propagated. Conflict toasts are
  // handled separately by emitConflictToasts under local-wins (don't
  // double-toast). Pill-click handler does its own "already up to date" toast
  // for the manual case — that's intentionally only fired on user-initiated
  // pulls so cadence ticks don't spam.
  const totalUpdates = result.pulled.creates + result.pulled.updates;
  if (totalUpdates > 0 && result.conflicts.length === 0) {
    const parts: string[] = [];
    if (result.pulled.creates > 0) parts.push(`${result.pulled.creates} new`);
    if (result.pulled.updates > 0) parts.push(`${result.pulled.updates} updated`);
    if (result.meta_pulled?.length) parts.push('world settings');
    toastManager.info(`Pulled ${parts.join(' + ')} from API`);
  } else if ((result.meta_pulled?.length ?? 0) > 0 && result.conflicts.length === 0) {
    // Meta-only round (world-meta gate R7): the element counters are zero but
    // something real changed — say so, or the pull reads as a silent no-op.
    toastManager.info('Pulled world settings from API');
  }
  return result;
}

/**
 * If the active world has pending server-delete records AND the user has
 * "confirm before deleting locally" enabled (default), open the review modal.
 * Idempotent — modal class handles the "no records" case as a no-op.
 *
 * Uses a dynamic import to avoid circular dep with the UI layer.
 */
let serverDeleteModalOpen = false;
async function maybeAutoOpenServerDeleteModal(): Promise<void> {
  if (!currentEngine) return;
  if (serverDeleteModalOpen) return;
  const reg = getState().registry;
  // Default true; only skip when explicitly disabled.
  if (reg.sync_confirm_server_deletes === false) return;
  try {
    const records = await currentEngine.listServerDeletes();
    if (records.length === 0) return;
    const { ServerDeleteReviewModal } = await import('../ui/server-delete-modal');
    serverDeleteModalOpen = true;
    const modal = new ServerDeleteReviewModal(toastManager);
    try {
      await modal.open();
    } finally {
      serverDeleteModalOpen = false;
    }
  } catch (err) {
    console.warn('[sync-attach] auto-open server-delete modal failed:', err);
  }
}

function publishSyncState(worldId: string, engineState: SyncEngineState): void {
  const sync = getState().sync;
  patchSlice('sync', {
    byWorld: { ...sync.byWorld, [worldId]: engineState },
    activeSync: engineState,
    activeConflictsCount: sync.activeConflictsCount,
  });
  // Engine just transitioned to idle → push/pull just finished.
  // Refresh data.elements + conflicts so the UI catches id-swaps and pulled
  // updates without a page reload. refreshMetaCache re-reads world.json into
  // state.active.meta (world-meta sync R2/D7) — the charts room's nowValue()
  // and the home identity strip read that slice live, so a pull-applied
  // time_current moves the now-line without a reload.
  if (engineState.kind === 'idle') {
    void refreshConflictsCount();
    void refreshElementsCache();
    void refreshMetaCache();
  }
}

/**
 * Emit one-shot toasts summarizing the outcome of a sync round.
 *
 * Three concerns surface here, in priority order:
 *   1. Auth-blocked round: pill already went to red `error` (engine
 *      transitioned via setAuthError). One sticky-ish toast points the user
 *      at recovery. No retry-spam — engine is paused until PIN change or
 *      detach re-attaches a fresh engine.
 *   2. Non-auth per-element failures with NO successes: pill stays idle but
 *      the round produced nothing. Without a toast the user thinks "synced"
 *      because the spinner went idle. This is the "lying pill" class. Toast
 *      that something failed and link them to settings.
 *   3. Conflicts:
 *      - `pause-and-review`: stay silent. Badge + modal handle it.
 *      - `local-wins` push: server overwritten. Confirm.
 *      - `local-wins` pull: trigger follow-up push so local converges now
 *        (don't wait for the 5s autosave debounce).
 *      - `local-wins` sync: emit summary.
 */
function emitConflictToasts(
  phase: 'push' | 'pull' | 'sync',
  result: import('../core/types').SyncResult
): void {
  // Auth-blocked: one clear toast. Engine state is already 'error' so the
  // pill carries the persistent signal; this toast is the moment-it-happened
  // notification. Skip if the round had successes (mixed-blocked is rare and
  // the engine still went to error — keep the surfacing single).
  // Busy, rate limited or offline (S361, lane b M4): one plain sentence with
  // the wait, instead of a wall of per-element failures.
  if (result.transient_blocked) {
    const secs = Math.max(1, Math.round((result.retry_after_ms ?? 30_000) / 1000));
    const when = secs >= 90 ? `${Math.round(secs / 60)} minutes` : `${secs} seconds`;
    toastManager.info(
      result.transient_reason === 'rate_limited'
        ? `OnlyWorlds is limiting requests, which happens after too many wrong PIN tries. Atlas will try again in ${when}.`
        : result.transient_reason === 'offline'
          ? `OnlyWorlds could not be reached. Your changes are saved in the folder, and Atlas will try again in ${when}.`
          : `OnlyWorlds is busy. Your changes are saved in the folder, and Atlas will try again in ${when}.`
    );
    return;
  }

  if (result.auth_blocked) {
    // Revoked minted key ≠ wrong PIN (gate R4): the PIN advice would send the
    // user to the wrong fix. Re-opening from the sidebar mints a fresh key.
    toastManager.error(
      result.auth_reason === 'key_revoked'
        ? 'Sync paused: this world\'s access key was revoked. Unlink it, then reopen it from the sidebar to get a new key.'
        : 'Sync paused: authentication failed. Verify your PIN in settings, or unlink this world if it was deleted on the server.'
    );
    return;
  }

  // Non-auth failures with no successes: the round produced zero progress.
  // This is the "lying pill" guard — without a toast here, the user sees the
  // pill go saving → idle and assumes everything synced.
  const synced =
    result.pushed.creates + result.pushed.updates + result.pushed.deletes +
    result.pulled.creates + result.pulled.updates +
    (result.meta_pushed?.length ?? 0) + (result.meta_pulled?.length ?? 0);
  // S360: say WHY, and say it once per distinct set. A persistent failure (an
  // id owned by another world, an oversized element) used to be silent when
  // anything else synced, and when nothing did, the advice was "test
  // connection", which passes.
  if (result.failures.length > 0) {
    const text = synced === 0
      ? failureToastOnce(result.failures)
      : failureToastOnce(result.failures.filter(f => classifyFailure(f) !== 'other'));
    if (text) toastManager.error(text);
    // Fall through — there might be conflicts to surface too.
  }

  // Dispatch a non-bubbling CustomEvent listing the ids the pull just applied
  // to local. The elements sidebar listens and briefly flashes matching rows
  // (P3) so the user sees that something changed under their nose. Decoupling
  // via a DOM event keeps sync-attach from importing UI modules. No-op when
  // there's nothing to flash.
  if (result.pulled_ids && result.pulled_ids.length > 0) {
    document.dispatchEvent(new CustomEvent('atlas:pulled-ids', {
      detail: { ids: result.pulled_ids.slice() },
    }));
  }

  if (result.conflicts.length === 0) return;
  const reg = getState().registry;
  const policy = reg.sync_default_policy ?? 'local-wins';
  if (policy === 'pause-and-review') return; // badge + modal handle it

  const n = result.conflicts.length;

  // Pull-phase conflicts under local-wins: trigger an immediate push so the
  // local version actually propagates without waiting for the autosave timer.
  // The push's own onSyncResult callback emits the user-facing toast — quieter
  // and more accurate than a "will push later" message.
  //
  // CRITICAL: defer to next macrotask. The engine's `inFlight` is still set
  // here (we're called from inside runPullOnly, before `.finally` clears it).
  // Calling pushOnce() synchronously would return the in-flight PULL promise
  // and silently no-op. setTimeout(0) yields until inFlight is cleared.
  if (phase === 'pull') {
    // Capture the world id at schedule time. If the user switches worlds
    // between scheduling and firing (sub-millisecond, but possible via
    // user-driven nav), `currentEngine` will be the new world's engine and
    // pushing on it would propagate the WRONG conflict's intent — and worse,
    // would leave the original world's local divergence un-converged. Bail
    // gracefully if the world has changed.
    const scheduledWorldId = currentWorldId;
    setTimeout(() => {
      const engine = currentEngine;
      if (!engine) return;
      if (currentWorldId !== scheduledWorldId) {
        console.info('[atlas:sync] post-pull-conflict push skipped: world switched during defer', {
          scheduledWorldId,
          currentWorldId,
        });
        return;
      }
      console.info('[atlas:sync] local-wins: pull detected conflict, firing pushOnce to converge');
      engine.pushOnce().catch(err => {
        console.warn('[atlas:sync] post-pull-conflict push failed:', err);
      });
    }, 0);
    return;
  }

  // Push or sync phase: server was overwritten — confirm.
  const message = phase === 'push'
    ? `Saved over server change${n === 1 ? '' : 's'} for ${n} element${n === 1 ? '' : 's'}`
    : `Resolved ${n} divergent element${n === 1 ? '' : 's'} in your favor`;
  toastManager.info(message);
}

/**
 * Migrate UI state when push CREATE results in a server-assigned id (id-swap).
 * Without this, the user keeps viewing the URL `/element/<old-id>` after the
 * engine has moved the local file to `<new-id>` and rewritten refs — the
 * middle pane shows a confusing "element <old-id> not found in this world"
 * empty-state because the elements cache no longer contains the old id.
 *
 * Three migrations:
 *   - `state.ui.selectedElementId` → new_id (if it pointed at old_id)
 *   - URL hash `/element/<old-id>` → `/element/<new-id>` (if visible there)
 *   - URL hash `/map/<mid>/element/<old-id>` → same with new_id
 */
function handleIdSwap(swap: { old_id: string; new_id: string; type: ElementType }): void {
  // ATOMIC migration: substitute the element's id in the cached elements list
  // AND migrate selectedElementId in a single setState call. Without this, two
  // separate patchSlice writes produce two renders — the in-between one has
  // ui.selectedElementId = new_id but data.elements still has old_id, so the
  // middle pane flashes "element <new_id> not found in this world" before the
  // engine's subsequent refreshElementsCache catches up at idle.
  //
  // The substitution carries the OLD entry's content with the NEW id grafted.
  // This is fine: the content sent on CREATE is what local just had; the
  // server's response (now under new_id on disk via applyServerRecord) is the
  // same content + a stamped server_updated_at. refreshElementsCache at engine
  // idle reconciles to the on-disk version shortly after.
  const current = getState();

  const oldIndex = current.data.elements.findIndex((e) => e.id === swap.old_id);
  const nextElements =
    oldIndex >= 0
      ? current.data.elements.map((e, i) =>
          i === oldIndex ? { ...e, id: swap.new_id } : e
        )
      : current.data.elements;

  // Also migrate any open map tabs that reference the swapping id. Without
  // this, after a make-online a tab whose `mapId` was the local pre-swap id
  // now points at nothing — the map pane shows "map not found" until the
  // user closes and reopens the tab. (DESIGN_MAPS.md §10b N1, swap fix #2.)
  let nextRightTabs = current.ui.rightTabs;
  let tabsChanged = false;
  if (swap.type === 'map') {
    nextRightTabs = current.ui.rightTabs.map((t) => {
      if (t.kind === 'map' && t.mapId === swap.old_id) {
        tabsChanged = true;
        return { ...t, mapId: swap.new_id };
      }
      return t;
    });
    // Migrate the saved camera state too. Without this, a user who panned a
    // local map (save under v4 id), then linked online (Make-Online assigns
    // v7 id and rewrites local refs), then refreshed the page — the camera
    // state would be looked up under the v7 id and miss (returning the
    // fit-to-image default) because the actual save was under v4. Session
    // 221 W6 follow-up: migrate camera state in lock-step with the id swap.
    void import('../core/map-camera-persist').then(({ getCameraState, saveCameraState, clearCameraState }) => {
      const saved = getCameraState(swap.old_id);
      if (saved) {
        saveCameraState(swap.new_id, saved);
        clearCameraState(swap.old_id);
      }
    }).catch((err) => console.warn('[sync-attach] camera-state migration failed:', err));
  }

  // Migrate saved chart SCOPES on disk. Charts (.atlas/charts.json) are
  // atlas-local — NOT covered by the element-file id rewrite — so a focus /
  // selection chart would keep a dead pre-swap id after make-online (mirrors
  // the camera-state migration above; applies to ANY element type).
  {
    const folder = currentFolder;
    if (folder) {
      chartsMigrationChain = chartsMigrationChain.then(async () => {
        try {
          const charts = await folder.readCharts();
          const { charts: nextCharts, changed } = rewriteChartScopeIds(charts, swap.old_id, swap.new_id);
          if (changed) {
            await folder.writeCharts(nextCharts);
            window.dispatchEvent(new CustomEvent('atlas:charts-changed'));
          }
        } catch (err) {
          console.warn('[sync-attach] chart-scope id migration failed:', err);
        }
      });
    }
  }

  // Cast favorites (D2b) live in the REGISTRY keyed by element id — outside
  // the element-file ref rewrite. A protagonist/home favorited while the
  // world was local-only would silently vanish from the home cover after
  // make-online without this remap (same class as the camera-state and
  // chart-scope migrations above).
  let nextRegistry = current.registry;
  if (swap.type === 'character' || swap.type === 'location') {
    const activeWorldId = current.active?.worldId;
    const entry = activeWorldId
      ? current.registry.worlds.find((w) => w.id === activeWorldId)
      : undefined;
    const fav = entry?.favorites;
    if (activeWorldId && fav) {
      if (fav.protagonist_id === swap.old_id) {
        nextRegistry = setWorldFavoriteElement(nextRegistry, activeWorldId, 'protagonist', swap.new_id);
      }
      if (fav.nexus_id === swap.old_id) {
        nextRegistry = setWorldFavoriteElement(nextRegistry, activeWorldId, 'nexus', swap.new_id);
      }
      if (nextRegistry !== current.registry) saveRegistry(nextRegistry);
    }
  }

  // Migrate active pin-placement targeting. Reachable when the user has a
  // pin-placement banner active for a freshly-created element while
  // Make-Online Route 1 (or first push) swaps that element's id. Without
  // this, clicking the map after the swap would silently no-op (the
  // referenced element_id no longer exists in data.elements).
  let nextPinPlacement = current.ui.pinPlacement;
  let placementChanged = false;
  if (current.ui.pinPlacement && current.ui.pinPlacement.elementId === swap.old_id) {
    nextPinPlacement = { elementId: swap.new_id };
    placementChanged = true;
  }

  let nextUi = current.ui;
  if (current.ui.selectedElementId === swap.old_id) {
    nextUi = { ...nextUi, selectedElementId: swap.new_id };
  }
  if (tabsChanged) {
    nextUi = { ...nextUi, rightTabs: nextRightTabs };
  }
  if (placementChanged) {
    nextUi = { ...nextUi, pinPlacement: nextPinPlacement };
  }
  // Knowledge lens follows its knower across the swap (same class as the
  // pin-placement migration — a transient ui ref to a swappable element id).
  if (current.ui.knowledgeLens && current.ui.knowledgeLens.knowerId === swap.old_id) {
    nextUi = { ...nextUi, knowledgeLens: { knowerId: swap.new_id } };
  }

  // Only setState if at least one slice actually changed — avoids a spurious
  // render when the swap doesn't intersect anything the UI is showing.
  if (
    nextElements !== current.data.elements ||
    nextUi !== current.ui ||
    nextRegistry !== current.registry
  ) {
    setState({
      ...current,
      data: { ...current.data, elements: nextElements },
      ui: nextUi,
      registry: nextRegistry,
    });
  }

  // The URL follows the id (S363: one rewriter for every room, `rekey-route.ts`).
  // `replace`, not navigate: Back must not lead to an id that no longer exists.
  const worldId = current.active?.worldId;
  if (!worldId) return;
  const next = rekeyRouteHash(window.location.hash, worldId, new Map([[swap.old_id, swap.new_id]]));
  if (next) window.location.replace(next);
}

/**
 * Public id-swap propagation. Used by every push path that can produce a
 * server-assigned id different from the local one:
 *
 *   - The long-running engine attached via `attachSyncEngine` — wired through
 *     the engine's `onIdSwap` option above.
 *   - The TRANSIENT engine spun up by Make-Online Route 1 (`make-online-modal.ts`).
 *     That engine pushes everything to a brand-new api world while the modal
 *     is open; without this callback, every id-swapped element leaves the
 *     user's URL/selection pointing at the pre-swap local id, and after the
 *     modal closes the middle pane renders "element <old-id> not found in
 *     this world."
 *   - The Route 2 merge flow (`mergeLocalIntoApi`) — doesn't use a SyncEngine,
 *     but accumulates id-swaps in a Map. The caller passes this same function
 *     via `MergeOpts.onIdSwap` so match-phase + CREATE-time swaps migrate UI
 *     state symmetrically with Route 1.
 *
 * All three call sites land at the same `handleIdSwap` implementation. The
 * atomic-state-transition discipline (convention #124) lives there — single
 * `setState` patching both `data.elements` and `ui.selectedElementId` in one
 * notification so subscribers never observe a half-migrated state.
 */
export function applyIdSwapToUi(swap: {
  old_id: string;
  new_id: string;
  type: ElementType;
}): void {
  handleIdSwap(swap);
}

/**
 * Test-only: invoke the conflict-toast emitter with a synthetic SyncResult.
 * Used to verify the setTimeout(0) world-switch race guard without standing
 * up a full conflict scenario through MSW.
 */
export function __test_emitConflictToasts(
  phase: 'push' | 'pull' | 'sync',
  result: import('../core/types').SyncResult
): void {
  emitConflictToasts(phase, result);
}

/**
 * Test-only: invoke the id-swap UI migration directly. Verifies the state +
 * URL transitions without standing up the full engine CREATE flow.
 *
 * Retained for backward compatibility with `sync-attach.idSwap.test.ts`; new
 * call sites should use the public `applyIdSwapToUi` export above.
 */
export function __test_handleIdSwap(swap: {
  old_id: string;
  new_id: string;
  type: ElementType;
}): void {
  handleIdSwap(swap);
}

/** Re-prime `state.data.elements` from the active folder. Fire-and-forget. */
async function refreshElementsCache(): Promise<void> {
  if (!currentFolder) return;
  try {
    const elements = await currentFolder.listElements();
    patchSlice('data', { elements });
  } catch (err) {
    console.warn('[sync-attach] refresh elements cache failed:', err);
  }
}

/**
 * Re-read world.json into `state.active.meta` after a sync round (world-meta
 * sync, S262). Without this, a pull-applied time_current/description changes
 * the DISK but every consumer keeps rendering the stale slice until reload —
 * the exact gap the S262 handover flagged. Guards: the active world must
 * still be the world this engine belongs to (world switches race idle
 * transitions), and a no-change read patches nothing (avoids spurious
 * re-renders mid-interaction).
 */
async function refreshMetaCache(): Promise<void> {
  if (!currentFolder) return;
  try {
    const active = getState().active;
    if (!active || active.worldId !== currentWorldId) return;
    const meta = await currentFolder.readWorldMeta();
    const prev = JSON.stringify(active.meta);
    if (JSON.stringify(meta) === prev) return;
    const nowActive = getState().active;
    if (!nowActive || nowActive.worldId !== currentWorldId) return;
    patchSlice('active', { ...nowActive, meta });
  } catch (err) {
    console.warn('[sync-attach] refresh meta cache failed:', err);
  }
}

/**
 * Refresh the conflict badge count from the folder's sync-state.json.
 * Fire-and-forget — called after any sync transition + after resolveConflict.
 */
export async function refreshConflictsCount(): Promise<void> {
  if (!currentEngine) {
    const sync = getState().sync;
    if (sync.activeConflictsCount !== 0) {
      patchSlice('sync', { ...sync, activeConflictsCount: 0 });
    }
    return;
  }
  try {
    const list = await currentEngine.listConflicts();
    // World-meta contested fields count toward the badge too (gate R9) —
    // they're the same "decide later" obligation, just world-shaped.
    const metaList = await currentEngine.listMetaConflicts();
    const total = list.length + metaList.length;
    const sync = getState().sync;
    if (sync.activeConflictsCount !== total) {
      patchSlice('sync', { ...sync, activeConflictsCount: total });
    }
  } catch (err) {
    console.warn('[sync-attach] refresh conflicts failed:', err);
  }
}

/**
 * Public wrapper for the meta-slice refresh — the conflict modal calls it
 * after resolving a world-settings row (the resolve may have rewritten
 * world.json via 'theirs').
 */
export async function refreshMetaCacheNow(): Promise<void> {
  return refreshMetaCache();
}
