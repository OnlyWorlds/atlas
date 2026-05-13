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

import { OnlyWorldsClient } from '@onlyworlds/sdk';
import { OwClientAdapter } from './ow-client-adapter';
import { SyncEngine } from './sync-engine';
import { patchSlice, getState } from '../core/state';
import { toastManager } from '../ui/toast-manager';
import type { FolderStore } from '../store/folder-store';
import type { WorldRegistryEntry, SyncEngineState } from '../core/types';

let currentEngine: SyncEngine | null = null;
let currentWorldId: string | null = null;

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
 *     `drain-blind` if not set).
 */
export function attachSyncEngine(entry: WorldRegistryEntry, folder: FolderStore): SyncEngine | null {
  // Always detach the previous engine first — at most one active at a time.
  detachSyncEngine();

  if (entry.state !== 'api-linked' || !entry.api) {
    return null;
  }

  const reg = getState().registry;
  const pin = reg.pin;
  if (!pin) {
    console.warn('[sync-attach] PIN missing — engine not attached for', entry.name);
    return null;
  }

  const client = new OnlyWorldsClient({
    apiKey: entry.api.api_key,
    apiPin: pin,
  });
  const adapter = new OwClientAdapter(client);
  const engine = new SyncEngine({
    folder,
    client: adapter,
    policy: reg.sync_default_policy ?? 'drain-blind',
    onStateChange: (s) => publishSyncState(entry.id, s),
  });

  currentEngine = engine;
  currentWorldId = entry.id;
  currentFolder = folder;

  console.info('[atlas:sync] engine attached', {
    world: entry.name,
    worldId: entry.id,
    apiWorldId: entry.api.world_id,
    policy: reg.sync_default_policy ?? 'drain-blind',
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

  // Pull-on-activate (3.5+). Only when not paused and the setting is on.
  if (!shouldPause && reg.sync_pull_on_activate) {
    // Fire-and-forget; failures surface via engine state. Use the wrapper so
    // newly-pulled elements appear in the UI cache.
    pullNowAndRefresh().catch(err => {
      console.warn('[sync-attach] pull-on-activate failed:', err);
    });
  }

  return engine;
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
  // updates without a page reload.
  if (engineState.kind === 'idle') {
    void refreshConflictsCount();
    void refreshElementsCache();
  }
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
    const sync = getState().sync;
    if (sync.activeConflictsCount !== list.length) {
      patchSlice('sync', { ...sync, activeConflictsCount: list.length });
    }
  } catch (err) {
    console.warn('[sync-attach] refresh conflicts failed:', err);
  }
}
