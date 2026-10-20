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
import { clearedOwnTwin, isQuotaError, openBrowserMake, withWorldLock, worldAlreadyHere } from '../core/browser-home';
import { createLocalWorld, saveRegistry, updateWorldEntry } from '../registry/registry';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';
import type { WorldFileEntry } from '../store/world-file';
import { diskApiBlock } from '../core/seat';

export type OpenWorldFileOutcome =
  | { kind: 'opened' | 'restored'; worldId: string }
  /** The same world is already in Atlas: nothing was written. */
  | { kind: 'already'; worldId: string }
  /** The where-question was cancelled: nothing was written. */
  | { kind: 'cancelled' };

export interface OpenWorldFileOpts {
  /**
   * Asked only when the file is a NEW world (never for a restore, never for
   * one already here), before anything is written (contract §5.2). The answer
   * itself is the caller's to act on: the world always lands in this browser
   * first, and a folder answer is the §4 move after it opens. Null cancels.
   */
  chooseWhere?: () => Promise<'browser' | 'folder' | null>;
  /** Each file written, with the count so far and the total (world.json last). */
  onWritten?: (done: number, total: number) => void;
}

const REGISTRY_NOT_SAVED =
  'Atlas could not save its list of worlds in this browser, so the world file was not opened. Free some space in this browser, then try again.';

/** World ids being opened from a file in this tab. */
const opening = new Set<string>();

/** What the file is, against the registry as it is now. */
function placeOf(reg: WorldsRegistry, worldId: string): { restore: WorldRegistryEntry | null; already: WorldRegistryEntry | null } {
  const restore = clearedOwnTwin(reg, worldId);
  if (restore) return { restore, already: null };
  const here = worldAlreadyHere(reg, worldId);
  // A cleared world that is not this one (matched through a former link)
  // does not stand in the way: the file opens as its own (gate F7).
  const blocks = here && !(isBrowserWorld(here) && here.cleared_at);
  return { restore: null, already: blocks ? here! : null };
}

/**
 * Files written at once. One at a time, Firefox's browser storage took 16 s
 * for Moppetopia's 320 files against Chromium's 1.2 s (S407, Boss h57 #4679);
 * each file's lookups and writer cost it about 50 ms, and they overlap.
 */
export const WRITE_CONCURRENCY = 8;

export async function writeAll(dir: FileSystemDirectoryHandle, files: WorldFileEntry[], worldJson: Uint8Array, onWritten?: (done: number, total: number) => void): Promise<void> {
  // Each folder is looked up (and made) once, however many files land in it.
  const dirs = new Map<string, Promise<FileSystemDirectoryHandle>>();
  const dirFor = (segs: string[]): Promise<FileSystemDirectoryHandle> => {
    if (segs.length === 0) return Promise.resolve(dir);
    const key = segs.join('/');
    let p = dirs.get(key);
    if (!p) {
      p = dirFor(segs.slice(0, -1)).then(parent => parent.getDirectoryHandle(segs[segs.length - 1], { create: true }));
      dirs.set(key, p);
    }
    return p;
  };
  const write = async (path: string, data: Uint8Array): Promise<void> => {
    const segs = path.split('/');
    const d = await dirFor(segs.slice(0, -1));
    const w = await (await d.getFileHandle(segs[segs.length - 1], { create: true })).createWritable();
    try {
      await w.write(data as unknown as BufferSource);
      await w.close();
    } catch (err) {
      await w.abort().catch(() => {});
      throw err;
    }
  };
  const rest = files.filter(f => f.path !== 'world.json');
  const total = rest.length + 1;
  let done = 0;
  let next = 0;
  let failed = false;
  const lane = async (): Promise<void> => {
    while (!failed && next < rest.length) {
      const f = rest[next++];
      try {
        await write(f.path, f.data);
        onWritten?.(++done, total);
      } catch (err) {
        failed = true; // no lane starts another file; the caller removes the half-made world
        throw err;
      }
    }
  };
  const lanes = Array.from({ length: Math.min(WRITE_CONCURRENCY, rest.length) }, lane);
  const settled = await Promise.allSettled(lanes);
  const refused = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
  if (refused) throw refused.reason;
  await write('world.json', worldJson); // last: nothing says "world" until every other file landed
  onWritten?.(total, total);
}

/** Open a world file's bytes. Refusals throw a `PlainError`, having written nothing. */
export async function openWorldFile(bytes: Uint8Array, opts: OpenWorldFileOpts = {}): Promise<OpenWorldFileOutcome> {
  const { readWorldZip } = await import('../store/world-file');
  const read = readWorldZip(bytes);
  if (opening.has(read.worldId)) throw new PlainError('This world file is already opening.');
  opening.add(read.worldId);
  try {
    return await withWorldLock(`open-${read.worldId}`, () => openRead(read, opts));
  } finally {
    opening.delete(read.worldId);
  }
}

async function openRead(read: { worldId: string; worldName: string; files: WorldFileEntry[] }, opts: OpenWorldFileOpts): Promise<OpenWorldFileOutcome> {
  const first = placeOf(getState().registry, read.worldId);
  if (first.already) return { kind: 'already', worldId: first.already.id };
  const restore = first.restore;
  if (!restore && opts.chooseWhere && !(await opts.chooseWhere())) return { kind: 'cancelled' };

  let worldJson = read.files.find(f => f.path === 'world.json')!.data;
  if (restore?.api) {
    // The link goes back from this browser's registry, never from the file.
    // A file's provenance lines are about the file's slice; the link going back
    // is this browser's own, so they go (the S446 gate's G3: a guest's file
    // would otherwise call the owner's world one Character's view for good).
    const { source: _source, exported_as: _slice, ...meta } = JSON.parse(new TextDecoder().decode(worldJson)) as Record<string, unknown>;
    // diskApiBlock: the mirrored flags, never a seat's secret (conv. 132);
    // these bytes skip the store's writeWorldMeta and its strip.
    worldJson = new TextEncoder().encode(JSON.stringify({ ...meta, api: diskApiBlock(restore.api) }, null, 2) + '\n');
  }

  const make = await openBrowserMake(read.worldName, read.worldId);
  try {
    await writeAll(make.handle, read.files, worldJson, opts.onWritten);
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
