/**
 * The world file: one `.zip` that holds one whole world, and the reader that
 * opens one back (1.17 bout 5, conv. 129; contract §5; Folder Format spec
 * §4.1 "a portable copy", Skeld #507).
 *
 * THE PORTABLE COPY: every file of the world as it is on disk, except the
 * OnlyWorlds link and its key (`world.json` without `api`), the sync files
 * (`.atlas/sync-state.json`, `.atlas/tombstones.json`) and anything
 * transient (`isTransientPath`). One top-level folder, `<slug>-<id8>/`. JSON
 * is deflated, media stored as it is.
 *
 * THE FORMAT is the SDK's since 4.10 (`readWorldFile`, `writeWorldFile`;
 * Kael, h37 #3348): one reader and writer for every tool. It refuses before
 * anything is written: a path that climbs out, is absolute or names a drive,
 * an empty path part, a path that is both a file and a folder, a declared size
 * or a file count past the budget, no world, more than one world or files
 * outside it. Atlas adds its own: the `.atlas/making/x` collision and the
 * tour's sandbox (`demo: true`), its own sentences for each refusal, and the
 * files it leaves out (sync and transient).
 */

import { readWorldFile, writeWorldFile, OwWorldFileError, type OwWorldFileReason } from '@onlyworlds/sdk';
import { PlainError } from '../core/plain-error';
import { ATLAS_INTERNAL_DIR } from '../core/constants';
import { isTransientPath, walkWorld, worldFileName, WORLD_FILE_MAX_BYTES, WORLD_FILE_MAX_ENTRIES } from './world-tree';

const WORLD_FILE = 'world.json';
/** Left out of a portable copy: they describe this browser's sync, not the world. */
const SYNC_FILES = new Set([`${ATLAS_INTERNAL_DIR}/sync-state.json`, `${ATLAS_INTERNAL_DIR}/tombstones.json`]);

export const NOT_A_WORLD = 'That file is not a world: it has no world.json.';
export const NOT_OPENABLE = 'That file is not a world Atlas can open.';
const UNSAFE_PATH = 'That file is not a world Atlas can open: one of its paths cannot be opened safely.';
const MORE_THAN_ONE = 'That file holds more than one world, or files outside the world\'s folder. Atlas opens one world at a time.';
const TOO_BIG = 'That file is too big to open in this browser.';
const TOO_MANY = 'That file has too many files to be a world Atlas can open.';

export { WORLD_FILE_MAX_BYTES, WORLD_FILE_MAX_ENTRIES };

export interface WorldFileEntry {
  /** Relative to the world's folder, `/`-separated. */
  path: string;
  data: Uint8Array;
}

/** A collected file, with the stamp the torn check compares (contract §5.1, gate A11). */
export interface CollectedFile extends WorldFileEntry {
  stamp: string;
}

export { worldFileName };

const isPortable = (path: string): boolean => !SYNC_FILES.has(path);

/** Every file of the portable copy, read once, each with the stamp it had when read. */
export async function collectWorldFiles(dir: FileSystemDirectoryHandle): Promise<CollectedFile[]> {
  const out: CollectedFile[] = [];
  for (const f of await walkWorld(dir)) {
    if (!isPortable(f.path)) continue;
    const file = await f.handle.getFile();
    let data: Uint8Array = new Uint8Array(await file.arrayBuffer());
    if (f.path === WORLD_FILE) data = withoutLink(data);
    out.push({ path: f.path, data, stamp: `${file.size}:${file.lastModified}` });
  }
  return out;
}

/**
 * `world.json` without its `api` block (the link and its key never travel).
 * One that will not parse is never handed over raw: it may hold a key
 * (S373 gate F9), so the download refuses.
 */
function withoutLink(data: Uint8Array): Uint8Array {
  let meta: unknown;
  try { meta = JSON.parse(new TextDecoder().decode(data)); } catch {
    throw new PlainError("This world's world.json will not open, so Atlas could not make a download. Fix the file, then try again.");
  }
  if (!meta || typeof meta !== 'object' || !('api' in meta)) return data;
  const { api: _link, ...rest } = meta as Record<string, unknown>;
  return new TextEncoder().encode(JSON.stringify(rest, null, 2) + '\n');
}

/**
 * The stamps of the portable copy's files as they are NOW. Equal to the
 * collected stamps, path for path, means nothing changed while the file was
 * made (a file added mid-walk shows as a new path).
 */
export async function portableStamps(dir: FileSystemDirectoryHandle): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const f of await walkWorld(dir)) {
    if (!isPortable(f.path)) continue;
    const file = await f.handle.getFile();
    out.set(f.path, `${file.size}:${file.lastModified}`);
  }
  return out;
}

export function sameStamps(collected: CollectedFile[], now: Map<string, string>): boolean {
  if (collected.length !== now.size) return false;
  return collected.every(f => now.get(f.path) === f.stamp);
}

/** The zip: one top-level folder, JSON deflated, everything else stored. */
export function zipWorld(files: WorldFileEntry[], topDir: string): Uint8Array {
  try {
    return writeWorldFile(files, topDir);
  } catch (err) {
    throw new PlainError(err instanceof OwWorldFileError ? REFUSALS[err.reason] : NOT_OPENABLE);
  }
}

/** Each of the SDK's refusals, in Atlas's words. */
const REFUSALS: Record<OwWorldFileReason, string> = {
  unsafe_path: UNSAFE_PATH,
  too_big: TOO_BIG,
  too_many: TOO_MANY,
  not_a_world: NOT_A_WORLD,
  more_than_one: MORE_THAN_ONE,
  not_openable: NOT_OPENABLE,
};

export interface ReadWorld {
  worldId: string;
  worldName: string;
  /** The world's files, relative to its folder, `world.json` included, sorted by path. */
  files: WorldFileEntry[];
}

/**
 * Read a world file. Throws a `PlainError` that says why, having written
 * nothing (the caller writes only what this returns).
 */
export function readWorldZip(
  bytes: Uint8Array,
  opts: { maxBytes?: number; maxEntries?: number } = {},
): ReadWorld {
  // The format and its refusals are the SDK's (4.10, Kael h37 #3348): one
  // reader for every tool. Atlas keeps its own sentences, its `.atlas/` rules
  // and the demo refusal.
  let read: ReturnType<typeof readWorldFile>;
  try {
    read = readWorldFile(bytes, {
      maxBytes: opts.maxBytes ?? WORLD_FILE_MAX_BYTES,
      maxEntries: opts.maxEntries ?? WORLD_FILE_MAX_ENTRIES,
      // The portable copy, whoever made the file (S373 gate F5): no sync or
      // transient files; the SDK already drops the link from world.json.
      skip: path => isTransientPath(path) || !isPortable(path),
    });
  } catch (err) {
    throw new PlainError(err instanceof OwWorldFileError ? REFUSALS[err.reason] : NOT_OPENABLE);
  }
  // A path under `.atlas/` whose first part is a transient FILE's name
  // (`.atlas/making/x`) would collide with the make's own marker (S376 gate B10).
  for (const { path } of read.files) {
    if (!path.startsWith(`${ATLAS_INTERNAL_DIR}/`)) continue;
    const rest = path.slice(ATLAS_INTERNAL_DIR.length + 1);
    if (rest.includes('/') && isTransientPath(`${ATLAS_INTERNAL_DIR}/${rest.split('/')[0]}`)) throw new PlainError(NOT_OPENABLE);
  }
  if (read.world.demo === true) throw new PlainError(NOT_OPENABLE);
  return {
    worldId: read.worldId,
    worldName: read.name.trim() ? read.name : 'Untitled world',
    files: read.files,
  };
}
