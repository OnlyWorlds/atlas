/**
 * Delete a world kept in this browser (1.17, conv. 129; contract §1.2, §3.1,
 * §9 invariant 11).
 *
 * A browser world has no folder to keep, so it offers Delete only, never
 * Forget (Forget would orphan a directory nothing can reach). The removal is
 * all-or-nothing while ANY writable is open inside the directory (measured,
 * both engines), so everything that could hold one closes first: the rooms
 * flush, the sync engine detaches, the open store closes, a parked store is
 * evicted and its close awaited. Then the directory the entry names, and only
 * it, is removed (`removeBrowserWorldDir`: resolve-checked, busy retried).
 * The entry leaves the registry only after the removal succeeded; on a
 * failure nothing is removed, the entry stays, and the caller reopens the
 * world and says so.
 */

import { getState, patchSlice } from '../core/state';
import { getActiveStore, setActiveStore, evictParkedStore, awaitEviction } from '../core/active-store';
import { enqueueActivationTask } from '../core/activation-chain';
import { flushBeforeLeavingWorld } from '../core/leave-flush';
import { isBrowserWorld, removeBrowserWorldDir } from '../core/browser-worlds';
import { deleteWorldEntry, saveRegistry } from '../registry/registry';
import { detachSyncEngine, getCurrentSyncWorldId } from '../sync/sync-attach';
import { clearSyncIssues } from '../sync/sync-issues';
import type { WorldRegistryEntry } from '../core/types';

export type BrowserDeleteResult =
  /**
   * `listSaved: false`: the directory is gone but the list of worlds could
   * not be saved (a full localStorage), so after a reload the row comes back
   * as cleared by this browser.
   */
  | { ok: true; listSaved: boolean }
  /** Nothing was removed; the entry is kept. `wasActive`: reopen it. */
  | { ok: false; error: unknown; wasActive: boolean };

/** The line said when the removal did not happen (contract §1.2). */
export const BROWSER_DELETE_FAILED = (name: string) =>
  `Atlas could not delete "${name}" from this browser, so nothing was removed. Close any other Atlas tab that has it open, then try again.`;

export async function deleteBrowserWorld(world: WorldRegistryEntry): Promise<BrowserDeleteResult> {
  if (!isBrowserWorld(world)) throw new Error('deleteBrowserWorld: not a browser world'); // raw-error-ok: a programming guard, never shown
  return enqueueActivationTask(async () => {
    const wasActive = getState().active?.worldId === world.id;
    if (wasActive) {
      // The rooms' pending saves land (or are refused) before the close, so
      // no debounced write reopens a file during the removal.
      await flushBeforeLeavingWorld();
    }
    if (getCurrentSyncWorldId() === world.id) detachSyncEngine();
    if (wasActive) {
      const store = getActiveStore();
      if (store) await store.close().catch(() => {});
      setActiveStore(null);
    }
    evictParkedStore(world.id);
    await awaitEviction(world.id);
    try {
      await removeBrowserWorldDir(world);
    } catch (error) {
      return { ok: false as const, error, wasActive };
    }
    // Removed: only now does the entry go.
    clearSyncIssues(world.id);
    const next = deleteWorldEntry(getState().registry, world.id);
    const listSaved = saveRegistry(next);
    patchSlice('registry', next);
    if (wasActive) {
      patchSlice('active', null);
      patchSlice('data', { elements: [] });
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
    }
    return { ok: true as const, listSaved };
  });
}
