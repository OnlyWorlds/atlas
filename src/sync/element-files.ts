/**
 * Files on elements (keel #393, the SDK's files methods; Seethe's mock 04):
 * the rows of one element, the world's total against its room, and the
 * three acts (add, download, remove), read and written through the SDK.
 *
 * Files live on OnlyWorlds only: never in the folder, a world file or an
 * export, and never in /changes. So the list is read when an element page
 * asks, kept for the session, and read again once it is a minute old; every
 * act here puts its answer straight into the cache.
 *
 * The element page rebuilds on every input that moves (conv. 146), and a
 * read or an upload outlives any one build: the state is here, and a card
 * repaints itself in place through `onFilesChanged`, so a sync tick that
 * rebuilds the page mid-upload loses neither the bar nor the result.
 *
 * Every refusal is worded here as a `PlainError` (conv. 125): `problems.ts`
 * does not read the SDK's errors.
 */
import { FILE_EXTENSIONS, OwApiError, OwNetworkError, OwV2Client, fileKindOf, type OwFileRow, type OwFileTicket, type OwMe } from '@onlyworlds/sdk';
import { PlainError } from '../core/plain-error';
import { isSeatWorld, SEAT_SECRET_MISSING_LINE, worldPin } from '../core/seat';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';
import { ATLAS_CLIENT_NAME, DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';

const STALE_AFTER_MS = 60_000;
const READ_TIMEOUT_MS = 15_000;

/** Where the upload host may live: a ticket is a credential, never sent anywhere else (as pictures, `media-upload.ts`). */
const UPLOAD_ORIGINS = ['https://upload.onlyworlds.com'];
let uploadOriginsForTests: string[] | null = null;
export function setFileUploadOriginsForTests(origins: string[] | null): void { uploadOriginsForTests = origins; }

/** The client the module talks through; tests swap in their own. */
export type FilesClient = Pick<OwV2Client, 'listFiles' | 'worldFiles' | 'me' | 'createFileTicket' | 'uploadFile' | 'fileDownloadLink' | 'removeFile'>;
type ClientFactory = (apiKey: string, apiPin: string | undefined) => FilesClient;
const defaultFactory: ClientFactory = (apiKey, apiPin) =>
  new OwV2Client({ apiKey, ...(apiPin ? { apiPin } : {}), baseUrl: devV2Base() ?? DEFAULT_V2_BASE, client: ATLAS_CLIENT_NAME });
let factory: ClientFactory = defaultFactory;
export function setFilesClientFactoryForTests(f: ClientFactory | null): void { factory = f ?? defaultFactory; }

export const FILES_KINDS_LINE = 'text, pdf, or a world\'s own bundle';
/** The SDK's extensions (keel's list), never a copy: the picker's accept list and the refusal read the same. */
const EXTENSIONS = Object.keys(FILE_EXTENSIONS).map(e => `.${e}`);
export const FILES_ACCEPT = EXTENSIONS.join(',');
export const FILES_NOT_SYNCED_LINE = 'Files can be added once this element is on OnlyWorlds. It goes up with the next sync.';

// --- Sizes ------------------------------------------------------------------

/** "12.4 MB", "6 KB", "300 bytes": one decimal under 100 MB (a file is at most 25), whole above. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? '' : 's'}`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return mb < 100 ? `${Math.round(mb * 10) / 10} MB` : `${Math.round(mb)} MB`;
}

/** "41 MB of 250 MB": the world's line, in whole megabytes past the first. */
export function formatQuota(used: number, cap: number): string {
  const whole = (b: number) => (b < 1024 * 1024 ? formatBytes(b) : `${Math.round(b / (1024 * 1024))} MB`);
  return `${whole(used)} of ${whole(cap)}`;
}

// --- State --------------------------------------------------------------------

export interface FileUpload {
  name: string;
  loaded: number;
  total: number;
  /** The ticket's file id, once known: the listed row this upload stands for until it ends. */
  fileId?: string;
}

interface ElementSlot {
  rows: OwFileRow[] | null;
  /** True when keel answered that it has no such element (made here, not yet synced). */
  missing: boolean;
  failed: boolean;
  readAt: number;
  pending: Promise<void> | null;
  uploads: FileUpload[];
  /** File ids being removed right now. */
  removing: Set<string>;
}

interface WorldSlot {
  used: number | null;
  cap: number | null;
  me: OwMe | null;
  readAt: number;
  pending: Promise<void> | null;
}

const elementSlots = new Map<string, ElementSlot>();
const worldSlots = new Map<string, WorldSlot>();
const listeners = new Set<() => void>();

const worldKey = (entry: WorldRegistryEntry): string | null =>
  entry.state === 'api-linked' && entry.api?.api_key ? `${entry.api.world_id}:${entry.api.api_key}` : null;
const elementKey = (entry: WorldRegistryEntry, type: string, id: string): string | null => {
  const w = worldKey(entry);
  return w ? `${w}:${type}:${id}` : null;
};

/** A card listens while it is on the page; it removes itself once disconnected. */
export function onFilesChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const fn of [...listeners]) fn();
}

function elementSlot(key: string): ElementSlot {
  let s = elementSlots.get(key);
  if (!s) {
    s = { rows: null, missing: false, failed: false, readAt: 0, pending: null, uploads: [], removing: new Set() };
    elementSlots.set(key, s);
  }
  return s;
}

function worldSlot(key: string): WorldSlot {
  let s = worldSlots.get(key);
  if (!s) {
    s = { used: null, cap: null, me: null, readAt: 0, pending: null };
    worldSlots.set(key, s);
  }
  return s;
}

export interface FilesView {
  rows: OwFileRow[] | null;
  missing: boolean;
  failed: boolean;
  loading: boolean;
  uploads: readonly FileUpload[];
  removing: ReadonlySet<string>;
  used: number | null;
  cap: number | null;
  me: OwMe | null;
}

/** What is known now, for a card to paint. */
export function filesNow(entry: WorldRegistryEntry, type: string, id: string): FilesView {
  const ek = elementKey(entry, type, id);
  const wk = worldKey(entry);
  const e = ek ? elementSlots.get(ek) : undefined;
  const w = wk ? worldSlots.get(wk) : undefined;
  return {
    rows: e?.rows ?? null,
    missing: e?.missing ?? false,
    failed: e?.failed ?? false,
    loading: !!e?.pending && !e.rows,
    uploads: e?.uploads ?? [],
    removing: e?.removing ?? new Set(),
    used: w?.used ?? null,
    cap: w?.cap ?? null,
    me: w?.me ?? null,
  };
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), READ_TIMEOUT_MS);
  });
  return Promise.race([p, stalled]).finally(() => clearTimeout(timer));
}

const readClient = (entry: WorldRegistryEntry): FilesClient => factory(entry.api!.api_key, undefined);

/**
 * Read the element's files (and the world's total and who this key is) when
 * they are not known or a minute old. Resolves when done; the cards hear it
 * through `onFilesChanged`. Never rejects.
 */
export function refreshFiles(entry: WorldRegistryEntry, type: string, id: string, now: () => number = Date.now): Promise<void> {
  const ek = elementKey(entry, type, id);
  const wk = worldKey(entry);
  if (!ek || !wk) return Promise.resolve();
  const reads: Promise<void>[] = [];

  const e = elementSlot(ek);
  if (!e.pending && (e.readAt === 0 || now() - e.readAt > STALE_AFTER_MS)) {
    e.pending = withTimeout(Promise.resolve().then(() => readClient(entry).listFiles(type, id)), 'the files read').then(
      rows => { e.rows = rows; e.missing = false; e.failed = false; },
      (err: unknown) => {
        if (err instanceof OwApiError && err.status === 404) { e.missing = true; e.rows = []; e.failed = false; return; }
        console.info('[atlas:files] the element\'s files could not be read', err);
        e.failed = true;
      },
    ).finally(() => { e.readAt = now(); e.pending = null; notify(); });
    notify();
  }
  if (e.pending) reads.push(e.pending);

  const w = worldSlot(wk);
  if (!w.pending && (w.readAt === 0 || now() - w.readAt > STALE_AFTER_MS)) {
    // Through a promise: a client that throws as it is called is a failed read, never a broken page.
    const client = Promise.resolve().then(() => readClient(entry));
    w.pending = Promise.allSettled([
      withTimeout(client.then(c => c.worldFiles()), 'the world files read'),
      w.me ? Promise.resolve(w.me) : withTimeout(client.then(c => c.me()), 'the key read'),
    ]).then(([files, me]) => {
      if (files.status === 'fulfilled') { w.used = files.value.used_bytes; w.cap = files.value.cap_bytes; }
      if (me.status === 'fulfilled') w.me = me.value;
    }).finally(() => { w.readAt = now(); w.pending = null; notify(); });
  }
  if (w.pending) reads.push(w.pending);
  return Promise.all(reads).then(() => undefined);
}

/**
 * The world's total read again (after an add or a remove). A read already in
 * flight may have left before the change, so this one follows it rather than
 * standing in for it. keel counts a stored file at once (probed),
 * so the caller reads this beside the list and the card
 * never shows a new row with the old total.
 */
function rereadWorld(entry: WorldRegistryEntry): Promise<void> {
  const wk = worldKey(entry);
  if (!wk) return Promise.resolve();
  const w = worldSlot(wk);
  const before = w.pending ?? Promise.resolve();
  const read: Promise<void> = before.then(() => withTimeout(Promise.resolve().then(() => readClient(entry).worldFiles()), 'the world files read')).then(
    f => { w.used = f.used_bytes; w.cap = f.cap_bytes; },
    () => { /* the line keeps its last answer */ },
  ).finally(() => { w.readAt = Date.now(); if (w.pending === read) w.pending = null; notify(); });
  w.pending = read;
  return read;
}

/**
 * May this key remove this file? keel's rule: the world's owner key, or the
 * key of whoever added it. Unknown until /me is read: then no.
 */
export function mayRemove(row: OwFileRow, me: OwMe | null, readOnly: boolean): boolean {
  if (readOnly || !me || me.scope !== 'write') return false;
  if (me.role === 'owner') return true;
  return me.membership !== null && row.added_by.membership === me.membership;
}

// --- Acts -----------------------------------------------------------------------

function writeClient(entry: WorldRegistryEntry, reg: WorldsRegistry, doing: string): FilesClient {
  if (!entry.api || entry.state !== 'api-linked') throw new PlainError('Files live on OnlyWorlds: use Make online first.');
  if (entry.api.read_only) throw new PlainError(`This world is view-only here, so Atlas cannot ${doing}.`);
  const pin = worldPin(entry, reg);
  if (!pin) {
    throw new PlainError(isSeatWorld(entry) ? SEAT_SECRET_MISSING_LINE
      : `Atlas needs your OnlyWorlds PIN to ${doing}. Enter it in Settings, under OnlyWorlds.`);
  }
  return factory(entry.api.api_key, pin);
}

const minutes = (seconds: number | null): string => {
  const m = Math.max(1, Math.ceil((seconds ?? 3600) / 60));
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
};

const NOT_REACHED = 'Atlas could not reach OnlyWorlds. Check the connection and try again.';
const SIGN_IN_AGAIN = 'OnlyWorlds did not accept this world\'s key. Check it in Settings, This world.';

/** keel's and the upload host's refusals of an add, each in its own sentence. */
export function addRefusal(err: unknown, file: { size: number }): string {
  if (err instanceof TypeError) return `OnlyWorlds takes ${FILES_KINDS_LINE} (${EXTENSIONS.join(' ')}). This file is none of those.`;
  if (err instanceof OwNetworkError) return `${NOT_REACHED} Nothing was added.`;
  if (!(err instanceof OwApiError)) return 'The file was not added. Try again in a moment.';
  if (err.isFileTooLarge || err.code === 'too_large') return `This file is ${formatBytes(file.size)}, and a file on OnlyWorlds can be up to 25 MB.`;
  if (err.isFilesFull) return 'This world has no room left for this file (250 MB a world). Remove a file you no longer need, or ask the world\'s owner.';
  if (err.isQuotaExceeded) return `This world has added as many files as it can today. Try again in ${minutes(err.retryAfter)}.`;
  if (err.code === 'rate_limited') return `OnlyWorlds is holding writes back after wrong PINs. Try again in ${minutes(err.retryAfter)}.`;
  if (err.code === 'not_author') return 'As a contributor, you can add files only to elements you made.';
  if (err.code === 'unsupported_type') return `The file's contents are not what its name says: a .pdf must be a PDF, a text file must be text, and a .zip must be a world's own bundle. Nothing was added.`;
  if (err.code === 'media_unavailable') return 'Files are not available on OnlyWorlds right now. Try again later.';
  if (err.code === 'write_failed') return 'OnlyWorlds could not store the file just now. Nothing was kept; try again.';
  if (err.status === 404) return FILES_NOT_SYNCED_LINE;
  if (err.isAuthError && err.param === 'API-Pin') return 'OnlyWorlds did not accept that PIN. Check it in Settings, under OnlyWorlds.';
  if (err.isAuthError) return SIGN_IN_AGAIN;
  if (err.status === 403) return 'This world\'s key may not add files to this element.';
  if (err.status === 422 && err.param === 'label') return 'That label is too long: up to 80 characters.';
  return 'The file was not added. Try again in a moment.';
}

const isTicketSpent = (err: unknown): boolean =>
  err instanceof OwApiError && err.status === 401 && /^ticket_(expired|used|invalid)$/.test(err.code ?? '');

/**
 * Add one file to an element: a ticket from keel, then the bytes to the
 * upload host (never anywhere else), its progress in the cache for every card.
 * A spent ticket gets one fresh one; the host's 409 `exists` means an earlier
 * send with this ticket landed, so the file is there. Then the list and the
 * world's total are read again. Rejects with a `PlainError`.
 */
export async function addFile(
  entry: WorldRegistryEntry,
  reg: WorldsRegistry,
  type: string,
  id: string,
  file: File,
  label: string | null,
): Promise<void> {
  const ek = elementKey(entry, type, id);
  const client = writeClient(entry, reg, 'add a file');
  // A kind keel never takes is said before anything is sent.
  if (!fileKindOf(file.name)) throw new PlainError(addRefusal(new TypeError('kind'), file));
  const slot = elementSlot(ek!);
  const upload: FileUpload = { name: file.name, loaded: 0, total: file.size };
  slot.uploads = [...slot.uploads, upload];
  notify();
  let fileId = '';
  try {
    for (let attempt = 0; ; attempt++) {
      let ticket: OwFileTicket;
      try {
        ticket = await client.createFileTicket(type, id, { name: file.name, size: file.size, label });
      } catch (err) {
        throw new PlainError(addRefusal(err, file));
      }
      fileId = ticket.file_id;
      upload.fileId = fileId;
      let origin = '';
      try { origin = new URL(ticket.upload_url).origin; } catch { /* stays empty */ }
      if (!(uploadOriginsForTests ?? UPLOAD_ORIGINS).includes(origin)) {
        throw new PlainError('OnlyWorlds named an upload address Atlas does not know, so nothing was sent.');
      }
      try {
        await client.uploadFile(type, id, file, {
          ticket,
          onProgress: (loaded, total) => { upload.loaded = loaded; upload.total = total; notify(); },
        });
        break;
      } catch (err) {
        if (err instanceof OwApiError && err.status === 409 && err.code === 'exists') break;
        if (attempt === 0 && isTicketSpent(err)) continue;
        throw new PlainError(addRefusal(err, file));
      }
    }
  } catch (err) {
    slot.uploads = slot.uploads.filter(u => u !== upload);
    notify();
    throw err;
  }
  // The upload's row stays until the world's total and the list are both read
  // again, so the card goes from "Adding" to the new row and the new total in
  // one step. The host reports the file to keel a moment after it answers:
  // the list once more shortly if the file is not in it yet.
  try {
    await Promise.all([rereadWorld(entry), rereadElement(entry, type, id)]);
    if (!(slot.rows ?? []).some(r => r.id === fileId)) {
      await new Promise(r => setTimeout(r, 1500));
      await Promise.all([rereadWorld(entry), rereadElement(entry, type, id)]);
    }
  } finally {
    slot.uploads = slot.uploads.filter(u => u !== upload);
    notify();
  }
}

async function rereadElement(entry: WorldRegistryEntry, type: string, id: string): Promise<void> {
  const ek = elementKey(entry, type, id);
  if (!ek) return;
  const slot = elementSlot(ek);
  if (slot.pending) await slot.pending;
  slot.readAt = 0;
  await refreshFiles(entry, type, id);
}

/**
 * A link to the file, asked for at the click and used at once (the link is
 * the credential: never kept). Rejects with a `PlainError`.
 */
export async function fileLink(entry: WorldRegistryEntry, type: string, id: string, fileId: string): Promise<string> {
  if (!entry.api || entry.state !== 'api-linked') throw new PlainError('Files live on OnlyWorlds: use Make online first.');
  try {
    const link = await withTimeout(readClient(entry).fileDownloadLink(type, id, fileId), 'the download link');
    if (typeof link.url !== 'string' || !/^https:\/\//.test(link.url)) throw new PlainError('OnlyWorlds gave no address for this file. Try again in a moment.');
    return link.url;
  } catch (err) {
    if (err instanceof PlainError) throw err;
    if (err instanceof OwNetworkError) throw new PlainError(NOT_REACHED);
    if (err instanceof OwApiError && err.status === 404) {
      void rereadElement(entry, type, id);
      throw new PlainError('This file is no longer on OnlyWorlds. The list is read again.');
    }
    if (err instanceof OwApiError && err.isAuthError) throw new PlainError(SIGN_IN_AGAIN);
    throw new PlainError('The file could not be fetched. Try again in a moment.');
  }
}

/** Remove a file for real. A file already gone counts as removed. Rejects with a `PlainError`. */
export async function removeFile(
  entry: WorldRegistryEntry,
  reg: WorldsRegistry,
  type: string,
  id: string,
  fileId: string,
): Promise<void> {
  const ek = elementKey(entry, type, id);
  const client = writeClient(entry, reg, 'remove a file');
  const slot = elementSlot(ek!);
  slot.removing.add(fileId);
  notify();
  try {
    await client.removeFile(type, id, fileId);
  } catch (err) {
    if (!(err instanceof OwApiError && err.status === 404)) {
      slot.removing.delete(fileId);
      notify();
      if (err instanceof OwNetworkError) throw new PlainError(`${NOT_REACHED} The file is still there.`);
      if (err instanceof OwApiError && err.status === 403) throw new PlainError('Only the person who added this file, or the world\'s owner, can remove it.');
      if (err instanceof OwApiError && err.isAuthError && err.param === 'API-Pin') throw new PlainError('OnlyWorlds did not accept that PIN. Check it in Settings, under OnlyWorlds.');
      if (err instanceof OwApiError && err.isAuthError) throw new PlainError(SIGN_IN_AGAIN);
      throw new PlainError('The file was not removed. Try again in a moment.');
    }
  }
  // The row says "Removing…" until the world's total is read again, then
  // leaves with the new total in one step.
  await rereadWorld(entry);
  if (slot.rows) slot.rows = slot.rows.filter(r => r.id !== fileId);
  slot.removing.delete(fileId);
  notify();
}

/** Tests only. */
export function resetFilesCache(): void {
  elementSlots.clear();
  worldSlots.clear();
  listeners.clear();
}
