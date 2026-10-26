/**
 * The world file: one `.zip` that holds one whole world, and the reader that
 * opens one back (1.17 bout 5, conv. 129; contract §5; Folder Format spec
 * §4.1 "a portable copy", Skeld 2026-10-04).
 *
 * THE PORTABLE COPY: every file of the world as it is on disk, except the
 * OnlyWorlds link and its key (`world.json` without `api`), the sync files
 * (`.atlas/sync-state.json`, `.atlas/tombstones.json`) and anything
 * transient (`isTransientPath`). One top-level folder, `<slug>-<id8>/`. JSON
 * is deflated, media stored as it is.
 *
 * THE FORMAT is the SDK's since 4.10 (`readWorldFile`, `writeWorldFile`;
 * Kael, 2026-10-11): one reader and writer for every tool. It refuses before
 * anything is written: a path that climbs out, is absolute or names a drive,
 * an empty path part, a path that is both a file and a folder, a declared size
 * or a file count past the budget, no world, more than one world or files
 * outside it. Atlas adds its own: the `.atlas/making/x` collision and the
 * tour's sandbox (`demo: true`), its own sentences for each refusal, and the
 * files it leaves out (sync and transient).
 */

import { readWorldFile, writeWorldFile, OwWorldFileError, type OwWorldFileReason } from '@onlyworlds/sdk';
import { unzipSync } from 'fflate';
import { PlainError } from '../core/plain-error';
import { ATLAS_INTERNAL_DIR, FOLDER_FORMAT_VERSION } from '../core/constants';
import { withProvenance, type ExportedAs, type WorldSource } from '../core/provenance';
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
// Folder Format §4.7's causes (SDK 4.49).
const DUPLICATE = 'That file is not a world Atlas can open: it holds the same file twice.';
const COLLISION = 'That file is not a world Atlas can open: two of its file names differ only in capitals or accents.';
const LINK = 'That file is not a world Atlas can open: it holds a link where a file should be.';
const METHOD = 'That file is not a world Atlas can open: it is locked with a password, or packed in a way Atlas cannot read.';
const NAME = 'That file is not a world Atlas can open: one of its file names is not allowed in a world.';
const MARKER = 'That file says it is something other than an OnlyWorlds world.';
// The writer refuses a name or a collision as the reader would; when Atlas writes, the names are this world's own.
const WRITE_NAME = 'This world holds a file whose name cannot go in a world file, so no file was made.';
const WRITE_COLLISION = 'This world holds two files whose names differ only in capitals or accents, so no file was made.';

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

/**
 * Files that belong to the folder's place, never to the world, so a world file
 * never carries them, whoever made it (the folder spec's §4.6 read):
 * a repository's `.git/` (its history can hold a key once committed) and
 * `.env` files (a seat's key lines kept beside a world). A template
 * (`.env.example`, `.env.sample`, `.env.template`) holds no secret, but since
 * SDK 4.49 the writer carries only §4.7's parts (OW-7: world.json, elements/,
 * spatial/, media/, records/ and the `.atlas/` it is handed), so no root file
 * travels anyway; this stays the first fence, before the writer.
 */
export function isFolderPrivate(path: string): boolean {
  const parts = path.split('/');
  if (parts.includes('.git')) return true;
  const base = parts[parts.length - 1].toLowerCase();
  if (base !== '.env' && !base.startsWith('.env.')) return false;
  return !/^\.env\.(example|sample|template)$/.test(base);
}

const isPortable = (path: string): boolean => !SYNC_FILES.has(path) && !isFolderPrivate(path);

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
 * One that will not parse is never handed over raw: it may hold a key,
 * so the download refuses.
 */
function withoutLink(data: Uint8Array): Uint8Array {
  let meta: unknown;
  try { meta = JSON.parse(new TextDecoder().decode(data)); } catch {
    throw new PlainError("This world's world.json will not open, so Atlas could not make a download. Fix the file, then try again.");
  }
  // A world.json that is not one object is refused the same way: it cannot be
  // a world, and an array's nested key would never be stripped.
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new PlainError("This world's world.json will not open, so Atlas could not make a download. Fix the file, then try again.");
  }
  if (!('api' in meta)) return data;
  const { api: _link, ...rest } = meta as Record<string, unknown>;
  return new TextEncoder().encode(JSON.stringify(rest, null, 2) + '\n');
}

/**
 * The collected files with the provenance lines in `world.json` (folder spec
 * §4.2; `core/provenance.ts`), and the spec version this file is written
 * against. Only the bytes that go into the file change: the world's own
 * world.json on disk is left as it is.
 */
export function withProvenanceLines(files: CollectedFile[], source: WorldSource, exportedAs: ExportedAs | null): CollectedFile[] {
  return files.map((f) => {
    if (f.path !== WORLD_FILE) return f;
    const meta = JSON.parse(new TextDecoder().decode(f.data)) as Record<string, unknown>;
    const stamped = { ...withProvenance(meta, source, exportedAs), format_version: FOLDER_FORMAT_VERSION };
    return { ...f, data: new TextEncoder().encode(JSON.stringify(stamped, null, 2) + '\n') };
  });
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

const RECORDS_MANIFEST = 'records/RECORDS.json';

/**
 * The world's records list will not read, so which records are private is
 * unknown, and nothing is left out by guess (folder spec §4.7 OW-8, v0.3.15;
 * Skeld 2026-10-22): the caller asks the person, or makes no file.
 */
export class RecordsListUnreadable extends PlainError {
  constructor() {
    super("This world's records list (records/RECORDS.json) cannot be read, so Atlas cannot tell which records are private. No file was made.");
  }
}

/**
 * The zip: one top-level folder, JSON deflated, everything else stored.
 * Records a producer marks private are left out unless `includePrivateRecords`
 * (folder spec §4.5 rule 11, §4.7 OW-8, v0.3.15; SDK 4.63.0): the SDK decides
 * which, and `leftOutRecords` reads its answer back from the file.
 */
export function zipWorld(files: WorldFileEntry[], topDir: string, opts: { includePrivateRecords?: boolean } = {}): Uint8Array {
  const includePrivateRecords = opts.includePrivateRecords === true;
  try {
    return writeWorldFile(files, topDir, { includePrivateRecords });
  } catch (err) {
    // Atlas's options are always well formed, so the writer's TypeError is
    // the records list it could not read (SDK 4.63.0).
    if (err instanceof TypeError && !includePrivateRecords && files.some(f => f.path === RECORDS_MANIFEST)) throw new RecordsListUnreadable();
    if (err instanceof OwWorldFileError && err.reason === 'name') throw new PlainError(WRITE_NAME);
    if (err instanceof OwWorldFileError && err.reason === 'collision') throw new PlainError(WRITE_COLLISION);
    throw new PlainError(err instanceof OwWorldFileError ? REFUSALS[err.reason] : NOT_OPENABLE);
  }
}

/**
 * The producers whose records the world had and the file does not: each
 * `records/<producer>` directory, as the world names it, that held files
 * going in and holds none in `zip`. Read from the file's own entry names
 * (nothing inflated), so the writer stays the one authority on what is private.
 */
export function leftOutRecords(files: WorldFileEntry[], zip: Uint8Array): string[] {
  const producerOf = (path: string): string | null => {
    const segs = path.split('/');
    return segs.length > 2 && segs[0] === 'records' ? segs[1] : null;
  };
  const had = new Set<string>();
  for (const f of files) {
    const p = producerOf(f.path);
    if (p !== null) had.add(p);
  }
  if (had.size === 0) return [];
  const kept = new Set<string>();
  unzipSync(zip, {
    filter: (entry) => {
      // Every entry sits under the one top-level folder.
      const p = producerOf(entry.name.slice(entry.name.indexOf('/') + 1));
      if (p !== null) kept.add(p);
      return false;
    },
  });
  return [...had].filter(p => !kept.has(p)).sort();
}

/** Each of the SDK's refusals, in Atlas's words. */
const REFUSALS: Record<OwWorldFileReason, string> = {
  unsafe_path: UNSAFE_PATH,
  too_big: TOO_BIG,
  too_many: TOO_MANY,
  not_a_world: NOT_A_WORLD,
  more_than_one: MORE_THAN_ONE,
  not_openable: NOT_OPENABLE,
  duplicate: DUPLICATE,
  collision: COLLISION,
  link: LINK,
  method: METHOD,
  name: NAME,
  marker: MARKER,
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
  // The format and its refusals are the SDK's (4.10, Kael 2026-10-11): one
  // reader for every tool. Atlas keeps its own sentences, its `.atlas/` rules
  // and the demo refusal.
  let read: ReturnType<typeof readWorldFile>;
  try {
    read = readWorldFile(bytes, {
      maxBytes: opts.maxBytes ?? WORLD_FILE_MAX_BYTES,
      maxEntries: opts.maxEntries ?? WORLD_FILE_MAX_ENTRIES,
      // The portable copy, whoever made the file: no sync or
      // transient files; the SDK already drops the link from world.json.
      skip: path => isTransientPath(path) || !isPortable(path),
    });
  } catch (err) {
    throw new PlainError(err instanceof OwWorldFileError ? REFUSALS[err.reason] : NOT_OPENABLE);
  }
  // A path under `.atlas/` whose first part is a transient FILE's name
  // (`.atlas/making/x`) would collide with the make's own marker.
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
