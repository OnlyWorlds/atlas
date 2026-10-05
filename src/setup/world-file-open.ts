/**
 * Open a world file (1.17 bout 5, conv. 129; contract §5.2, §9 invariants 6
 * and 14; S370 gate lens A A8, A9, lens B B6, B16; Skeld h20 #511; S373
 * world-file gate F2, F5-F7).
 *
 * The reader (`store/world-file.ts`) refuses an unsafe or foreign file before
 * anything is written, and hands over the portable copy whoever made the file
 * (no link, no key, no sync files). A world already here, under any spelling
 * of its identity, is refused ("Open it" is the caller's). A world the
 * browser CLEARED, matched by its own id, is restored: the file is unpacked
 * into a fresh directory under the SAME entry; a linked one gets its `api`
 * block back from this browser's registry (the exact world id, the user
 * asked, and its sync reviews before it writes). A cleared world matched only
 * through a former link is not this world: the file opens as its own. Every
 * landing is a make (`openBrowserMake`: the Web Lock, `.atlas/making`,
 * world.json last, a failure removes the directory, a full origin is fatal).
 *
 * ONE OPEN PER WORLD AT A TIME (gate F2): a second open of the same world
 * while one runs is refused in this tab and waits on a Web Lock across tabs,
 * and the identity is checked again just before the commit. The commit's
 * registry save must land, or the directory goes (gate F6).
 */

import { getState, patchSlice } from '../core/state';
import { PlainError } from '../core/plain-error';
import { browserStorageFullSentence } from '../core/problems';
import { isBrowserWorld, removeBrowserWorldDir } from '../core/browser-worlds';
import { isOwnHandleKey, isQuotaError, openBrowserMake, withWorldLock, worldAlreadyHere } from '../core/browser-home';
import { createLocalWorld, saveRegistry, updateWorldEntry } from '../registry/registry';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';
import type { WorldFileEntry } from '../store/world-file';

export type OpenWorldFileOutcome =
  | { kind: 'opened' | 'restored'; worldId: string }
  /** The same world is already in Atlas: nothing was written. */
  | { kind: 'already'; worldId: string };

const REGISTRY_NOT_SAVED =
  'Atlas could not save its list of worlds in this browser, so the world file was not opened. Free some space in this browser, then try again.';

/** World ids being opened from a file in this tab. */
const opening = new Set<string>();

/** The entry this file restores: a browser world the browser cleared, holding this EXACT world id. */
function restoreTarget(reg: WorldsRegistry, worldId: string): WorldRegistryEntry | null {
  const here = worldAlreadyHere(reg, worldId);
  if (!here || !isBrowserWorld(here) || !here.cleared_at || here.demo === true) return null;
  // Skeld's second condition: the link goes back only to the world it was
  // made for, never to one matched through a former link.
  return isOwnHandleKey(here.folder.handle_key, worldId) || here.api?.world_id === worldId ? here : null;
}

/** What the file is, against the registry as it is now. */
function placeOf(reg: WorldsRegistry, worldId: string): { restore: WorldRegistryEntry | null; already: WorldRegistryEntry | null } {
  const restore = restoreTarget(reg, worldId);
  if (restore) return { restore, already: null };
  const here = worldAlreadyHere(reg, worldId);
  // A cleared world that is not this one (matched through a former link)
  // does not stand in the way: the file opens as its own (gate F7).
  const blocks = here && !(isBrowserWorld(here) && here.cleared_at);
  return { restore: null, already: blocks ? here! : null };
}

async function writeAll(dir: FileSystemDirectoryHandle, files: WorldFileEntry[], worldJson: Uint8Array): Promise<void> {
  const write = async (path: string, data: Uint8Array): Promise<void> => {
    let d = dir;
    const segs = path.split('/');
    for (const seg of segs.slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
    const w = await (await d.getFileHandle(segs[segs.length - 1], { create: true })).createWritable();
    try {
      await w.write(data as unknown as BufferSource);
      await w.close();
    } catch (err) {
      await w.abort().catch(() => {});
      throw err;
    }
  };
  for (const f of files) if (f.path !== 'world.json') await write(f.path, f.data);
  await write('world.json', worldJson); // last: nothing says "world" until every other file landed
}

/** Open a world file's bytes. Refusals throw a `PlainError`, having written nothing. */
export async function openWorldFile(bytes: Uint8Array): Promise<OpenWorldFileOutcome> {
  const { readWorldZip } = await import('../store/world-file');
  const read = readWorldZip(bytes);
  if (opening.has(read.worldId)) throw new PlainError('This world file is already opening.');
  opening.add(read.worldId);
  try {
    return await withWorldLock(`open-${read.worldId}`, () => openRead(read));
  } finally {
    opening.delete(read.worldId);
  }
}

async function openRead(read: { worldId: string; worldName: string; files: WorldFileEntry[] }): Promise<OpenWorldFileOutcome> {
  const first = placeOf(getState().registry, read.worldId);
  if (first.already) return { kind: 'already', worldId: first.already.id };
  const restore = first.restore;

  let worldJson = read.files.find(f => f.path === 'world.json')!.data;
  if (restore?.api) {
    // The link goes back from this browser's registry, never from the file.
    const meta = JSON.parse(new TextDecoder().decode(worldJson)) as Record<string, unknown>;
    worldJson = new TextEncoder().encode(JSON.stringify({ ...meta, api: restore.api }, null, 2) + '\n');
  }

  const make = await openBrowserMake(read.worldName, read.worldId);
  try {
    await writeAll(make.handle, read.files, worldJson);
  } catch (err) {
    await make.abort().catch(e => console.warn('[world-file] could not remove the half-made world', e)); // raw-error-ok: a console record
    if (isQuotaError(err)) throw new PlainError(browserStorageFullSentence('opening the world file'));
    throw err;
  }

  // Again, against the registry as it is now (another tab may have finished
  // the same world meanwhile): nothing commits over a changed answer.
  const now = placeOf(getState().registry, read.worldId);
  const same = now.restore
    ? !!restore && now.restore.id === restore.id && now.restore.folder.folder_name === restore.folder.folder_name
    : !restore && !now.already;
  if (!same) {
    await make.abort().catch(() => {});
    const here = worldAlreadyHere(getState().registry, read.worldId);
    if (here) return { kind: 'already', worldId: here.id };
    throw new PlainError('This world changed in another tab while the file was opening. Try again.');
  }

  let worldId: string;
  let next: WorldsRegistry;
  if (restore) {
    worldId = restore.id;
    next = updateWorldEntry(getState().registry, restore.id, {
      cleared_at: undefined,
      folder: { ...restore.folder, folder_name: make.dir, last_path_hint: `browser storage/${make.dir}` },
      ...(restore.api ? { review_first_sync: true } : {}),
    });
  } else {
    const made = createLocalWorld(getState().registry, {
      name: read.worldName,
      folderName: make.dir,
      handleKey: `world-${read.worldId}`,
      pathHint: `browser storage/${make.dir}`,
    });
    worldId = made.entry.id;
    next = updateWorldEntry(made.next, worldId, { where: 'browser' });
  }
  try {
    await make.finish(() => {
      if (!saveRegistry(next)) throw new PlainError(REGISTRY_NOT_SAVED);
      patchSlice('registry', next);
    });
  } catch (err) {
    // A lost save is no commit (gate F6): the directory it would have named goes.
    await removeBrowserWorldDir({ where: 'browser', folder: { handle_key: '', folder_name: make.dir } }).catch(() => {});
    throw err;
  }
  return { kind: restore ? 'restored' : 'opened', worldId };
}
