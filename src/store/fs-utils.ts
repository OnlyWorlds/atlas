/**
 * Filesystem utilities for the FS Access API-backed FolderStore.
 *
 * Atomic write strategy: write to `<name>.tmp`, then rename to `<name>`.
 * The FS Access API doesn't expose true atomic rename across all browsers, so
 * we fall back to "write tmp, write final, delete tmp" with best-effort
 * crash safety. The tmp file is the recovery breadcrumb — readers can detect
 * an interrupted write by the presence of a stranded `<name>.tmp`.
 *
 * JSON read is corruption-tolerant: a malformed file logs and returns null
 * rather than throwing. Callers decide how to handle missing/bad payloads.
 */

import { ELEMENTS_DIR, SPATIAL_DIR, SPATIAL_TYPES } from '../core/constants';
import type { ElementType } from '../core/types';

const TMP_SUFFIX = '.tmp';

// ---- Path resolution ----

/**
 * Where does this type's element files live?
 * - Spatial types (map/pin/zone/marker) → spatial/<type>/
 * - Content types (character/location/...) → elements/<type>/
 */
export function elementDirSegments(type: ElementType): [string, string] {
  return SPATIAL_TYPES.has(type) ? [SPATIAL_DIR, type] : [ELEMENTS_DIR, type];
}

export function elementFilename(id: string): string {
  return `${id}.json`;
}

// ---- Directory helpers ----

/**
 * Return a directory handle for the segment chain, creating intermediate
 * directories as needed. `await getDir(root, ['elements', 'character'])`.
 */
export async function getDir(
  root: FileSystemDirectoryHandle,
  segments: string[],
  opts: { create?: boolean } = { create: true }
): Promise<FileSystemDirectoryHandle> {
  let current = root;
  for (const seg of segments) {
    current = await current.getDirectoryHandle(seg, { create: opts.create ?? true });
  }
  return current;
}

/**
 * Try to get a directory without creating; returns null if absent.
 */
export async function tryGetDir(
  root: FileSystemDirectoryHandle,
  segments: string[]
): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await getDir(root, segments, { create: false });
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// ---- File ops ----

/**
 * Atomic-ish write: encode JSON, write to `<name>.tmp`, then move to `<name>`.
 * Removes the tmp after success. On crash mid-write, the tmp file is the
 * breadcrumb; the next read can ignore it and use the prior `<name>`.
 */
export async function writeJsonAtomic(
  dir: FileSystemDirectoryHandle,
  name: string,
  value: unknown
): Promise<void> {
  const tmpName = `${name}${TMP_SUFFIX}`;
  const json = JSON.stringify(value, null, 2);

  // Write tmp
  const tmpHandle = await dir.getFileHandle(tmpName, { create: true });
  const writer = await tmpHandle.createWritable();
  await writer.write(json);
  await writer.close();

  // Read back tmp content to verify it's intact (catches truncated writes).
  const verify = await (await tmpHandle.getFile()).text();
  if (verify !== json) {
    // Don't promote a corrupted tmp into the final slot.
    await dir.removeEntry(tmpName).catch(() => {});
    throw new Error(`writeJsonAtomic: verify failed for ${name}`);
  }

  // Promote: write final, then drop tmp. (Real rename isn't exposed by FS
  // Access API; this two-step is the best portable approximation.)
  const finalHandle = await dir.getFileHandle(name, { create: true });
  const finalWriter = await finalHandle.createWritable();
  await finalWriter.write(json);
  await finalWriter.close();

  await dir.removeEntry(tmpName).catch(() => {});
}

/**
 * Read and parse JSON. Returns null on missing file, malformed JSON, or
 * unreadable file. Logs malformed cases to console for debugging.
 */
export async function readJson<T = unknown>(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<T | null> {
  let fileHandle: FileSystemFileHandle;
  try {
    fileHandle = await dir.getFileHandle(name);
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
  try {
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text) return null;
    return JSON.parse(text) as T;
  } catch (err) {
    console.warn(`[fs-utils] failed to read/parse ${name}:`, err);
    return null;
  }
}

/**
 * Remove a file. Returns true if removed, false if not present.
 */
export async function removeFile(
  dir: FileSystemDirectoryHandle,
  name: string
): Promise<boolean> {
  try {
    await dir.removeEntry(name);
    return true;
  } catch (err) {
    if (isNotFound(err)) return false;
    throw err;
  }
}

/**
 * List file names (not directories) in the given directory. Filters out
 * `.tmp` stragglers from interrupted writes.
 */
export async function listFiles(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  // FS Access API uses async iteration on the handle itself for entries.
  // @ts-expect-error — `values()` is part of the FS Access API but not in lib.dom yet
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && !entry.name.endsWith(TMP_SUFFIX)) {
      names.push(entry.name);
    }
  }
  return names;
}

/**
 * List subdirectory names.
 */
export async function listDirs(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  // @ts-expect-error — see listFiles
  for await (const entry of dir.values()) {
    if (entry.kind === 'directory') {
      names.push(entry.name);
    }
  }
  return names;
}

// ---- Misc ----

export function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  return name === 'NotFoundError' || /not found/i.test(err.message);
}

export function idFromFilename(name: string): string {
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
}
