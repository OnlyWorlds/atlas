/**
 * Bring it down again (1.17, conv. 129; contract §3.3; S370 gate lens B B16;
 * Skeld h20 #511): a LINKED world the browser cleared comes back from
 * onlyworlds.com under its own row.
 *
 * A named restore, not the link flow: the link would refuse (the cleared row
 * is the same world), make a second entry, and write the SERVER's id into
 * world.json, while a world made here and taken online keeps its own. So:
 * a fresh nonced directory through the make protocol (never the old name,
 * gate B6), world.json with the entry's OWN world id and the `api` block this
 * browser holds for that exact world, the whole download (a full origin is
 * fatal), then the SAME entry updated: its new directory, `cleared_at` gone,
 * and `review_first_sync`, so its first sync reviews before it writes. Any
 * failure removes the directory and leaves the row as it was.
 *
 * S374 gate: one restore per row across tabs (a Web Lock, the stored registry
 * re-read before the commit, F4); the whole run on the activation chain (F2);
 * and the world that was open stays open until the restored entry's save has
 * landed, so a refusal or a lost save never strands it without a store (F1).
 */

import { getState, patchSlice } from '../core/state';
import { setActiveStore, evictParkedStore, awaitEviction } from '../core/active-store';
import { enqueueActivationTask } from '../core/activation-chain';
import { withWorldLock } from '../core/browser-home';
import { PlainError } from '../core/plain-error';
import { isBrowserWorld, removeBrowserWorldDir } from '../core/browser-worlds';
import { saveRegistry, setActiveWorld, storedRegistry, updateWorldEntry } from '../registry/registry';
import { initialDownloadAll, type InitialDownloadProgress } from '../sync/initial-download';
import { buildV2Adapter } from '../sync/make-online';
import { attachSyncEngine } from '../sync/sync-attach';
import { abandonBrowserMake, releasePriorWorld, scaffoldBrowserWorld } from './atlas-root-flow';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';

/**
 * The world.json id this entry was made with. Every `handle_key` is
 * `world-<world.json id>`, read whole; the one exception is the link flows'
 * `-N` suffix on a second link of the same world, where the id is the
 * server's (S374 gate F3: never strip a suffix by its shape, since an id may
 * itself end in `-7`).
 */
export function ownWorldIdOf(entry: Pick<WorldRegistryEntry, 'folder' | 'api'>): string {
  const key = entry.folder.handle_key;
  const server = entry.api?.world_id;
  if (server && key.startsWith(`world-${server}-`) && /^\d+$/.test(key.slice(`world-${server}-`.length))) return server;
  return key.replace(/^world-/, '');
}

const REGISTRY_NOT_SAVED =
  'Atlas could not save its list of worlds in this browser, so the world was not brought back. Free some space in this browser, then try again.';
const CHANGED_ELSEWHERE =
  'This world changed in another tab while it was downloading. Look at its row, then try again.';

const NOT_CLEARED_NOW = 'This world is no longer cleared: another tab may have brought it back. Look at its row.';

export interface BringDownAgainOpts {
  onProgress?: (p: InitialDownloadProgress) => void;
}

/** The row as storage holds it now (another tab's save lands there first), else as this tab holds it. */
function entryNow(worldId: string): WorldRegistryEntry | undefined {
  let stored: WorldsRegistry | null = null;
  try { stored = storedRegistry(); } catch { stored = null; }
  return stored?.worlds.find(w => w.id === worldId) ?? getState().registry.worlds.find(w => w.id === worldId);
}

export function bringDownAgain(
  worldId: string,
  opts: BringDownAgainOpts = {},
): Promise<{ entry: WorldRegistryEntry; downloaded: number; failures: number }> {
  return withWorldLock(`bring-${worldId}`, () => enqueueActivationTask(() => run(worldId, opts)));
}

async function run(worldId: string, opts: BringDownAgainOpts): Promise<{ entry: WorldRegistryEntry; downloaded: number; failures: number }> {
  const entry = entryNow(worldId);
  if (!entry || !isBrowserWorld(entry) || entry.demo === true) {
    throw new PlainError('Only a world this browser cleared can be downloaded again.');
  }
  if (!entry.cleared_at) throw new PlainError(NOT_CLEARED_NOW);
  if (!entry.api?.api_key || !entry.api.world_id) {
    throw new PlainError('This world was never online, so there is no copy to download. Open a world file of it instead.');
  }
  const readOnly = !!entry.api.read_only;
  const pin = readOnly ? '' : (getState().registry.pin ?? '');
  if (!readOnly && !pin) {
    throw new PlainError('Atlas needs your OnlyWorlds PIN to download this world. Enter it in Settings, under OnlyWorlds, then try again.');
  }
  const ownId = ownWorldIdOf(entry);
  const oldDir = entry.folder.folder_name;
  // No parked store may hold a handle into this world any more (gate B6).
  evictParkedStore(entry.id);
  await awaitEviction(entry.id);

  const { store, subName, make } = await scaffoldBrowserWorld(entry.name, ownId);
  let downloaded;
  try {
    await store.writeWorldMeta({ id: ownId, name: entry.name, api: { ...entry.api } });
    downloaded = await initialDownloadAll(store, buildV2Adapter(entry.api.api_key, pin), opts.onProgress, undefined, { stopOnQuota: true });
  } catch (err) {
    return abandonBrowserMake(store, make, err, 'downloading the world');
  }

  // The commit: the restored entry, saved strictly, while the world that was
  // open is still open (gate F1). Against the row as it is NOW: nothing
  // commits over another tab's answer.
  try {
    await make.finish(() => {
      const now = entryNow(worldId);
      if (!now || !now.cleared_at || now.folder.folder_name !== oldDir) throw new PlainError(CHANGED_ELSEWHERE);
      const next = updateWorldEntry(getState().registry, worldId, {
        cleared_at: undefined,
        review_first_sync: true,
        folder: { ...now.folder, folder_name: subName, last_path_hint: `browser storage/${subName}` },
      });
      if (!saveRegistry(next)) throw new PlainError(REGISTRY_NOT_SAVED);
      patchSlice('registry', next);
    });
  } catch (err) {
    await store.close().catch(() => {});
    await removeBrowserWorldDir({ where: 'browser', folder: { handle_key: '', folder_name: subName } }).catch(() => {});
    throw err;
  }

  // Committed: only now leave the world that was open (conv. 98), then open this one.
  await releasePriorWorld();
  const activated = setActiveWorld(getState().registry, worldId);
  saveRegistry(activated);
  patchSlice('registry', activated);
  const restored = activated.worlds.find(w => w.id === worldId)!;
  if (readOnly) store.setViewOnly(true);
  setActiveStore(store);
  patchSlice('active', { worldId, meta: { id: ownId, name: entry.name }, opened: true });
  try {
    patchSlice('data', { elements: await store.listElements() });
  } catch (err) {
    console.warn('[bring-down-again] could not prime the elements:', err);
    patchSlice('data', { elements: [] });
  }
  patchSlice('ui', { ...getState().ui, selectedElementId: null });
  attachSyncEngine(restored, store);
  return { entry: restored, downloaded: downloaded.totalDownloaded, failures: downloaded.failures.length };
}
