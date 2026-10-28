/**
 * A landing that fails after its door committed (#865, contract L9'): the
 * world was open from memory and its files could not all reach browser
 * storage (a full origin, a refused write). The world closes (or its parked
 * store goes), its directory is removed, its row is marked cleared like any
 * browser world whose directory is gone, and one toast says why and what was
 * lost. A failure before the commit is the door's own (`abandonLanding`):
 * nothing here acts on a directory no entry names yet, and the door asks
 * `settleIfLandingFailed` right after its commit for the one that failed in
 * between. Each directory is settled once.
 */
import { getState, patchSlice } from '../core/state';
import { getActiveStore, setActiveStore, evictParkedStore, awaitEviction } from '../core/active-store';
import { enqueueActivationTask } from '../core/activation-chain';
import { isBrowserWorld, markWorldCleared, removeBrowserWorldDir } from '../core/browser-worlds';
import { saveRegistry } from '../registry/registry';
import { detachSyncEngine, getCurrentSyncWorldId } from '../sync/sync-attach';
import { forgetLanding, onLandingFailed, type Landing } from '../store/land-behind';
import { showProblem } from '../ui/problem-fixes';
import { toastManager } from '../ui/toast-manager';
import { navigate } from '../core/router';

const settled = new Set<string>();

/** Registered once at boot; answers its unsubscribe. */
export function watchFailedLandings(): () => void {
  return onLandingFailed(landing => { void settleIfLandingFailed(landing); });
}

/** Clean up a failed landing whose world is in the registry; a no-op otherwise or a second time. */
export async function settleIfLandingFailed(landing: Landing): Promise<void> {
  if (landing.state !== 'failed' || settled.has(landing.dir)) return;
  const entryNow = () => getState().registry.worlds.find(w => isBrowserWorld(w) && w.folder.folder_name === landing.dir);
  if (!entryNow()) return; // before the commit: the door's
  settled.add(landing.dir);
  const lost = landing.pendingEdits;
  await enqueueActivationTask(async () => {
    const entry = entryNow();
    if (!entry) { forgetLanding(landing.dir); return; }
    const wasActive = getState().active?.worldId === entry.id;
    if (getCurrentSyncWorldId() === entry.id) detachSyncEngine();
    if (wasActive) {
      const store = getActiveStore();
      if (store) await store.close().catch(() => {});
      setActiveStore(null);
      patchSlice('active', null);
      patchSlice('data', { elements: [] });
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
    }
    evictParkedStore(entry.id);
    await awaitEviction(entry.id);
    await removeBrowserWorldDir(entry).catch(err => console.warn('[landing] could not remove the half-landed world', err)); // raw-error-ok: a console record
    if (!entry.cleared_at) {
      const marked = markWorldCleared(getState().registry, entry.id);
      saveRegistry(marked);
      patchSlice('registry', marked);
    }
    forgetLanding(landing.dir);
    showProblem(landing.error, { doing: `saving "${entry.name}" in this browser`, worldId: entry.id, toasts: toastManager });
    const changes = lost === 0 ? ''
      : entry.api?.api_key ? ' Changes made since it opened may not have been saved.'
        : ' The changes made since it opened were not saved.';
    const back = entry.api?.api_key ? 'Its row can bring it back from onlyworlds.com.' : 'Its row can bring it back from a world file.';
    toastManager.info(`"${entry.name}" was not kept in this browser.${changes} ${back}`, 15_000);
    if (wasActive) navigate('#/');
  });
}
