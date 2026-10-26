/**
 * A world as a tree of files: walk it, copy it byte for byte, verify a copy
 * (1.17 bout 4, conv. 129; contract §4.1). Shared by Move to a folder, and by
 * the download and the world-file unpack still to come (bout 5).
 *
 * TRANSIENT files never travel: the lock, the make marker, every move file,
 * the re-key journal, and the browser's swap and staging files. A move's own
 * journal riding into the copy is how a later recovery could have deleted a
 * user's folder, so `isTransientPath` is the ONE skip
 * predicate every walker uses.
 *
 * The copy writes `.atlas/move-incoming.json` (this move's token) FIRST and
 * `world.json` LAST: until the token's last file lands nothing in the
 * destination says "world", and recovery removes a destination only when its
 * token carries the move's id (invariant 6, gate A1).
 */

import { PlainError } from '../core/plain-error';
import { ATLAS_INTERNAL_DIR } from '../core/constants';
import { slugify } from './fs-utils';

export const MOVE_INCOMING_FILE = 'move-incoming.json';
const WORLD_FILE = 'world.json';

/**
 * A world file's name and its one top-level folder: `hollow-reach-2026-10-05.zip`
 * holding `hollow-reach-0192a000/` (contract §5.1). Here, not beside the zip
 * code, so a click can name the file before the zip library loads.
 */
export function worldFileName(name: string, worldId: string, now = new Date()): { file: string; dir: string } {
  const slug = slugify(name) || 'world';
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return { file: `${slug}-${day}.zip`, dir: `${slug}-${worldId.slice(0, 8)}` };
}

/**
 * A world file's budget, uncompressed (the writer and the reader agree). The
 * SDK's, which is Folder Format §4.7's floor that every reader accepts (OW-15: 2 GiB, 500,000
 * entries; SDK 4.49): Atlas's own 1 GiB and 200,000 fell below it, a parallel constant behind.
 */
export { WORLD_FILE_MAX_BYTES, WORLD_FILE_MAX_ENTRIES } from '@onlyworlds/sdk';

/** Files a world never carries anywhere: never copied, compared, zipped or unpacked. */
export function isTransientPath(path: string): boolean {
  if (/\.(crswap|tmp)$/i.test(path)) return true;
  if (!path.startsWith(`${ATLAS_INTERNAL_DIR}/`)) return false;
  const rest = path.slice(ATLAS_INTERNAL_DIR.length + 1);
  return rest === 'lock' || rest === 'making' || rest === 'rekey-journal.json' || /^move[^/]*\.json$/.test(rest);
}

export interface TreeFile {
  /** Relative to the world's folder, `/`-separated. */
  path: string;
  handle: FileSystemFileHandle;
}

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

/** Every file of the world, sorted by path, transient files left out. */
export async function walkWorld(dir: FileSystemDirectoryHandle): Promise<TreeFile[]> {
  const out: TreeFile[] = [];
  const walk = async (d: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, h] of (d as unknown as Entries).entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, path);
      else if (!isTransientPath(path)) out.push({ path, handle: h as FileSystemFileHandle });
    }
  };
  await walk(dir, '');
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Characters and endings Windows refuses in a file or folder name. */
const ILLEGAL = /[:*?"<>|\u0000-\u001f]|[. ]$/;

/**
 * The first name a folder on a drive cannot hold: two paths that differ only
 * in capital letters (NTFS and APFS fold case, so one would overwrite the
 * other), or a segment Windows refuses. `null` when every name travels.
 */
export function unportableName(paths: string[]): { kind: 'case'; a: string; b: string } | { kind: 'illegal'; path: string } | null {
  for (const p of paths) {
    if (p.split('/').some(seg => ILLEGAL.test(seg))) return { kind: 'illegal', path: p };
  }
  const seen = new Map<string, string>();
  for (const p of paths) {
    const folded = p.toLowerCase();
    const prior = seen.get(folded);
    if (prior !== undefined && prior !== p) return { kind: 'case', a: prior, b: p };
    seen.set(folded, p);
  }
  return null;
}

async function dirFor(root: FileSystemDirectoryHandle, path: string): Promise<FileSystemDirectoryHandle> {
  let d = root;
  for (const seg of path.split('/').slice(0, -1)) d = await d.getDirectoryHandle(seg, { create: true });
  return d;
}

async function writeFile(root: FileSystemDirectoryHandle, path: string, data: Blob | string): Promise<void> {
  const dir = await dirFor(root, path);
  const name = path.split('/').pop()!;
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  try {
    await w.write(data);
    await w.close();
  } catch (err) {
    await w.abort().catch(() => {});
    throw err;
  }
}

/**
 * Copy every file of `src` into `dst` byte for byte (each `File` streamed,
 * never parsed): the move token first, `world.json` last. Refuses, before the
 * first write, a world holding a name a folder on a drive cannot hold. Any
 * failure throws; the caller removes the destination.
 */
export async function copyWorldTree(
  src: FileSystemDirectoryHandle,
  dst: FileSystemDirectoryHandle,
  opts: { moveId: string; onProgress?: (done: number, total: number) => void },
): Promise<void> {
  const files = await walkWorld(src);
  const bad = unportableName(files.map(f => f.path));
  if (bad) {
    throw new PlainError(bad.kind === 'case'
      ? `Two files in this world, "${bad.a}" and "${bad.b}", differ only in capital letters, and a folder on your drive cannot hold both. Nothing was moved.`
      : `A file in this world, "${bad.path}", has a name a folder on your drive cannot hold. Nothing was moved.`);
  }
  await writeFile(dst, `${ATLAS_INTERNAL_DIR}/${MOVE_INCOMING_FILE}`, JSON.stringify({ move_id: opts.moveId }));
  const ordered = [...files.filter(f => f.path !== WORLD_FILE), ...files.filter(f => f.path === WORLD_FILE)];
  let done = 0;
  for (const f of ordered) {
    await writeFile(dst, f.path, await f.handle.getFile());
    opts.onProgress?.(++done, ordered.length);
  }
}

/**
 * Is `dst` a faithful copy of `src`? Equal path sets (transient files left
 * out on both sides), every `.json` equal byte for byte, every other file
 * equal in size (media is compared by size: invariant 4 says so, gate A13).
 */
export async function verifyWorldTree(
  src: FileSystemDirectoryHandle,
  dst: FileSystemDirectoryHandle,
): Promise<{ ok: true } | { ok: false; path: string }> {
  const [a, b] = await Promise.all([walkWorld(src), walkWorld(dst)]);
  const bByPath = new Map(b.map(f => [f.path, f]));
  if (a.length !== b.length) {
    const aPaths = new Set(a.map(f => f.path));
    const odd = a.find(f => !bByPath.has(f.path))?.path ?? b.find(f => !aPaths.has(f.path))?.path ?? '';
    return { ok: false, path: odd };
  }
  for (const fa of a) {
    const fb = bByPath.get(fa.path);
    if (!fb) return { ok: false, path: fa.path };
    const [x, y] = await Promise.all([fa.handle.getFile(), fb.handle.getFile()]);
    if (x.size !== y.size) return { ok: false, path: fa.path };
    if (fa.path.toLowerCase().endsWith('.json') && (await x.text()) !== (await y.text())) return { ok: false, path: fa.path };
  }
  return { ok: true };
}
