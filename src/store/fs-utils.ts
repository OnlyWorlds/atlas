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

/**
 * Filename for an element on disk.
 *
 * Default format: `<slug>--<uuid>.json` where slug is a normalized lowercase
 * version of the element name. Browsable-by-name in the OS file picker while
 * the UUID at the end keeps identity unambiguous.
 *
 * The double-hyphen separator is deliberate: slugify() collapses non-alphanumeric
 * runs to a single `-`, so slugs can never produce `--`. That gives
 * parseIdFromFilename a clean delimiter — split on the LAST `--` and the right
 * side is the id, regardless of whether the id is UUID-shaped or a short test
 * fixture string like `char-1`.
 *
 * When `name` is empty/missing, we emit the bare `<uuid>.json` form. This is
 * the fallback for elements that haven't been named yet — they get renamed
 * to slug-prefix form on the first updateElement that supplies a name.
 */
export const SLUG_ID_SEP = '--';

export function elementFilename(id: string, name?: string | null): string {
  const slug = slugify(name ?? '');
  return slug ? `${slug}${SLUG_ID_SEP}${id}.json` : `${id}.json`;
}

/**
 * Normalize a name into a filename-safe slug. Lowercase, hyphenated, ASCII-only,
 * collapsed-hyphens, length-capped, suffix-trimmed. Empty input → empty string
 * (caller fallback decides what to do).
 *
 * - Lowercase
 * - Strip diacritics via NFKD then drop combining marks (José → jose)
 * - Spaces / underscores / non-alphanumeric → `-`
 * - Collapse consecutive `-`
 * - Trim leading/trailing `-`
 * - Cap at SLUG_MAX_LEN chars (re-trim trailing `-` after cap)
 */
export const SLUG_MAX_LEN = 40;

export function slugify(name: string): string {
  if (!name) return '';
  // NFKD decomposes accents into base + combining mark. Remove the marks
  // BEFORE the alphanumeric pass, otherwise `ü` (= `u` + U+0308) becomes
  // `u-` because the combining mark is treated as a separator.
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const trimmed = ascii
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (trimmed.length <= SLUG_MAX_LEN) return trimmed;
  return trimmed.slice(0, SLUG_MAX_LEN).replace(/-+$/g, '');
}

/**
 * Extract the id portion of an element filename.
 * Handles both formats:
 *   `<uuid>.json`                → `<uuid>`
 *   `<slug>--<uuid>.json`        → `<uuid>`
 * Returns null if the input isn't a .json file or stem is empty.
 *
 * Split on the LAST `--`: if present, the id is the part after; otherwise the
 * whole stem is the id. Slugs cannot contain `--` (slugify collapses runs of
 * non-alphanumerics), so this split is unambiguous.
 */
export function parseIdFromFilename(filename: string): string | null {
  if (!filename.endsWith('.json')) return null;
  const stem = filename.slice(0, -'.json'.length);
  if (!stem) return null;
  const sepIdx = stem.lastIndexOf(SLUG_ID_SEP);
  if (sepIdx < 0) return stem;
  return stem.slice(sepIdx + SLUG_ID_SEP.length);
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

  // Quick read of the existing file (if any) so we can detect "write succeeded
  // but content didn't actually change" — a Chromium FS Access API quirk
  // observed in the wild. Diagnostic only; doesn't change behavior on success.
  const before = await (async () => {
    try {
      const h = await dir.getFileHandle(name);
      return (await h.getFile()).text();
    } catch { return null; }
  })();

  // Write tmp — explicitly truncate so we don't inherit stale bytes from any
  // prior write.
  const tmpHandle = await dir.getFileHandle(tmpName, { create: true });
  const writer = await tmpHandle.createWritable();
  await writer.truncate(0);
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
  // Truncate first — without this, if the new content is shorter than the
  // existing file, trailing bytes from the old content remain and produce
  // malformed JSON on the next read.
  const finalHandle = await dir.getFileHandle(name, { create: true });
  const finalWriter = await finalHandle.createWritable();
  await finalWriter.truncate(0);
  await finalWriter.write(json);
  await finalWriter.close();

  // Read-back verify on the FINAL file too. Catches the silent-write quirk
  // where close() reports success but the on-disk content didn't actually
  // change. If this fires, we throw rather than letting the caller believe
  // the write succeeded.
  const finalVerify = await (await finalHandle.getFile()).text();
  if (finalVerify !== json) {
    console.warn(`[fs-utils] writeJsonAtomic final read-back diverges from intent`, {
      name,
      beforeLength: before?.length ?? null,
      expectedLength: json.length,
      gotLength: finalVerify.length,
      expectedPreview: json.slice(0, 200),
      gotPreview: finalVerify.slice(0, 200),
      sameAsBefore: before !== null && finalVerify === before,
    });
    await dir.removeEntry(tmpName).catch(() => {});
    throw new Error(`writeJsonAtomic: final file does not match intent for ${name} (silent-write quirk?)`);
  }

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

/** @deprecated Use parseIdFromFilename — handles both legacy and slug-prefix formats. */
export function idFromFilename(name: string): string {
  return parseIdFromFilename(name) ?? (name.endsWith('.json') ? name.slice(0, -'.json'.length) : name);
}
