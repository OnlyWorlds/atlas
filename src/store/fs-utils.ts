/**
 * Filesystem utilities for the FS Access API-backed FolderStore.
 *
 * Write strategy (S368): ONE writable per write, then a read-back verify. A
 * writable stream already stages into its own swap file and swaps it in on
 * `close()`, so a crash mid-write leaves the old file whole. The old
 * "write `<name>.tmp`, then write `<name>`" staging doubled the window in
 * which another program holding the file (a cloud sync client, antivirus)
 * makes the swap fail, and left stray `.tmp` files behind when it did.
 * Readers still skip `.tmp` names, which older versions may have left.
 *
 * JSON read is corruption-tolerant: a malformed file logs and returns null
 * rather than throwing. Callers decide how to handle missing/bad payloads.
 */

import type { LayoutDir } from '../core/constants';
import type { ElementType } from '../core/types';

const TMP_SUFFIX = '.tmp';

// ---- Path resolution ----

/**
 * Where this type's element files live, in a STATED layout.
 *
 * There is deliberately no "work it out from the type" overload. The old
 * `elementDirSegments(type)` inferred `spatial/` for the four spatial types,
 * which made the layout an invisible property of the type rather than of the
 * FOLDER — so a folder written by another tool lost its maps with nobody
 * having decided that. Every caller now names the layout it means: the one
 * recorded for that element on disk, or the world's write layout.
 */
export function elementDirSegmentsIn(layout: LayoutDir, type: ElementType): [string, string] {
  return [layout, type];
}

/**
 * Filename for an element on disk — Folder Format naming rules.
 *
 * Canonical format: `<slug>--<id-tail>.json` where slug is a normalized
 * lowercase version of the element name and id-tail is the LAST 8 characters
 * of the element id. Browsable-by-name in the OS file picker; the short tail
 * keeps twins apart without the visual weight of a full uuid.
 *
 * THE INVARIANT (Folder Format spec line): the filename is PRESENTATION; the
 * `id` INSIDE the file is identity. Consumers MUST load every `*.json` in a
 * type folder and key on the internal id — never parse a filename for
 * meaning. `parseIdFromFilename` therefore recovers an id FRAGMENT (full id
 * only on legacy files), used for diagnostics — never for identity.
 *
 * The double-hyphen separator is deliberate: slugify() collapses non-alphanumeric
 * runs to a single `-`, so slugs can never produce `--`.
 *
 * Guards:
 * - `name` empty or unsluggable (all non-ASCII/emoji → empty slug) → bare
 *   `<full-id>.json`; renamed to slug form on the first update that supplies
 *   a SLUGGABLE name.
 * - A tail that would contain `--` or start with `-` (only possible with
 *   non-uuid fixture ids) falls back to the hyphen-stripped tail.
 * - Same-dir filename collision between DIFFERENT ids (two same-named twins
 *   sharing a tail — ~2^-32 per pair) is handled by the store, which falls
 *   back to `elementFilenameFullId`.
 *
 * Stability: RUNTIME writes are STICKY — a file keeps its current name
 * whenever that name is any valid form for the element's (new) name,
 * compared case-insensitively (case-folding filesystems treat `Alice--x` and
 * `alice--x` as the SAME entry — renaming between them would delete the file
 * just written). Only the open-time tidy pass converges files toward the
 * short canonical form, with a full occupancy view and id-sorted determinism.
 * Net effect: filenames never churn because a sibling appeared or vanished;
 * version-controlled world folders stay quiet.
 */
export const SLUG_ID_SEP = '--';
export const ID_TAIL_LEN = 8;

/** Last-8 fragment of an element id, safe to embed after the `--` separator. */
export function idTail(id: string): string {
  if (id.length <= ID_TAIL_LEN) return id;
  const raw = id.slice(-ID_TAIL_LEN);
  // Canonical uuids never hit this (their last hyphen sits 13 chars from the
  // end) — this guards odd fixture ids so the separator stays unambiguous.
  if (raw.includes(SLUG_ID_SEP) || raw.startsWith('-')) {
    const compact = id.replace(/-/g, '');
    return compact.length <= ID_TAIL_LEN ? compact : compact.slice(-ID_TAIL_LEN);
  }
  return raw;
}

export function elementFilename(id: string, name?: string | null): string {
  const slug = slugify(name ?? '');
  return slug ? `${slug}${SLUG_ID_SEP}${idTail(id)}.json` : `${id}.json`;
}

/**
 * Full-id variant, used by the store ONLY when the short-tail candidate is
 * already owned by a different id in the same directory.
 */
export function elementFilenameFullId(id: string, name?: string | null): string {
  const slug = slugify(name ?? '');
  return slug ? `${slug}${SLUG_ID_SEP}${id}.json` : `${id}.json`;
}

/**
 * Every filename form that is "valid" for this (id, name) pair — the short
 * canonical first, then the full-id collision fallback (identical to short
 * when the name is unsluggable: both are the bare `<id>.json`). Used by the
 * store's sticky-write rule: a file already sitting at ANY of these forms
 * (case-insensitively) keeps its name on write.
 */
export function validElementFilenames(id: string, name?: string | null): string[] {
  const short = elementFilename(id, name);
  const full = elementFilenameFullId(id, name);
  return short === full ? [short] : [short, full];
}

/** Case-insensitive filename equivalence — case-folding filesystems (NTFS,
 * APFS) resolve these to the same physical entry, so the store must never
 * write one and delete the other. Canonical forms are pure lowercase ASCII,
 * so ASCII case-folding is the entire equivalence space. */
export function sameFsName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
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

/** A file's stat as Atlas last saw it: what the live folder compares (S364). */
export interface FileStamp {
  lastModified: number;
  size: number;
}

/**
 * A file another program holds open, as the File System Access API reports
 * it (S368, the Discord report). On Windows the swap-in at `close()` fails
 * while OneDrive, Dropbox, antivirus or the search indexer has the file open,
 * and Chromium words every such failure as an `InvalidStateError` ("An
 * operation that depends on state cached in an interface object was made but
 * the state had changed since it was read from disk."). `NotReadableError` is
 * the same hold met by the read-back. All three pass once the hold ends.
 */
export function isFileBusyError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'InvalidStateError' || name === 'NoModificationAllowedError' || name === 'NotReadableError';
}

/** Waits between attempts while a file is busy: about two seconds in all. */
let busyRetryDelays: readonly number[] = [100, 250, 500, 1000];
/** Test seam: shorter waits (`null` restores the defaults). */
export function setBusyRetryDelaysForTests(delays: readonly number[] | null): void {
  busyRetryDelays = delays ?? [100, 250, 500, 1000];
}

/**
 * Write JSON: one writable, then a read-back verify. A write refused because
 * another program holds the file is retried whole (same bytes, so a retry is
 * safe) for about two seconds before the error reaches the caller.
 *
 * Returns the final file's stamp, read from the verify pass it already does:
 * a later stat of an untouched file equals it (measured, Chromium OPFS), so
 * the live folder can tell Atlas's own writes from anyone else's for free.
 */
export async function writeJsonAtomic(
  dir: FileSystemDirectoryHandle,
  name: string,
  value: unknown
): Promise<FileStamp> {
  // Trailing newline (S354, the git hop of the migration bout): every other
  // writer of the format ends a file with one, and git shows "no newline at
  // end of file" plus a phantom last-line change for each atlas edit in a
  // world repo without it. Key order and two-space indent were already the
  // same; this was the only byte-level difference an edit introduced.
  const json = JSON.stringify(value, null, 2) + '\n';

  // Quick read of the existing file (if any) so we can detect "write succeeded
  // but content didn't actually change" — a Chromium FS Access API quirk
  // observed in the wild. Diagnostic only; doesn't change behavior on success.
  // (`return await`: a held file's read rejects in `text()`, which must land
  // in this catch, not escape the write before its retries; S368 gate A H2.)
  const before = await (async () => {
    try {
      const h = await dir.getFileHandle(name);
      return await (await h.getFile()).text();
    } catch { return null; }
  })();

  for (let attempt = 0; ; attempt++) {
    try {
      return await writeJsonOnce(dir, name, json, before);
    } catch (err) {
      // Only a refused WRITE retries. A NotReadableError at the read-back
      // means the file changed after our close succeeded: someone else wrote
      // it, and writing our bytes again would put them over theirs (gate A M2).
      const name = (err as { name?: unknown } | null)?.name;
      const writeRefused = name === 'InvalidStateError' || name === 'NoModificationAllowedError';
      if (!writeRefused || attempt >= busyRetryDelays.length) throw err;
      await new Promise(resolve => setTimeout(resolve, busyRetryDelays[attempt]));
    }
  }
}

async function writeJsonOnce(
  dir: FileSystemDirectoryHandle,
  name: string,
  json: string,
  before: string | null,
): Promise<FileStamp> {
  // Truncate first: a writable opened with keepExistingData would otherwise
  // leave the old tail behind a shorter body (malformed JSON on the next read).
  const handle = await dir.getFileHandle(name, { create: true });
  const writer = await handle.createWritable();
  try {
    await writer.truncate(0);
    await writer.write(json);
    await writer.close();
  } catch (err) {
    // Release the swap file so the retry (or the next save) starts clean.
    await (writer as { abort?: () => Promise<void> }).abort?.().catch(() => {});
    throw err;
  }

  // Read-back verify. Catches the silent-write quirk where close() reports
  // success but the on-disk content didn't actually change. If this fires,
  // we throw rather than letting the caller believe the write succeeded.
  const finalFile = await handle.getFile();
  const finalVerify = await finalFile.text();
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
    throw new Error(`writeJsonAtomic: final file does not match intent for ${name} (silent-write quirk?)`);
  }
  return { lastModified: finalFile.lastModified, size: finalFile.size };
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
 * What the user reads about a damaged file (S368): the file name and the fix,
 * never the parser's own text. Shared by the sync pill and `core/problems.ts`.
 */
export function damagedFileSentence(fileName: string): string {
  return `${fileName} in this world's folder is damaged, so Atlas will not write over it. A git merge or an interrupted copy can do this. Once you fix or remove the file, reload it from disk.`;
}

/** A file exists but will not parse: never treat it as absent and write over it. */
export class CorruptFileError extends Error {
  constructor(public readonly fileName: string, cause: unknown) {
    super(`${fileName} exists but cannot be read (${cause instanceof Error ? cause.message : String(cause)}). Atlas will not overwrite it; fix or remove the file (a git merge conflict leaves markers like <<<<<<<).`);
    this.name = 'CorruptFileError';
  }
}

/**
 * `readJson` for READ-MERGE-WRITE paths (S360): null when the file is missing
 * or empty, but a file that exists and will not parse THROWS. `readJson`
 * returns null for both, and a save that merged into that null wrote over the
 * damaged file (a git-conflicted world.json lost its id; tombstones and world
 * styles were replaced wholesale).
 */
export async function readJsonStrict<T = unknown>(
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
  const text = await (await fileHandle.getFile()).text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new CorruptFileError(name, err);
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
