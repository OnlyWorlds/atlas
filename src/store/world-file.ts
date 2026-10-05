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
 * THE READER refuses before anything is written: a path that climbs out, is
 * absolute or names a drive, an empty path part, a declared size or a file
 * count past the budget, no world, more than one world or files outside it,
 * and the tour's sandbox. Transient files and archive junk are dropped.
 */

import { unzipSync, zipSync, type Unzipped, type Zippable } from 'fflate';
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
  const input: Zippable = {};
  for (const f of files) {
    input[`${topDir}/${f.path}`] = [f.data, { level: /\.json$/i.test(f.path) ? 6 : 0 }];
  }
  return zipSync(input);
}

/** Archive junk a re-zipped folder picks up on the way: never part of a world. */
function isJunk(path: string): boolean {
  return path.split('/').some(seg => seg === '__MACOSX' || seg === '.DS_Store' || seg === 'Thumbs.db');
}

function isSafePath(path: string): boolean {
  if (!path || path.includes('\\') || path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false;
  return path.split('/').every(seg => seg !== '' && seg !== '.' && seg !== '..');
}

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
  const maxBytes = opts.maxBytes ?? WORLD_FILE_MAX_BYTES;
  const maxEntries = opts.maxEntries ?? WORLD_FILE_MAX_ENTRIES;
  let declared = 0;
  let count = 0;
  let refusal: string | null = null;
  let raw: Unzipped;
  try {
    raw = unzipSync(bytes, {
      filter: file => {
        if (refusal) return false;
        if (file.name.endsWith('/')) return false; // a directory entry
        if (!isSafePath(file.name)) { refusal = UNSAFE_PATH; return false; }
        if (isJunk(file.name)) return false;
        count++;
        declared += file.originalSize;
        if (count > maxEntries) { refusal = TOO_MANY; return false; }
        if (declared > maxBytes) { refusal = TOO_BIG; return false; }
        return true;
      },
    });
  } catch {
    throw new PlainError(refusal ?? NOT_OPENABLE);
  }
  if (refusal) throw new PlainError(refusal);
  const names = Object.keys(raw);
  // A declared size can lie; the inflated bytes cannot.
  if (names.reduce((n, k) => n + raw[k].length, 0) > maxBytes) throw new PlainError(TOO_BIG);

  // Exactly one world: world.json at the root, or in the one top-level folder.
  let prefix: string;
  if (names.includes(WORLD_FILE)) {
    // A world at the root holds no other world inside it (S373 gate F10).
    if (names.some(n => n !== WORLD_FILE && n.endsWith(`/${WORLD_FILE}`))) throw new PlainError(MORE_THAN_ONE);
    prefix = '';
  } else {
    const tops = new Set(names.map(n => (n.includes('/') ? n.split('/')[0] + '/' : n)));
    const worldTops = [...tops].filter(t => t.endsWith('/') && names.includes(`${t}${WORLD_FILE}`));
    if (worldTops.length === 0) throw new PlainError(NOT_A_WORLD);
    if (worldTops.length > 1 || tops.size > 1) throw new PlainError(MORE_THAN_ONE);
    prefix = worldTops[0];
    // Nor does a world in its one folder (S376 gate B10: F10 ran only at the root).
    if (names.some(n => n !== `${prefix}${WORLD_FILE}` && n.endsWith(`/${WORLD_FILE}`))) throw new PlainError(MORE_THAN_ONE);
  }
  // A path under `.atlas/` whose first part is a transient FILE's name
  // (`.atlas/making/x`) would collide with the make's own marker (S376 gate B10).
  for (const name of names) {
    const path = name.slice(prefix.length);
    if (!path.startsWith(`${ATLAS_INTERNAL_DIR}/`)) continue;
    const rest = path.slice(ATLAS_INTERNAL_DIR.length + 1);
    if (rest.includes('/') && isTransientPath(`${ATLAS_INTERNAL_DIR}/${rest.split('/')[0]}`)) throw new PlainError(NOT_OPENABLE);
  }

  let meta: { id?: unknown; name?: unknown; demo?: unknown };
  try {
    meta = JSON.parse(new TextDecoder().decode(raw[`${prefix}${WORLD_FILE}`]));
  } catch {
    throw new PlainError(NOT_A_WORLD);
  }
  if (!meta || typeof meta !== 'object' || typeof meta.id !== 'string' || !meta.id.trim()) throw new PlainError(NOT_A_WORLD);
  if (meta.demo === true) throw new PlainError(NOT_OPENABLE);

  // The portable copy, whoever made the file (S373 gate F5): no sync files,
  // and no link or key in world.json; a restore puts this browser's back.
  const files: WorldFileEntry[] = [];
  for (const name of names) {
    const path = name.slice(prefix.length);
    if (isTransientPath(path) || !isPortable(path)) continue;
    files.push({ path, data: path === WORLD_FILE ? withoutLink(raw[name]) : raw[name] });
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    worldId: meta.id,
    worldName: typeof meta.name === 'string' && meta.name.trim() ? meta.name : 'Untitled world',
    files,
  };
}
