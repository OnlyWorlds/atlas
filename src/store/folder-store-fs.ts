/**
 * FsFolderStore — the real FolderStore, backed by the File System Access API.
 *
 * The folder on disk IS the world. Every element is a file. Sync state, tombstones,
 * and the writer lock live under `.atlas/`. Layout matches DESIGN.md:
 *
 *   <root>/
 *     world.json
 *     .atlas/{sync-state.json, tombstones.json, lock}
 *     elements/<content-type>/<name-slug>--<id-tail>.json   (unnamed: <id>.json)
 *     spatial/<spatial-type>/<name-slug>--<id-tail>.json
 *     media/<element-id>/<folder>/<filename>
 *
 * Folder Format rule: the filename is PRESENTATION; the `id` inside the file
 * is identity. Any `*.json` in a type folder loads regardless of its name —
 * the index is built from file BODIES (see ensureIndexFor), and non-canonical
 * filenames converge via the lazy tidy pass.
 *
 * Same contract as MockFolderStore (see folder-store.ts). All writes stamp
 * `local_updated_at`. Deletes cascade per the documented rules.
 *
 * Writer lock: a single tab "owns" the folder at a time. Owner writes
 * `.atlas/lock = { tab_id, started_at, last_heartbeat }` and refreshes
 * `last_heartbeat` every LOCK_HEARTBEAT_MS. A peer opening the same folder
 * checks the lock: missing or older than LOCK_STALE_MS → take it. Otherwise
 * `open()` throws `ELockHeld` and the caller offers a consented take-over
 * (`forceTakeLock`); there is no read-only mode (an earlier line here said
 * so; DESIGN_LAWS conv. 13). Every lock write runs on one
 * chain (conv. 118).
 */

import { PlainError } from '../core/plain-error';
import {
  ATLAS_INTERNAL_DIR,
  ATLAS_LOCAL_ONLY_FIELDS,
  ATLAS_WIRE_EXTENSION_FIELDS,
  CHARTS_FILE,
  REKEY_JOURNAL_FILE,
  STYLES_FILE,
  WORLD_PREFS_FILE,
  ELEMENTS_DIR,
  LOCK_FILE,
  LOCK_HEARTBEAT_MS,
  LOCK_STALE_MS,
  MEDIA_DIR,
  SPATIAL_DIR,
  SPATIAL_TYPES,
  SYNC_STATE_FILE,
  TOMBSTONES_FILE,
  WORLD_META_FILE,
  FOLDER_FORMAT_VERSION,
} from '../core/constants';
import type { LayoutDir } from '../core/constants';
import { parseWorldStyles, type WorldStyles } from '../core/world-styles';
import { ALL_ELEMENT_TYPES } from '../core/types';
import { findDuplicatePin, DuplicatePinError } from '../core/pin-uniqueness';
import { codePointCompare } from './code-point-order';
import type {
  Element,
  ElementType,
  Marker,
  MediaItem,
  Pin,
  SyncState,
  Tombstone,
  WorldMap,
  WorldMeta,
  Zone,
} from '../core/types';
import type { FolderStore, ListElementsOptions, RekeyJournal, ApplyServerRecordOpts, DiskChange, RescanResult } from './folder-store';
import { journalIds, RekeyPendingError } from './folder-store';
import type { ChartConfig } from '../visualization/timeline/types';
import { newId, nowIso } from './folder-store';
import { normalizeDiskLinks, denormalizeDiskLinks, type LinkSpelling } from './disk-link-names';

/**
 * One file's binding: where it lives and how its link fields are spelled
 * there. `spelling` is per FILE, never per world: a folder can hold
 * pins from two writers, and each file keeps its own.
 */
interface IndexEntry {
  type: ElementType;
  layout: LayoutDir;
  filename: string;
  spelling: LinkSpelling;
}

/**
 * Bounded concurrency for the index-pass file reads. FS Access API calls
 * have per-op latency; batching turns sum-of-latencies into rounds. Kept
 * modest — the browser serializes some of this internally anyway, and the
 * dedupe/tidy pass after the reads is strictly sequential regardless.
 */
const INDEX_READ_CONCURRENCY = 64;

/** One (type, layout) directory's scan result — see `scanLayoutFor`. */
interface LayoutScan {
  dir: FileSystemDirectoryHandle;
  /** id → the file that survived same-directory crash-twin dedupe. `spelling` null = the file declares none. */
  survivors: Map<string, { filename: string; body: Element; spelling: LinkSpelling | null; stamp: FileStamp }>;
  /** Lowercased names of files the scan could not read — never a tidy target. */
  unreadableLc: Set<string>;
}
import { PerIdWriteChain } from './write-chain';
import { stampedBody, editStamp, dropLastWriter } from './sync-stamp';
import { scrubReferrers } from './scrub-links';
import { isKnownOf, KNOWN_OF_DROPS_LOCAL, KNOWN_OF_REFUSAL, stubShape } from '../sync/known-of';
import { withoutSeatSecret } from '../core/seat';
import { HIDDEN_SHOWN_ONLINE } from '../core/hidden-mark';
import {
  elementDirSegmentsIn,
  elementFilename,
  elementFilenameFullId,
  getDir,
  idFromFilename,
  isFileBusyError,
  isNotFound,
  listFiles,
  readJson,
  readJsonStrict,
  CorruptFileError,
  removeFile,
  sameFsName,
  tryGetDir,
  validElementFilenames,
  writeJsonAtomic,
  type FileStamp,
} from './fs-utils';

const DEFAULT_META: WorldMeta = { id: '', name: '' };
const DEFAULT_SYNC_STATE: SyncState = {
  last_pull_at: null,
  last_push_at: null,
  paused: false,
  conflicts: [],
};

interface LockPayload {
  tab_id: string;
  started_at: string;
  last_heartbeat: string;
  /** Set while this tab moves the world to a folder (1.17, contract §4.2 step 3): no other tab may take it. */
  moving?: boolean;
}

export interface FsFolderStoreOptions {
  /** Override clock for tests. */
  clock?: () => string;
  /** Override the tab id used in the lock file (tests use a deterministic id). */
  tabId?: string;
  /**
   * If true, opening with a stale lock is allowed and silently takes the lock.
   * If false and another tab holds a live lock, open() throws ELockHeld.
   * Default true (matches the "one writer per folder, with stale recovery" rule).
   */
  takeStaleLock?: boolean;
  /**
   * Take the lock even if another tab holds a LIVE one. Only set after
   * explicit user consent (the "take over" prompt in world activation) —
   * two live writers on one folder can produce conflicting writes.
   */
  forceTakeLock?: boolean;
  /** Disable heartbeat timer (tests that don't want the interval). */
  disableHeartbeat?: boolean;
}

export class ELockHeld extends Error {
  constructor(public lock: LockPayload) {
    super(`folder lock held by tab ${lock.tab_id} (heartbeat ${lock.last_heartbeat})`);
    this.name = 'ELockHeld';
  }
  /** The other tab is moving this world to a folder: refused, never offered for take-over. */
  get moving(): boolean {
    return this.lock.moving === true;
  }
}

export class FsFolderStore implements FolderStore {
  private root: FileSystemDirectoryHandle | null = null;
  private clock: () => string;
  private tabId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private opts: FsFolderStoreOptions;
  /** View-only world — UI mutations throw; sync channels bypass. */
  private viewOnly: boolean | 'copy' = false;
  /** Between `beginMove` and `endMove` (or the close): the files are being copied to a folder. */
  private moving = false;

  setViewOnly(viewOnly: boolean | 'copy'): void { this.viewOnly = viewOnly; }

  /** The view-only guard. Sits on the UI-facing mutators; the engine's write
   *  channels (applyServerRecord, silent deletes, fromSync meta) skip it.
   *  It also refuses edits while the world is being moved: the app is inert
   *  behind the move's modal, and this is the backstop, so nothing written
   *  after the copy's verify is lost when the browser copy goes (1.17). */
  private assertWritable(): void {
    // A copy (conv. 177) is already the person's own copy: its sentence says where the world itself is.
    if (this.viewOnly === 'copy') throw new PlainError('This is a view-only copy, so it cannot be changed here. Edit the world itself, in your list of worlds.');
    if (this.viewOnly) throw new PlainError('This world is view-only, so it cannot be changed here. Make your own copy to edit it.');
    if (this.moving) throw new PlainError('This world is being moved to a folder. Try again when that finishes.');
  }

  /**
   * Per-element file index. Maps `id → { type, layout, filename }` so reads
   * and writes can locate the on-disk file without scanning directories.
   * Critical because filenames are no longer derivable from id alone — they
   * encode the element's name as a slug prefix (`<slug>--<uuid>.json`).
   *
   * `layout` is the element's ACTUAL top-level directory, recorded from where
   * the file was found (the union read, 2026-07-28). Every write and unlink
   * goes back to the file it read — an element found in `spatial/map/` is
   * updated in `spatial/map/`, never copied into `elements/map/` behind the
   * user's back.
   *
   * Built lazily per type on first read/write that needs it. Updated in-place
   * on create/update/delete. Cleared in close().
   */
  private fileIndex: Map<string, IndexEntry> = new Map();
  /**
   * Types whose files in THIS folder all use the bare (schema) link spelling.
   * A NEW file of such a type is written bare too, so a folder another
   * tool made stays one dialect after atlas adds a pin to it. Any other
   * folder (mixed, empty, atlas-made) gets atlas's spelling for new files.
   * Detected per type at index time; cleared in close().
   */
  private bareSpellingTypes = new Set<ElementType>();
  /** Set of types whose dirs have been scanned into fileIndex. */
  private indexedTypes: Set<ElementType> = new Set();
  /**
   * Parsed element bodies, id → body (2026-07-19). The index pass
   * already parses every file to key on body.id; keeping the bodies makes
   * listElements/getElement memory reads instead of a full disk re-walk
   * (measured 3.5s per call on a 1500-element world before this cache).
   *
   * Coherence: every body write funnels through this store (one writer per
   * folder via the lock file), so the cache is updated at the write sinks
   * (createElement / writeElementAndRename / stampServerUpdatedAt /
   * clearServerBaseline / resetSyncBaseline) and dropped in unlinkElement.
   * OWNERSHIP RULE: the cache stores objects nothing else holds a reference
   * to (parsed bodies, or clones at the write sinks) and SERVES clones —
   * callers can never mutate cache internals, preserving the old
   * fresh-objects-per-read semantics. Cleared in close().
   */
  private bodyCache: Map<string, Element> = new Map();
  /** Ids found in BOTH element layouts at index time: one copy served, the other untouched (the re-key refuses them). */
  private shadowedIds = new Set<string>();
  /**
   * THE LIVE FOLDER: each served element's file as Atlas last saw it,
   * from the index read or from Atlas's own write (`writeJsonAtomic` returns
   * the verified file's stamp). A stat that differs means someone else wrote
   * the file. EQUALITY, never "newer than": clock skew cannot fool it.
   * Keyed by id; the filename is part of the value, so a stamp only vouches
   * for the file it was taken from. In memory only.
   */
  private fileStamps = new Map<string, { filename: string } & FileStamp>();
  /**
   * Files in the element folders that Atlas does not serve (a shadowed
   * layout copy, a second file claiming a served id, an unreadable file):
   * path → stamp, so the rescan reads each one once per change, not per pass.
   */
  private otherFileStamps = new Map<string, { stamp: string; id: string | null; type: ElementType }>();
  /**
   * Bodies adopted from disk OUTSIDE a pass (`readForWrite`: an Atlas write,
   * or a pull that backed off from an outside edit), id -> the body served
   * before. The cache already holds the new body, so no stat will show it
   * again: the next pass reports these.
   */
  private pendingAdoptions = new Map<string, Element>();
  /** Single-flight rescans: the run in progress, and at most one queued after it. */
  private rescanActive: Promise<RescanResult> | null = null;
  private rescanQueued: Promise<RescanResult> | null = null;
  private rescanQueuedFull = false;
  /** Ids named by an unfinished re-key journal, as last read or written: a UI delete of one is refused. */
  private rekeyPendingIds = new Set<string>();
  /** In-flight index builds, type → shared promise (concurrent-caller guard). */
  private indexBuilds: Map<ElementType, Promise<void>> = new Map();
  /** In-flight background tidy passes (awaitTidies drains them). */
  private pendingTidies: Set<Promise<void>> = new Set();
  /**
   * Store-level per-file tick during index builds. A LISTENER, not a param:
   * builds are shared across concurrent callers (indexBuilds), so a
   * per-call callback silently dies whenever another caller started the
   * build first (getElement's cold-start warm loop raced exactly this way).
   * Every build reports here; whoever holds the listener gets every tick.
   */
  private indexTick: (() => void) | null = null;

  /** Cache an element body, cloning so the cache owns its entry outright. */
  private cacheSet(body: Element): void {
    this.bodyCache.set(body.id, structuredClone(body));
  }
  /** Per-id serialization for update/delete (convention #79 — lost-update class). */
  private writeChain = new PerIdWriteChain();
  /**
   * Store-global serialization for the single `tombstones.json` file. Append +
   * clear both read-modify-write it, and concurrent deletes on DIFFERENT ids
   * run on different per-id chains — without this they interleave and the
   * second write clobbers the first's tombstone (a lost server DELETE).
   */
  private tombstoneChain: Promise<unknown> = Promise.resolve();
  private runTombstoneOp<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tombstoneChain.then(fn, fn); // run regardless of prior outcome
    this.tombstoneChain = next.then(() => undefined, () => undefined);
    return next;
  }
  /**
   * Store-global serialization for the single `sync-state.json` file. Every
   * mutation is a read-merge-write of one shared file; without the chain,
   * concurrent rounds (auto-pull tick, resolveConflict after its network
   * I/O, push-phase persistence) interleave and the second write clobbers
   * the first's conflict/server-delete entries.
   */
  private syncStateChain: Promise<unknown> = Promise.resolve();
  private runSyncStateOp<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.syncStateChain.then(fn, fn);
    this.syncStateChain = next.then(() => undefined, () => undefined);
    return next;
  }
  /**
   * Store-global serialization for `world.json` (2026-07-13). writeWorldMeta is a read-merge-write of one shared file with
   * writers that can genuinely race: the user's setNow / home identity edit
   * vs the sync engine's pull-apply. Without the chain, the pull's stale read
   * silently erases the user's just-written now-line. resetSyncBaseline's
   * api-strip rides the same chain — it rewrites the same file.
   */
  private worldMetaChain: Promise<unknown> = Promise.resolve();
  private runWorldMetaOp<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.worldMetaChain.then(fn, fn);
    this.worldMetaChain = next.then(() => undefined, () => undefined);
    return next;
  }
  /**
   * ONE WRITER PER FILE. Two overlapping writes of the same file fail
   * each other: the first write's read-back verify reads the second's bytes
   * and throws (the `.tmp` staging that made it worse is gone). The lock had four writers (claim,
   * heartbeat, park's staling, unpark) and park never waited for its own:
   * a tab switch under load came back "not revived" (lane C: 21 of 320).
   * Every lock read-modify-write runs here, in call order.
   */
  private lockChain: Promise<unknown> = Promise.resolve();
  private runLockOp<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lockChain.then(fn, fn);
    this.lockChain = next.then(() => undefined, () => undefined);
    return next;
  }
  /** The same rule for the other whole-file `.atlas/` writes (charts, styles, world prefs, the re-key journal), keyed by file name. */
  private atlasFileChain = new PerIdWriteChain();

  constructor(opts: FsFolderStoreOptions = {}) {
    this.opts = opts;
    this.clock = opts.clock ?? nowIso;
    this.tabId = opts.tabId ?? getOrCreateTabId();
  }

  // ---- Lifecycle ----

  async open(handle: FileSystemDirectoryHandle | null): Promise<void> {
    if (!handle) throw new Error('FsFolderStore.open requires a directory handle');
    this.root = handle;
    await this.ensureLayout();
    await this.runLockOp(() => this.claimLock());
    if (!this.opts.disableHeartbeat) {
      this.heartbeatTimer = setInterval(() => {
        this.refreshHeartbeat().catch(err => console.warn('[fs-folder-store] heartbeat:', err));
      }, LOCK_HEARTBEAT_MS);
    }
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.root) {
      const atlasDir = await tryGetDir(this.root, [ATLAS_INTERNAL_DIR]);
      // Remove the lock only while it is still OURS. A parked store can be
      // evicted long after another tab legitimately took the world over
      // (stale-TTL takeover) — deleting unconditionally would destroy the
      // OTHER tab's live lock (2026-07-19).
      if (atlasDir) {
        await this.runLockOp(async () => {
          const lock = await readJson<LockPayload>(atlasDir, LOCK_FILE).catch(() => null);
          if (lock && lock.tab_id === this.tabId) await removeFile(atlasDir, LOCK_FILE);
        });
      }
    }
    this.root = null;
    this.fileIndex.clear();
    this.fileStamps.clear();
    this.otherFileStamps.clear();
    this.pendingAdoptions.clear();
    this.bareSpellingTypes.clear();
    this.shadowedIds.clear();
    this.rekeyPendingIds.clear();
    this.indexedTypes.clear();
    this.bodyCache.clear();
    this.indexBuilds.clear();
    this.moving = false;
  }

  /**
   * Park (2026-07-19): stop heartbeating but KEEP the root, lock
   * file, and all caches — the store can be revived near-instantly on
   * switch-back. The lock stays ON DISK deliberately: it goes stale after
   * LOCK_STALE_MS (90s), so another tab can take the world over exactly as
   * if this tab had crashed — and that takeover is precisely what unpark()
   * detects. Within the stale window another tab gets the normal consent
   * prompt, same as a live lock.
   */
  park(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // Stale the on-disk heartbeat immediately (2026-07-19):
    // a parked lock with a fresh-looking heartbeat would make other tabs
    // (including a relaunch after tab close) sit behind the 90s wall with a
    // scary "open in another tab — take over?" prompt for worlds no tab is
    // using. Parked = takeable instantly; unpark still verifies tab_id, so
    // a takeover is detected and forces the cold reopen. Best-effort.
    // On the lock chain: an unpark() right behind this waits for it,
    // instead of writing the same file through the same tmp at once.
    void this.runLockOp(async () => {
      try {
        if (!this.root) return;
        const atlasDir = await getDir(this.root, [ATLAS_INTERNAL_DIR]);
        const lock = await readJson<LockPayload>(atlasDir, LOCK_FILE);
        if (lock && lock.tab_id === this.tabId) {
          await writeJsonAtomic(atlasDir, LOCK_FILE, { ...lock, last_heartbeat: new Date(0).toISOString() });
        }
      } catch { /* parked lock staling is best-effort */ }
    });
  }

  /**
   * Revive a parked store. Valid ONLY when the on-disk lock still carries
   * OUR tab_id — a missing or foreign lock means another tab held the world
   * while we were parked (its writes bypassed our caches), so the caches
   * cannot be trusted: the caller must close() and re-open cold. External
   * (non-atlas) file edits made while parked are missed until a real
   * reopen — the same posture close/open always had for edits made while a
   * world sat inactive in the sidebar, now with a longer window.
   */
  async unpark(): Promise<boolean> {
    if (!this.root) return false;
    const root = this.root;
    const ours = await this.runLockOp(async () => {
      try {
        const atlasDir = await getDir(root, [ATLAS_INTERNAL_DIR]);
        const lock = await readJson<LockPayload>(atlasDir, LOCK_FILE);
        if (!lock || lock.tab_id !== this.tabId) return false;
        await writeJsonAtomic(atlasDir, LOCK_FILE, { ...lock, last_heartbeat: this.clock() });
        return true;
      } catch {
        return false;
      }
    });
    if (!ours) return false;
    if (!this.opts.disableHeartbeat && !this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        this.refreshHeartbeat().catch(err => console.warn('[fs-folder-store] heartbeat:', err));
      }, LOCK_HEARTBEAT_MS);
    }
    return true;
  }

  /**
   * Move to a folder, step 3 (1.17, contract §4.2): keep this tab's lock,
   * heartbeating, marked `moving`, so no other tab opens the world while its
   * files are copied (closing would remove the lock). Edits are
   * refused until `endMove` or the close. Throws when the lock is not ours.
   */
  async beginMove(): Promise<void> {
    await this.setMovingMark(true);
    this.moving = true;
  }

  /** The move did not finish: the lock goes back to an ordinary one, and edits are taken again. */
  async endMove(): Promise<void> {
    this.moving = false;
    await this.setMovingMark(false);
  }

  private setMovingMark(on: boolean): Promise<void> {
    return this.runLockOp(async () => {
      const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
      const lock = await readJsonStrict<LockPayload>(atlasDir, LOCK_FILE);
      if (!lock || lock.tab_id !== this.tabId) {
        if (on) throw new PlainError('Another Atlas tab has this world open, so it cannot be moved from here.');
        return;
      }
      const { moving: _was, ...rest } = lock;
      await writeJsonAtomic(atlasDir, LOCK_FILE, on ? { ...rest, moving: true, last_heartbeat: this.clock() } : { ...rest, last_heartbeat: this.clock() });
    });
  }

  // ---- Layout setup + lock ----

  private async ensureLayout(): Promise<void> {
    const root = this.requireRoot();
    await getDir(root, [ATLAS_INTERNAL_DIR]);
    await getDir(root, [ELEMENTS_DIR]);
    await getDir(root, [MEDIA_DIR]);
    // `elements/<type>/` for all 22, and never `spatial/`: new elements go to
    // `elements/` in every folder, one with legacy `spatial/` files included
    // (folder spec v0.3.8 §4). Those legacy files are still read, and an edit
    // rewrites each where it was found.
    for (const t of ALL_ELEMENT_TYPES) await getDir(root, [ELEMENTS_DIR, t]);
  }

  private async claimLock(): Promise<void> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    const existing = await readJson<LockPayload>(atlasDir, LOCK_FILE);
    if (existing) {
      const heartbeat = Date.parse(existing.last_heartbeat);
      const age = Date.now() - heartbeat;
      // A world another tab is moving to a folder is never taken, not even
      // with the take-over consent: edits here would be lost when the browser
      // copy goes (1.17). Stale (the mover crashed): taken below.
      if (existing.moving === true && existing.tab_id !== this.tabId && Number.isFinite(heartbeat) && age < LOCK_STALE_MS) {
        throw new ELockHeld(existing);
      }
      if (Number.isFinite(heartbeat) && age < LOCK_STALE_MS && !this.opts.forceTakeLock) {
        if (this.opts.takeStaleLock === false) {
          throw new ELockHeld(existing);
        }
        // takeStaleLock: stale-only enforcement happens in the else branch.
        // Live lock + takeStaleLock !== false → still throw (we don't steal
        // live; forceTakeLock above is the consent-gated exception).
        if (existing.tab_id !== this.tabId) {
          throw new ELockHeld(existing);
        }
      }
      // Stale: fall through, overwrite below.
    }
    const fresh: LockPayload = {
      tab_id: this.tabId,
      started_at: this.clock(),
      last_heartbeat: this.clock(),
    };
    await writeJsonAtomic(atlasDir, LOCK_FILE, fresh);
  }

  private refreshHeartbeat(): Promise<void> {
    return this.runLockOp(async () => {
      if (!this.root) return;
      const atlasDir = await getDir(this.root, [ATLAS_INTERNAL_DIR]);
      // A lock another program holds for a moment (OneDrive, antivirus) is
      // not a lock another TAB took: skip this beat and try the next one
      // (a plain readJson read the held file as absent and
      // stopped the heartbeat for good, so the world read as stale in 90 s).
      let existing: LockPayload | null;
      try {
        existing = await readJsonStrict<LockPayload>(atlasDir, LOCK_FILE);
      } catch (err) {
        if (isFileBusyError(err)) return;
        existing = null;
      }
      if (!existing || existing.tab_id !== this.tabId) {
        // Lock was taken by another tab; stop heartbeating.
        if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
        return;
      }
      await writeJsonAtomic(atlasDir, LOCK_FILE, { ...existing, last_heartbeat: this.clock() });
    });
  }

  private requireRoot(): FileSystemDirectoryHandle {
    if (!this.root) throw new Error('FsFolderStore not open');
    return this.root;
  }

  // ---- File index ----

  /**
   * Ensure the in-memory filename index is populated for `type`. Idempotent —
   * subsequent calls for the same type return immediately.
   *
   * Identity lives INSIDE the file (Folder Format rule): the index is built by
   * reading every body and keying on `body.id` — filenames are never parsed
   * for identity. Unreadable or id-less files are skipped and left on disk,
   * never deleted.
   *
   * Two extra jobs ride the same pass:
   * - Rename-crash dedupe: multiple files whose BODIES carry the same id
   *   (atlas crashed between write-new and delete-old) — the survivor is the
   *   latest `local_updated_at`, the rest are unlinked. Grouping is by body
   *   id, so a same-named stranger can never be deleted as a "loser".
   * - Lazy tidy: a survivor whose filename isn't the canonical
   *   `<slug>--<tail>` form (legacy full-uuid files, hand-renamed files) is
   *   rewritten to the canonical name, once per type per open.
   */
  private ensureIndexFor(type: ElementType): Promise<void> {
    if (this.indexedTypes.has(type)) return Promise.resolve();
    // In-flight guard: type indexes build CONCURRENTLY across types,
    // so two callers racing the same type must share one build — a
    // duplicated build would run the tidy pass twice over the same dir.
    // Progress reporting rides the store-level indexTick listener, so it
    // survives regardless of which caller started the build.
    const inFlight = this.indexBuilds.get(type);
    if (inFlight) return inFlight;
    const build = this.buildIndexFor(type).finally(() => { this.indexBuilds.delete(type); });
    this.indexBuilds.set(type, build);
    return build;
  }

  /**
   * THE UNION READ (2026-07-28). A spatial type is scanned in BOTH layouts —
   * `elements/<type>/` (the format) and `spatial/<type>/` (atlas's legacy
   * home) — and the results merge into one index. Content types have only
   * ever had one home, so they scan one directory as before.
   *
   * When the same element id exists in both layouts, the `elements/` copy is
   * served (folder spec v0.3.8 §4).
   */
  private async buildIndexFor(type: ElementType): Promise<void> {
    const layouts: LayoutDir[] = SPATIAL_TYPES.has(type)
      ? [ELEMENTS_DIR, SPATIAL_DIR]
      : [ELEMENTS_DIR];
    const perLayout: Array<{ layout: LayoutDir; scan: LayoutScan }> = [];
    for (const layout of layouts) {
      const scan = await this.scanLayoutFor(type, layout);
      if (!this.root) return; // closed mid-scan — the scan already bailed
      if (scan) perLayout.push({ layout, scan });
    }

    // MERGE ACROSS LAYOUTS. Within one directory a duplicate id is a
    // rename-crash twin and the loser is deleted (scanLayoutFor's job).
    // Across directories it is nothing of the sort: two tools, or one tool
    // across a format change, each wrote a legitimate file. **Nothing is
    // deleted here** — atlas does not get to resolve someone else's folder by
    // destroying half of it. The `elements/` copy is served (folder spec
    // v0.3.8 §4, "One id, one file": never by stamp, since a conforming writer
    // stamps nothing and would lose to any old stamped copy), and the shadowed
    // copy is named in a warning so the state is discoverable rather than
    // mysterious.
    // New-file spelling for this type (BORN BARE): a new
    // file takes the format's bare `map`/`zone` unless some file of this
    // type already declares atlas's suffixed spelling, in which case the
    // folder keeps its dialect (sticky, like layouts and filenames). So a
    // fresh folder is born bare (Skeld's ruling 2026-09-28: pre-1.3 atlas,
    // which cannot read a bare pin's map, is the only cost). Files that
    // declare no spelling (a mapless pin) cast no vote. Recomputed per index
    // build so a folder that changes hands re-detects on next open.
    let bare = 0;
    let total = 0;
    for (const { scan } of perLayout) {
      for (const rec of scan.survivors.values()) {
        if (rec.spelling === null) continue;
        total++;
        if (rec.spelling === 'bare') bare++;
      }
    }
    if (bare === total) this.bareSpellingTypes.add(type);
    else this.bareSpellingTypes.delete(type);

    for (const { layout, scan } of perLayout) {
      for (const [id, rec] of scan.survivors) {
        const existing = this.fileIndex.get(id);
        if (existing && existing.type === type) {
          this.shadowedIds.add(id);
          const challengerWins = layout === ELEMENTS_DIR && existing.layout !== ELEMENTS_DIR;
          console.warn(
            `[fs-folder-store] index(${type}): id ${id} exists in BOTH layouts ` +
            `(${existing.layout}/${existing.filename} and ${layout}/${rec.filename}); ` +
            `serving the ${challengerWins ? layout : existing.layout} copy. Neither file was touched.`
          );
          if (!challengerWins) {
            this.otherFileStamps.set(otherFileKey(type, layout, rec.filename), { stamp: stampKey(rec.stamp), id, type });
            continue;
          }
          // The copy losing its seat stays on disk, unserved: the rescan must not read it as new.
          this.otherFileStamps.set(otherFileKey(type, existing.layout, existing.filename), { stamp: stampKey(this.fileStamps.get(id)), id, type });
        }
        this.fileIndex.set(id, { type, layout, filename: rec.filename, spelling: rec.spelling ?? this.writeSpellingFor(type) });
        this.fileStamps.set(id, { filename: rec.filename, ...rec.stamp });
        // The index pass owns these freshly-parsed bodies outright — cache
        // them without a clone (serve-side clones protect them from callers).
        this.bodyCache.set(id, rec.body);
      }
    }
    this.indexedTypes.add(type);
    // Tidy runs LAST, once the index is populated: its occupancy view is read
    // from `this.fileIndex`, so scheduling it inside the scan would hand it an
    // empty world and it would quietly converge nothing. Files shadowed by the
    // cross-layout merge are absent from the index and therefore never tidied,
    // which is the right answer — atlas does not rename what it did not serve.
    for (const { layout, scan } of perLayout) {
      this.scheduleTidy(type, layout, scan.dir, scan.unreadableLc);
    }
  }

  /**
   * Scan ONE (type, layout) directory: read every `*.json`, group by body id,
   * resolve rename-crash twins. Returns null when the directory does not exist.
   */
  private async scanLayoutFor(
    type: ElementType,
    layout: LayoutDir,
  ): Promise<LayoutScan | null> {
    const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(layout, type));
    if (!dir) return null;
    // Read pass (2026-07-19): ONE directory enumeration collects
    // file handles (no per-file getFileHandle round-trip), then bounded-
    // concurrency workers read + parse. 1500 serialized awaits used to
    // dominate first-open wall-time; results land at their file's index so
    // the grouping below stays order-deterministic.
    const files: Array<{ name: string; handle: FileSystemFileHandle }> = [];
    for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.json')) {
        files.push({ name: entry.name, handle: entry as FileSystemFileHandle });
      }
    }
    // The format's one order (§4): by code point, never UTF-16 units or the platform's.
    files.sort((a, b) => codePointCompare(a.name, b.name));
    type Rec = { filename: string; body: Element; spelling: LinkSpelling | null; stamp: FileStamp };
    const bodies: Array<Element | null> = new Array(files.length);
    const stamps: FileStamp[] = new Array(files.length);
    const spellings: Array<LinkSpelling | null> = new Array(files.length).fill(null);
    let cursor = 0;
    const readWorker = async () => {
      while (cursor < files.length) {
        const i = cursor++;
        try {
          const file = await files[i].handle.getFile();
          stamps[i] = { lastModified: file.lastModified, size: file.size };
          bodies[i] = JSON.parse(await file.text()) as Element;
        } catch {
          bodies[i] = null; // unreadable/corrupt — same null contract as readJson
        }
        this.indexTick?.();
      }
    };
    await Promise.all(Array.from({ length: Math.min(INDEX_READ_CONCURRENCY, files.length) }, readWorker));
    // ZOMBIE GUARD (2026-07-19): the store may have been
    // closed mid-read (rapid world switch closes the prior store without
    // awaiting builds). The captured dir handle keeps working after close,
    // so without this bail the build would repopulate the cleared maps and
    // run tidy WRITES on a folder whose lock was already released.
    if (!this.root) return null;
    const grouped = new Map<string, Rec[]>();
    const unreadable = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      const filename = files[i].name;
      const body = bodies[i];
      if (!body || typeof body.id !== 'string' || !body.id) {
        unreadable.add(filename);
        if (stamps[i]) this.otherFileStamps.set(otherFileKey(type, layout, filename), { stamp: stampKey(stamps[i]), id: null, type });
        console.warn(`[fs-folder-store] index(${type}@${layout}): skipping unreadable/id-less file ${filename}`);
        continue;
      }
      // TYPE FALLBACK (2026-07-28). A foreign writer (another OW tool, a
      // folder-export script, a hand-edited file) may omit the in-body `type`
      // — the directory already carries it, so the file is not ambiguous.
      // Stamp it rather than serving a type-less element, because a single
      // one used to take out the WHOLE elements sidebar and the home desk:
      // `renderElementRow` escapes `el.type` unguarded, so `undefined` threw
      // inside the list's `.map` and the room rendered EMPTY, console-only.
      // Silent blanking on one imperfect file is the wrong failure mode for a
      // format whose whole point is that other tools write it.
      //
      // Fill-only, never override: a body that DECLARES a type keeps it even
      // when it disagrees with its directory (the body is the schema —
      // convention #14).
      //
      // ⚑ Same SHAPE as `adaptV2Record`'s stamp, but not the same reason, and
      // that adapter's own comment is stale: probed 2026-07-28 against a demo
      // world, the v2 per-type list DOES return `type` in every body, so the
      // adapter's stamp is a harmless overwrite with an identical value rather
      // than a fill. Here the fill is load-bearing: a foreign writer really can
      // omit it, and nothing upstream of this line would supply it.
      if (typeof body.type !== 'string' || !body.type) {
        body.type = type;
      }
      coerceForeignShapes(body);
      // LINK SPELLING (§5): a pin written by the format carries `map`;
      // atlas keys on `map_id`. Normalise in memory and remember which
      // spelling the FILE used, so a write goes back the way it came.
      spellings[i] = normalizeDiskLinks(body);
      const list = grouped.get(body.id);
      const rec = { filename, body, spelling: spellings[i], stamp: stamps[i] };
      if (list) list.push(rec);
      else grouped.set(body.id, [rec]);
    }
    // Dedupe crash-twins FIRST for every group (grouping is by body id, so a
    // same-named stranger can never be a "loser"), building the survivor set.
    const survivors = new Map<string, Rec>();
    for (const [id, recs] of grouped) {
      if (!this.root) return null; // closed mid-dedupe — stop unlinking losers
      // The format's rule for a repeated id (§4, clarified 2026-10-27): the FIRST file in code-point
      // name order wins, as every other reader serves it. `recs` is already in that order (the files
      // were sorted above and grouped in it). Never Atlas's own stamp: `local_updated_at` is optional,
      // so preferring it serves a copy no other reader would. Atlas's own rename cannot leave two
      // different bodies (writeElementAndRename writes in place first), so this never costs an edit.
      const [survivor, ...losers] = recs;
      for (const loser of losers) {
        // A rename-crash twin carries the same content, and is safe to drop.
        // A file that merely SHARES the id (someone copied `aldric.json` to
        // `aldric-variant.json` and edited it) is somebody's work: it moves
        // to `.atlas/quarantine/<type>/` instead of being deleted (it
        // used to be unlinked on open, with only a console line).
        if (sameContentIgnoringStamps(loser.body, survivor.body)) {
          await removeFile(dir, loser.filename).catch(() => {});
        } else {
          await this.quarantineFile(dir, loser.filename, loser.body, type).catch((err) => {
            console.warn(`[fs-folder-store] could not quarantine ${loser.filename}; left in place`, err);
          });
        }
      }
      if (losers.length > 0) {
        console.warn(`[fs-folder-store] dedupe(${type}@${layout}): kept ${survivor.filename}, set aside ${losers.map(l => l.filename).join(', ')}`);
      }
      survivors.set(id, survivor);
    }

    // Index + cache happen in the caller AS THE FILES ARE — filenames are
    // presentation, the body id is identity, so nothing about serving needs
    // canonical names. The caller also schedules this directory's tidy.
    return { dir, survivors, unreadableLc: new Set([...unreadable].map(n => n.toLowerCase())) };
  }

  /**
   * Background filename-convergence pass (the lazy tidy, deferred OUT
   * of the open path 2026-07-19). Same contract as always: FULL occupancy
   * view before any write, lowercase equivalence (case-folding
   * filesystems), id-sorted so two machines converge identically, full-id
   * fallback when the short form is taken. New here: each rename rides the
   * per-id write chain, so a user edit landing mid-tidy serializes instead
   * of racing the write-new/remove-old pair; and every step re-checks
   * `this.root`, so a closed store stops writing immediately.
   */
  private scheduleTidy(type: ElementType, layout: LayoutDir, dir: FileSystemDirectoryHandle, unreadableLc: Set<string>): void {
    const run = (async () => {
      await new Promise(r => setTimeout(r, 0)); // yield: never blocks the open
      {
        if (!this.root) return;
        // Occupancy from the LIVE index (user writes may have landed since
        // the build): lc(filename) → id, this type IN THIS LAYOUT only. Two
        // layouts are two directories, so their filename spaces are disjoint
        // and a name taken in one must never force a fallback in the other.
        const ids: string[] = [];
        const occupied = new Map<string, string>();
        for (const [id, entry] of this.fileIndex) {
          if (entry.type !== type || entry.layout !== layout) continue;
          ids.push(id);
          if (!occupied.has(entry.filename.toLowerCase())) occupied.set(entry.filename.toLowerCase(), id);
        }
        const isFree = (candidate: string, forId: string): boolean => {
          const lc = candidate.toLowerCase();
          const owner = occupied.get(lc);
          return (owner === undefined || owner === forId) && !unreadableLc.has(lc);
        };
        let tidied = 0;
        for (const id of ids.sort()) {
          if (!this.root) return;
          await this.writeChain.run(id, async () => {
            if (!this.root) return;
            const entry = this.fileIndex.get(id);
            const cached = this.bodyCache.get(id);
            if (!entry || entry.type !== type || entry.layout !== layout || !cached) return; // deleted or re-homed meanwhile
            const filename = entry.filename;
            const targetFor = (name: unknown): string => {
              const short = elementFilename(id, name as string);
              const fullForm = elementFilenameFullId(id, name as string);
              return isFree(short, id) ? short
                : sameFsName(filename, fullForm) || isFree(fullForm, id) ? fullForm
                : filename; // both forms taken (pathological) — leave it alone
            };
            const settled = () => { occupied.set(filename.toLowerCase(), id); };
            if (sameFsName(filename, targetFor(cached.name))) { settled(); return; }
            // A rename writes, so its body comes from DISK like every other
            // write (#89, conv. 92): the cache is the scan's copy, and an
            // outside edit since then would be written over and its file
            // removed. Only a file being renamed is read, so the deferred
            // open stays cheap. A file that will not parse throws here and
            // is left as it is (conv. 99).
            const body = await this.readForWrite(id);
            if (!body) return;
            const target = targetFor(body.name);
            if (sameFsName(filename, target)) { settled(); return; }
            // Distinct entries by construction (target is free, lc-equality
            // excluded), so write-new + remove-old cannot self-delete on a
            // case-folding filesystem.
            await this.writeElementFile(dir, target, body);
            await removeFile(dir, filename).catch(() => {});
            occupied.delete(filename.toLowerCase());
            occupied.set(target.toLowerCase(), id);
            this.setIndex(id, type, layout, target);
            tidied++;
          }).catch(err => console.warn(`[fs-folder-store] tidy(${type}@${layout}) skipped ${id}:`, err));
        }
        if (tidied > 0) {
          console.info(`[fs-folder-store] tidy(${type}@${layout}): ${tidied} file(s) renamed to canonical form (background)`);
        }
      }
    })();
    this.pendingTidies.add(run);
    void run.catch(() => {}).finally(() => this.pendingTidies.delete(run));
  }

  /** Resolve when all background tidy passes settle (tests + shutdown). */
  async awaitTidies(): Promise<void> {
    while (this.pendingTidies.size > 0) {
      await Promise.all([...this.pendingTidies]).catch(() => {});
    }
  }

  // ---- The live folder ----

  /** The files the index or a rescan left out as unreadable (conv. 176): derived from `otherFileStamps`, whose id is null only for those. */
  unreadableFiles(): string[] {
    const out = new Set<string>();
    for (const [key, rec] of this.otherFileStamps) {
      if (rec.id !== null) continue;
      const [, type, filename] = splitOtherFileKey(key);
      out.add(`${type}/${filename}`);
    }
    return [...out].sort();
  }

  rescanDisk(opts: { full?: boolean } = {}): Promise<RescanResult> {
    if (!this.rescanActive) {
      this.rescanActive = this.rescanOnce(!!opts.full).finally(() => { this.rescanActive = null; });
      return this.rescanActive;
    }
    if (opts.full) this.rescanQueuedFull = true;
    if (!this.rescanQueued) {
      this.rescanQueued = this.rescanActive.catch(() => undefined).then(() => {
        this.rescanQueued = null;
        const full = this.rescanQueuedFull;
        this.rescanQueuedFull = false;
        return this.rescanDisk({ full });
      });
    }
    return this.rescanQueued;
  }

  /**
   * One pass. A STAT pass finds candidates (a served file whose stat differs
   * from the stamp Atlas recorded, a served file gone, a file nobody serves);
   * each candidate is then CONFIRMED inside its id's write chain, so a user
   * save, a sync stamp, a pull-apply or a tidy rename on the same id runs
   * wholly before or wholly after it, and a stamp that now matches (Atlas
   * wrote meanwhile) drops the candidate. Everything a slot decides on is
   * re-read INSIDE the slot: a decision taken on the
   * walk's snapshot raced Atlas's own renames. Only types already indexed are
   * scanned: a type nobody has listed yet is read fresh when it is. One file
   * that throws never sinks the pass: its id is left for the next one.
   *
   * What it never does, by design: write a file, write a tombstone (a
   * deletion outside Atlas is not a server DELETE), rename or quarantine a
   * file another tool may be halfway through writing, or touch the sync
   * stamps inside a body (the file's own stamps are served as they are).
   */
  private async rescanOnce(full: boolean): Promise<RescanResult> {
    const root = this.root;
    if (!root) return { changes: [], skipped: 'closed' };
    // Mid re-key the disk holds old/new pairs on purpose; recovery owns it.
    if (await this.hasRekeyJournal()) return { changes: [], skipped: 'rekey' };
    await this.awaitTidies();

    const changes: DiskChange[] = [];
    const changedReported = new Set<string>();
    const report = (c: DiskChange): void => {
      if (c.kind === 'changed') {
        if (changedReported.has(c.id)) return;
        changedReported.add(c.id);
      }
      changes.push(c);
    };
    const alive = (): boolean => this.root === root;
    const dirOf = (layout: LayoutDir, type: ElementType) => tryGetDir(root, elementDirSegmentsIn(layout, type));
    /** The file's current stat, or null when it is not there. */
    const statOf = async (layout: LayoutDir, type: ElementType, filename: string): Promise<{ handle: FileSystemFileHandle; stamp: FileStamp } | null> => {
      try {
        const dir = await dirOf(layout, type);
        if (!dir) return null;
        const handle = await dir.getFileHandle(filename);
        const f = await handle.getFile();
        return { handle, stamp: { lastModified: f.lastModified, size: f.size } };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    };
    /** Run one candidate's slot; a throw is logged and leaves the id for the next pass. */
    const slot = async (id: string, fn: () => Promise<void>): Promise<void> => {
      try {
        await this.writeChain.run(id, async () => { if (alive()) await fn(); });
      } catch (err) {
        console.warn(`[fs-folder-store] live folder: ${id} skipped this pass:`, err instanceof Error ? err.message : err);
      }
    };

    // 0. Bodies adopted from disk OUTSIDE a pass (readForWrite, including a
    //    pull that backed off from an outside edit): the cache already holds
    //    them, so no stat will ever show them again. Report them now.
    for (const [id, before] of this.pendingAdoptions) {
      const entry = this.fileIndex.get(id);
      if (entry) report({ id, type: entry.type, kind: 'changed', before: structuredClone(before) });
    }
    this.pendingAdoptions.clear();

    // 1. The stat pass: every *.json in every indexed (type, layout) dir.
    type Seen = { type: ElementType; layout: LayoutDir; filename: string; handle: FileSystemFileHandle; stamp?: FileStamp };
    const seen: Seen[] = [];
    const scannedTypes = [...this.indexedTypes];
    for (const type of scannedTypes) {
      const layouts: LayoutDir[] = SPATIAL_TYPES.has(type) ? [ELEMENTS_DIR, SPATIAL_DIR] : [ELEMENTS_DIR];
      for (const layout of layouts) {
        const dir = await dirOf(layout, type);
        if (!dir) continue;
        for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
          if (entry.kind === 'file' && entry.name.endsWith('.json')) {
            seen.push({ type, layout, filename: entry.name, handle: entry as FileSystemFileHandle });
          }
        }
      }
    }
    let cursor = 0;
    const statWorker = async (): Promise<void> => {
      while (cursor < seen.length) {
        const s = seen[cursor++];
        try {
          const f = await s.handle.getFile();
          s.stamp = { lastModified: f.lastModified, size: f.size };
        } catch { /* vanished between listing and stat: not seen */ }
      }
    };
    await Promise.all(Array.from({ length: Math.min(INDEX_READ_CONCURRENCY, seen.length) }, statWorker));
    if (!alive()) return { changes: [], skipped: 'closed' };

    // 2. Classify against the index.
    const byPath = new Map<string, Seen>();
    for (const s of seen) if (s.stamp) byPath.set(otherFileKey(s.type, s.layout, s.filename), s);
    const servedPaths = new Set<string>();
    let changedIds: string[] = [];
    const goneIds = new Set<string>();
    for (const [id, entry] of this.fileIndex) {
      if (!this.indexedTypes.has(entry.type)) continue;
      const key = otherFileKey(entry.type, entry.layout, entry.filename);
      servedPaths.add(key);
      const s = byPath.get(key);
      if (!s) { goneIds.add(id); continue; }
      // A served file already reported unreadable at this very stat.
      if (!full && this.otherFileStamps.get(key)?.stamp === stampKey(s.stamp)) continue;
      const known = this.fileStamps.get(id);
      // FULL ("Reload from disk"): every served file is confirmed by content,
      // which also catches an overwrite that kept its mtime and size.
      if (full || !known || known.filename !== entry.filename || stampKey(known) !== stampKey(s.stamp)) changedIds.push(id);
    }
    const strangers: Seen[] = [];
    for (const [key, s] of byPath) {
      if (servedPaths.has(key)) continue;
      if (!full && this.otherFileStamps.get(key)?.stamp === stampKey(s.stamp)) continue; // known, unserved, unchanged
      strangers.push(s);
    }
    // Paths remembered as unserved that are no longer there.
    const scanned = new Set<string>(scannedTypes);
    for (const [key, rec] of this.otherFileStamps) {
      if (scanned.has(rec.type) && !byPath.has(key)) this.otherFileStamps.delete(key);
    }

    // FULL: read the served files 64-way OUTSIDE the chain and enter a slot
    // only for those that differ (a serial full pass cost seconds at 12k).
    if (full && changedIds.length > 0) {
      const differ: string[] = [];
      let c = 0;
      const readWorker = async (): Promise<void> => {
        while (c < changedIds.length) {
          const id = changedIds[c++];
          const entry = this.fileIndex.get(id);
          const cached = this.bodyCache.get(id);
          const s = entry ? byPath.get(otherFileKey(entry.type, entry.layout, entry.filename)) : undefined;
          if (!entry || !cached || !s) { differ.push(id); continue; }
          let body: Awaited<ReturnType<typeof this.readForRescan>>;
          try { body = await this.readForRescan(entry.type, s.handle); } catch { differ.push(id); continue; }
          const known = this.fileStamps.get(id);
          const sameStamp = !!known && known.filename === entry.filename && stampKey(known) === stampKey(s.stamp);
          if (body && body !== 'gone' && body.elem.id === id && sameStamp && sameContentIgnoringStamps(cached, body.elem)) continue;
          differ.push(id);
        }
      };
      await Promise.all(Array.from({ length: Math.min(INDEX_READ_CONCURRENCY, changedIds.length) }, readWorker));
      if (!alive()) return { changes, skipped: 'closed' };
      changedIds = differ;
    }

    /** Serve `filename` in (layout, type) as id's file: index, stamp, cache; report when the content moved. */
    const rehome = (id: string, type: ElementType, layout: LayoutDir, filename: string, stamp: FileStamp, elem: Element, spelling: LinkSpelling | null): void => {
      const entry = this.fileIndex.get(id);
      const before = this.bodyCache.get(id);
      this.fileIndex.set(id, { type, layout, filename, spelling: spelling ?? entry?.spelling ?? this.writeSpellingFor(type) });
      this.fileStamps.set(id, { filename, ...stamp });
      this.bodyCache.set(id, elem);
      this.otherFileStamps.delete(otherFileKey(type, layout, filename));
      if (!before || !sameContentIgnoringStamps(before, elem)) {
        report({ id, type, kind: 'changed', ...(before ? { before: structuredClone(before) } : {}) });
      }
    };
    /** Is id's served file still where the index says? */
    const servedExists = async (id: string): Promise<boolean> => {
      const entry = this.fileIndex.get(id);
      return !!entry && (await statOf(entry.layout, entry.type, entry.filename)) !== null;
    };

    /**
     * A file nobody serves: created outside, the served file renamed or moved
     * between layouts, a second copy of a served id, or another type's id.
     * Read once outside the chain to learn its id, then RE-READ inside the
     * slot, and the served file's absence re-checked there too.
     */
    const handleStranger = async (s: Pick<Seen, 'type' | 'layout' | 'filename' | 'handle'>): Promise<void> => {
      const key = otherFileKey(s.type, s.layout, s.filename);
      const first = await this.readForRescan(s.type, s.handle);
      if (!alive() || first === 'gone') return; // gone before we could read it: nothing to say
      if (!first) {
        const now = await statOf(s.layout, s.type, s.filename).catch(() => null);
        if (!now) return;
        const prev = this.otherFileStamps.get(key);
        this.otherFileStamps.set(key, { stamp: stampKey(now.stamp), id: null, type: s.type });
        if (!prev || prev.stamp !== stampKey(now.stamp)) report({ id: '', type: s.type, kind: 'unreadable', filename: s.filename });
        return;
      }
      const id = first.elem.id;
      await slot(id, async () => {
        const now = await statOf(s.layout, s.type, s.filename);
        if (!now) return; // removed meanwhile (an Atlas rename's old file, an agent's temp)
        const body = await this.readForRescan(s.type, now.handle);
        if (!alive() || !body || body === 'gone' || body.elem.id !== id) return; // moved under us: the next pass decides
        // Atlas's own new file, caught between its write and its index entry.
        const own = this.fileStamps.get(id);
        if (own && own.filename === s.filename && stampKey(own) === stampKey(now.stamp)) return;
        const entry = this.fileIndex.get(id);
        if (entry && entry.type === s.type) {
          if (!(await servedExists(id))) {
            // The served file moved: renamed (slug), or between elements/ and spatial/.
            goneIds.delete(id);
            if (!alive()) return;
            rehome(id, s.type, s.layout, s.filename, now.stamp, body.elem, body.spelling);
            return;
          }
          // A second copy of a served id (an agent copying, then editing).
          // Serve what is served; never quarantine or rename live, under
          // another tool's feet; remember the copy (its id too) and mark
          // the id shadowed so a re-key refuses it.
          this.otherFileStamps.set(key, { stamp: stampKey(now.stamp), id, type: s.type });
          this.shadowedIds.add(id);
          console.warn(`[fs-folder-store] live folder: ${s.layout}/${s.type}/${s.filename} claims id ${id}, already served from ${entry.layout}/${entry.filename}; left alone`);
          return;
        }
        if (entry) {
          this.otherFileStamps.set(key, { stamp: stampKey(now.stamp), id, type: s.type });
          console.warn(`[fs-folder-store] live folder: ${s.layout}/${s.type}/${s.filename} claims id ${id}, which is a ${entry.type}; left alone`);
          return;
        }
        if (!alive()) return;
        this.fileIndex.set(id, { type: s.type, layout: s.layout, filename: s.filename, spelling: body.spelling ?? this.writeSpellingFor(s.type) });
        this.fileStamps.set(id, { filename: s.filename, ...now.stamp });
        this.bodyCache.set(id, body.elem);
        this.otherFileStamps.delete(key);
        report({ id, type: s.type, kind: 'created' });
      });
    };

    // 3. Strangers, BEFORE deletions, so a rename is never reported as a delete.
    for (const s of strangers) {
      try { await handleStranger(s); } catch (err) {
        console.warn(`[fs-folder-store] live folder: ${s.filename} skipped this pass:`, err instanceof Error ? err.message : err);
      }
      if (!alive()) return { changes, skipped: 'closed' };
    }

    // 4. Served files whose stat moved: confirm, then serve the disk's body.
    const movedAway: Array<Pick<Seen, 'type' | 'layout' | 'filename' | 'handle'>> = [];
    for (const id of changedIds) {
      if (goneIds.has(id)) continue;
      await slot(id, async () => {
        const entry = this.fileIndex.get(id);
        if (!entry) return; // deleted meanwhile
        const now = await statOf(entry.layout, entry.type, entry.filename);
        if (!now) { goneIds.add(id); return; }
        const known = this.fileStamps.get(id);
        if (!full && known && known.filename === entry.filename && stampKey(known) === stampKey(now.stamp)) return; // Atlas wrote it meanwhile
        const body = await this.readForRescan(entry.type, now.handle);
        if (!alive()) return;
        if (body === 'gone') { goneIds.add(id); return; }
        const key = otherFileKey(entry.type, entry.layout, entry.filename);
        if (!body) {
          // Half-written by a non-atomic writer, or conflict markers: keep
          // serving the cached body, say so once per version of the file.
          if (this.otherFileStamps.get(key)?.stamp !== stampKey(now.stamp)) {
            this.otherFileStamps.set(key, { stamp: stampKey(now.stamp), id, type: entry.type });
            report({ id, type: entry.type, kind: 'unreadable', filename: entry.filename });
          }
          return;
        }
        if (body.elem.id !== id) {
          // Another element's file was moved onto this one's name: this
          // id has lost its file, and the file is a stranger for the other id.
          goneIds.add(id);
          movedAway.push({ type: entry.type, layout: entry.layout, filename: entry.filename, handle: now.handle });
          return;
        }
        this.otherFileStamps.delete(key); // readable again
        rehome(id, entry.type, entry.layout, entry.filename, now.stamp, body.elem, body.spelling ?? entry.spelling);
      });
    }
    for (const s of movedAway) {
      try { await handleStranger(s); } catch (err) {
        console.warn(`[fs-folder-store] live folder: ${s.filename} skipped this pass:`, err instanceof Error ? err.message : err);
      }
    }

    // 5. Served files that are gone. Before calling it a delete, look for a
    //    copy of the same id we left unserved (an agent's copy-then-delete
    //    move across two passes, a shadowed layout copy): promote the one
    //    the index rule would serve (§4: elements/ over spatial/, then the first by code-point name).
    for (const id of goneIds) {
      await slot(id, async () => {
        const entry = this.fileIndex.get(id);
        if (!entry) return;
        // The file is back (or Atlas wrote it meanwhile), unless another
        // element now owns that path (a file moved onto this one's name).
        const takenByOther = [...this.fileIndex].some(([other, e]) =>
          other !== id && e.type === entry.type && e.layout === entry.layout && e.filename === entry.filename);
        if (!takenByOther && (await servedExists(id))) return;
        const copies: Array<{ layout: LayoutDir; filename: string; stamp: FileStamp; elem: Element; spelling: LinkSpelling | null }> = [];
        for (const [key, rec] of this.otherFileStamps) {
          if (rec.id !== id || rec.type !== entry.type) continue;
          const [layout, , filename] = splitOtherFileKey(key);
          const now = await statOf(layout, entry.type, filename);
          if (!now) continue;
          const body = await this.readForRescan(entry.type, now.handle);
          if (body && body !== 'gone' && body.elem.id === id) copies.push({ layout, filename, stamp: now.stamp, elem: body.elem, spelling: body.spelling });
        }
        if (!alive()) return;
        if (copies.length > 0) {
          copies.sort((a, b) =>
            ((a.layout === ELEMENTS_DIR ? 0 : 1) - (b.layout === ELEMENTS_DIR ? 0 : 1)) || codePointCompare(a.filename, b.filename));
          const [winner] = copies;
          rehome(id, entry.type, winner.layout, winner.filename, winner.stamp, winner.elem, winner.spelling);
          if (copies.length === 1) this.shadowedIds.delete(id);
          return;
        }
        const before = this.bodyCache.get(id);
        this.fileIndex.delete(id);
        this.fileStamps.delete(id);
        this.bodyCache.delete(id);
        this.shadowedIds.delete(id);
        report({ id, type: entry.type, kind: 'deleted', ...(before ? { before: structuredClone(before) } : {}) });
      });
    }
    return { changes };
  }

  /**
   * Read + normalise one file the way the index pass does. `'gone'` when the
   * file is no longer there (never "unreadable"); null when it will not
   * parse or has no id.
   */
  private async readForRescan(type: ElementType, handle: FileSystemFileHandle): Promise<{ elem: Element; spelling: LinkSpelling | null } | 'gone' | null> {
    let text: string;
    try {
      text = await (await handle.getFile()).text();
    } catch (err) {
      if (isNotFound(err)) return 'gone';
      throw err; // held open by another program: the slot retries next pass
    }
    try {
      const elem = JSON.parse(text) as Element;
      if (!elem || typeof elem.id !== 'string' || !elem.id) return null;
      if (typeof elem.type !== 'string' || !elem.type) elem.type = type;
      coerceForeignShapes(elem);
      const spelling = normalizeDiskLinks(elem);
      return { elem, spelling };
    } catch {
      return null;
    }
  }

  /** Cheap .json count for a not-yet-indexed type dir (progress totals). */
  private async countPendingFiles(type: ElementType): Promise<number> {
    if (this.indexedTypes.has(type)) return 0;
    const layouts: LayoutDir[] = SPATIAL_TYPES.has(type) ? [ELEMENTS_DIR, SPATIAL_DIR] : [ELEMENTS_DIR];
    let total = 0;
    for (const layout of layouts) {
      const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(layout, type));
      if (!dir) continue;
      total += (await listFiles(dir)).filter(f => f.endsWith('.json')).length;
    }
    return total;
  }

  /** Link spelling for a NEW file of `type` in this folder. */
  private writeSpellingFor(type: ElementType): LinkSpelling {
    return this.bareSpellingTypes.has(type) ? 'bare' : 'atlas';
  }

  /**
   * THE ONE ELEMENT-FILE WRITE. Every element body reaches disk
   * through here so the file's own link spelling is honoured: an existing
   * file keeps the spelling it was read with, a new file takes the folder's.
   * The cache keeps the in-memory spelling; only the bytes on disk differ.
   */
  private async writeElementFile(dir: FileSystemDirectoryHandle, filename: string, body: Element): Promise<void> {
    const spelling = this.fileIndex.get(body.id)?.spelling ?? this.writeSpellingFor(body.type);
    const stamp = await writeJsonAtomic(dir, filename, denormalizeDiskLinks(body, spelling));
    this.fileStamps.set(body.id, { filename, ...stamp });
  }

  /**
   * A body just read from disk OUTSIDE the index pass (cache miss): bring it
   * to the in-memory spelling and record what the file used, so a later
   * write of this element does not silently change its dialect.
   */
  private adoptDiskBody(id: string, elem: Element): void {
    coerceForeignShapes(elem); // every disk read path passes here
    const spelling = normalizeDiskLinks(elem);
    const entry = this.fileIndex.get(id);
    if (spelling && entry && entry.spelling !== spelling) this.fileIndex.set(id, { ...entry, spelling });
  }

  /** The layout an element ACTUALLY lives in: its recorded one, else `elements/`, where every new file goes. */
  private layoutOf(id: string, type: ElementType): LayoutDir {
    return this.fileIndex.get(id)?.layout ?? ELEMENTS_DIR;
  }

  /** Directory handle for an existing element, created if the layout dir is absent. */
  private async dirForElement(id: string, type: ElementType): Promise<FileSystemDirectoryHandle> {
    return getDir(this.requireRoot(), elementDirSegmentsIn(this.layoutOf(id, type), type));
  }

  /**
   * Filename for a NEW write of (id, name): the short canonical unless a
   * DIFFERENT id of the same type IN THE SAME LAYOUT already holds it
   * (case-insensitively) — then the full-id fallback. Runtime stickiness for
   * EXISTING files is handled by writeElementAndRename, not here.
   */
  private resolveFilename(type: ElementType, layout: LayoutDir, id: string, name: string | null | undefined): string {
    const candidate = elementFilename(id, name);
    for (const [otherId, entry] of this.fileIndex) {
      if (otherId !== id && entry.type === type && entry.layout === layout && sameFsName(entry.filename, candidate)) {
        return elementFilenameFullId(id, name);
      }
    }
    return candidate;
  }

  /** Resolve the on-disk location for an id. Returns undefined if not indexed. */
  private indexEntry(id: string): IndexEntry | undefined {
    return this.fileIndex.get(id);
  }

  /**
   * Record a new or updated file binding. The spelling is STICKY: an entry
   * that already exists keeps the spelling its file was read with; only a
   * brand-new binding takes the folder's default for the type.
   */
  private setIndex(id: string, type: ElementType, layout: LayoutDir, filename: string): void {
    const spelling = this.fileIndex.get(id)?.spelling ?? this.writeSpellingFor(type);
    this.fileIndex.set(id, { type, layout, filename, spelling });
  }

  // ---- World meta ----

  async readWorldMeta(opts?: { strict?: boolean }): Promise<WorldMeta> {
    const meta = opts?.strict
      ? await readJsonStrict<WorldMeta>(this.requireRoot(), WORLD_META_FILE)
      : await this.readWorldMetaFile();
    if (!meta) return { ...DEFAULT_META };
    // THE NOW, UNDER EITHER SPELLING (folder-format v0.3.5, 2026-07-28).
    //
    // Canonical `schema/world.yaml` names this field `time_current`, which is
    // what atlas has always written — the deviation is keel's, which renamed
    // the column in its v1→v2 migration and never updated the standard. A
    // capture written straight from the v2 wire therefore carries
    // `time_range_current`, and its world would open here with no now at all:
    // no now-line on the charts, and a "set now time" button offering to set a
    // value the folder already holds. Measured against a real capture from
    // another implementation before this line existed.
    //
    // FILL ONLY, NEVER REWRITE. The foreign key stays exactly where it was:
    // spec v0.3.5 rules that a reader MUST NOT rewrite an existing file's key
    // spelling to the canonical one as a side effect of opening it, and
    // `writeWorldMeta` is a read-merge-write of this whole object — so
    // normalizing by DELETING the old key would silently rename a key inside
    // somebody's frozen capture on the next unrelated meta write.
    const raw = meta as WorldMeta & { time_range_current?: number | null };
    if (raw.time_current === undefined && raw.time_range_current !== undefined) {
      return { ...raw, time_current: raw.time_range_current ?? undefined };
    }
    return meta;
  }

  async writeWorldMeta(patch: Partial<WorldMeta>, opts?: { fromSync?: boolean }): Promise<WorldMeta> {
    if (!opts?.fromSync) this.assertWritable(); // engine pull-apply bypasses
    // Serialized read-merge-write: the read and the
    // write happen atomically relative to every other meta writer, so a
    // background pull-apply can never erase a concurrent user edit.
    return this.runWorldMetaOp(async () => {
      // Strict: a world.json that exists but will not parse must stop this
      // write, or the merge below starts from nothing and the world loses its
      // id (a git conflict in world.json was one save from that).
      const born = (await readJsonStrict<WorldMeta>(this.requireRoot(), WORLD_META_FILE)) === null;
      const current = await this.readWorldMeta();
      // THE BIRTH STAMP (folder-format §4.2): a folder atlas creates
      // records the spec version it was written against. Only when no
      // world.json existed yet; a folder from another tool keeps whatever it
      // carries, absent included (opening or editing is not capturing).
      const stamp = born && patch.format_version === undefined
        ? { format_version: FOLDER_FORMAT_VERSION }
        : {};
      // THE PRODUCER LINE (§4.2, v0.3.14): taken at birth only. After that the
      // line the folder was born with stays, whoever writes (an import into
      // this world, a pull, a restore): it says who made the folder, never who
      // touched it last.
      const { producer: offered, ...rest } = patch;
      const producer = born && offered !== undefined ? { producer: offered } : {};
      // A seat's secret never reaches the folder (#104): the folder travels.
      const next: WorldMeta = withoutSeatSecret({ ...current, ...stamp, ...rest, ...producer });
      await writeJsonAtomic(this.requireRoot(), WORLD_META_FILE, next);
      return next;
    });
  }

  /** The file as it is on disk, or null when the folder has no world.json yet. */
  private readWorldMetaFile(): Promise<WorldMeta | null> {
    return readJson<WorldMeta>(this.requireRoot(), WORLD_META_FILE);
  }

  // ---- Elements (unified content + spatial) ----

  async listElements(type?: ElementType, opts?: ListElementsOptions): Promise<Element[]> {
    const types = type ? [type] : (ALL_ELEMENT_TYPES as readonly ElementType[]);
    // Progress plumbing: totals come from a cheap pre-count of
    // pending dirs (directory enumeration only, no parse) so the caller can
    // show "N of M" while the expensive body reads run.
    const onProgress = opts?.onProgress;
    const pending = types.filter(t => !this.indexedTypes.has(t));
    if (onProgress && pending.length > 0) {
      const counts = await Promise.all(pending.map(t => this.countPendingFiles(t)));
      const total = counts.reduce((a, b) => a + b, 0);
      let done = 0;
      onProgress(0, total);
      // Listen for every build's ticks — including builds another caller
      // already started (done can end short of total then; it's a courtesy
      // counter, the caller clears it on resolve).
      const tick = () => onProgress(++done, total);
      this.indexTick = tick;
      try {
        await Promise.all(pending.map(t => this.ensureIndexFor(t)));
      } finally {
        // Only clear our OWN listener — a concurrent progress caller may
        // have replaced it, and nulling theirs would freeze their counter
        // (2026-07-19).
        if (this.indexTick === tick) this.indexTick = null;
      }
    } else {
      await Promise.all(types.map(t => this.ensureIndexFor(t)));
    }
    // Serve from the body cache in one pass over the index, bucketed so the
    // result keeps the historical grouped-by-type order. Misses (shouldn't
    // happen; resilience only) fall back to a disk read and re-warm.
    const buckets = new Map<ElementType, Element[]>();
    for (const t of types) buckets.set(t, []);
    const misses: Array<IndexEntry & { id: string }> = [];
    for (const [id, entry] of this.fileIndex) {
      const bucket = buckets.get(entry.type);
      if (!bucket) continue;
      const body = this.bodyCache.get(id);
      if (body) bucket.push(structuredClone(body));
      else misses.push({ id, ...entry });
    }
    for (const miss of misses) {
      const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(miss.layout, miss.type));
      if (!dir) continue;
      const elem = await readJson<Element>(dir, miss.filename);
      if (elem) {
        this.adoptDiskBody(miss.id, elem);
        this.bodyCache.set(miss.id, elem);
        buckets.get(miss.type)!.push(structuredClone(elem));
      }
    }
    const out: Element[] = [];
    for (const t of types) out.push(...buckets.get(t)!);
    return out;
  }

  async getElement(id: string): Promise<Element | null> {
    let entry = this.indexEntry(id);
    if (!entry) {
      // Cache miss — could be a never-indexed type, or an unknown id. Warm
      // every type's index, then retry. Most read paths hit listElements
      // first so the cache is usually warm; this branch covers cold-start
      // direct getElement calls.
      for (const t of ALL_ELEMENT_TYPES) {
        if (this.indexedTypes.has(t)) continue;
        await this.ensureIndexFor(t);
        entry = this.indexEntry(id);
        if (entry) break;
      }
    }
    if (!entry) return null;
    const cached = this.bodyCache.get(id);
    if (cached) return structuredClone(cached);
    const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(entry.layout, entry.type));
    if (!dir) return null;
    const elem = await readJson<Element>(dir, entry.filename);
    if (!elem) {
      // File vanished out from under us — drop the stale index entry.
      this.fileIndex.delete(id);
      this.bodyCache.delete(id);
      return null;
    }
    this.adoptDiskBody(id, elem);
    this.bodyCache.set(id, elem);
    return structuredClone(elem);
  }

  /**
   * THE READ BEFORE A READ-MODIFY-WRITE: the element as it is ON
   * DISK now, not as it was cached. Every chained write path (update,
   * updateWith, the sync stamps) merges into this, so a field another tool
   * edited in the file while atlas held the world survives atlas's next
   * write to that element instead of being overwritten by the cached body.
   * Found reviewing the toolkit's in-place editing rules: the cache is
   * filled at open and atlas does not watch the folder, so before this every
   * atlas edit wrote its stale copy over an outside edit to the same
   * element. One file read per write; a file that vanished falls back to the
   * cache (the earlier behaviour), and a file that will not parse throws
   * `CorruptFileError` (conv. 99): it is never written over.
   * Seeing outside edits WITHOUT an atlas write (lists, the open element) is
   * a separate question: the reopen/revive bout.
   */
  private async readForWrite(id: string): Promise<Element | null> {
    const cached = await this.getElement(id); // warms the index; the fallback
    if (!cached) return null;
    const entry = this.indexEntry(id);
    if (!entry) return cached;
    try {
      const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(entry.layout, entry.type));
      // STRICT: a file that exists and will not parse (git
      // conflict markers) must stop the write. Falling back to the cache here
      // wrote atlas's copy over it, the one damaged-file case an earlier fix left open.
      const disk = dir ? await readJsonStrict<Element>(dir, entry.filename) : null;
      if (!disk || disk.id !== id) return cached;
      // Same fill as the scan: a foreign writer may omit `type`.
      if (typeof disk.type !== 'string' || !disk.type) disk.type = entry.type;
      this.adoptDiskBody(id, disk);
      // Someone else changed the file since Atlas last served it: the next
      // live-folder pass says so, since no stat will show it now.
      const before = this.bodyCache.get(id);
      if (before && !this.pendingAdoptions.has(id) && !sameContentIgnoringStamps(before, disk)) {
        this.pendingAdoptions.set(id, structuredClone(before));
      }
      this.bodyCache.set(id, disk);
      return structuredClone(disk);
    } catch (err) {
      if (err instanceof CorruptFileError) throw err;
      return cached;
    }
  }

  async createElement(type: ElementType, data: Partial<Element>): Promise<Element> {
    this.assertWritable();
    const id = (data.id as string) ?? newId();
    // ONE ELEMENT, ONE PIN, ONE MAP. Guarded HERE and not in
    // `createPin`, because the import applier bypasses that wrapper. Reads
    // the in-memory bodies rather than re-listing: a positive match is proof
    // the duplicate exists, so this cannot reject a legitimate create, and an
    // incomplete corpus merely under-fires (today's behaviour).
    if (type === 'pin') {
      const dupe = findDuplicatePin(data as Partial<Pin>, this.bodyCache.values(), id);
      if (dupe) {
        throw new DuplicatePinError(dupe.id);
      }
    }
    // created_at is stamped locally at birth from the SAME instant as
    // local_updated_at, so "never edited since creation" is a plain equality
    // check (home's Created/Edit verb). It never reaches the wire (the
    // adapter strips server-managed fields) and a pull's server value
    // overwrites it — locally true until the server has a truer one.
    const now = this.clock();
    const elem: Element = {
      created_at: now,
      ...data,
      id,
      type,
      name: (data.name as string) ?? '',
      local_updated_at: now,
    };
    await this.ensureIndexFor(type);
    // In the id's chain: a live-folder pass that finds
    // the new file between its write and its index entry waits for both.
    return this.writeChain.run(id, async () => {
      const layout = ELEMENTS_DIR;
      const dir = await getDir(this.requireRoot(), elementDirSegmentsIn(layout, type));
      const filename = this.resolveFilename(type, layout, id, elem.name);
      await this.writeElementFile(dir, filename, elem);
      this.setIndex(id, type, layout, filename);
      this.cacheSet(elem);
      return elem;
    });
  }

  async createElementVerbatim(
    type: ElementType,
    body: Element,
    opts?: { bindingFrom?: string },
  ): Promise<{ created: boolean; element: Element }> {
    this.assertWritable();
    const id = body.id;
    await this.ensureIndexFor(type);
    return this.writeChain.run(id, async () => {
      // Recovery reruns this step: a present file is a complete one (atomic
      // writes), so it is never rewritten and never loses a baseline it got.
      const existing = await this.getElement(id);
      if (existing) return { created: false, element: existing };
      const now = this.clock();
      const { server_updated_at: _drop, ...rest } = body;
      const elem: Element = {
        ...rest,
        created_at: body.created_at ?? now,
        id,
        type,
        name: body.name ?? '',
        local_updated_at: now,
      };
      // The old element's binding: same directory layout, same link spelling,
      // so a re-key in someone else's folder changes names, not dialect.
      const from = opts?.bindingFrom ? this.fileIndex.get(opts.bindingFrom) : undefined;
      const inherit = !!from && from.type === type;
      const layout = inherit ? from!.layout : ELEMENTS_DIR;
      const spelling = inherit ? from!.spelling : this.writeSpellingFor(type);
      const dir = await getDir(this.requireRoot(), elementDirSegmentsIn(layout, type));
      const filename = this.resolveFilename(type, layout, id, elem.name);
      const stamp = await writeJsonAtomic(dir, filename, denormalizeDiskLinks(elem, spelling));
      this.fileStamps.set(id, { filename, ...stamp });
      this.fileIndex.set(id, { type, layout, filename, spelling });
      this.cacheSet(elem);
      return { created: true, element: structuredClone(elem) };
    });
  }

  async updateElement(id: string, patch: Partial<Element>): Promise<Element> {
    this.assertWritable();
    // Per-id serialization (convention #79): two concurrent updates to the
    // same element race the read-merge-write below — the second call's read
    // predates the first call's write, silently reverting its fields.
    return this.writeChain.run(id, () => this.updateElementUnchained(id, patch));
  }

  async updateElementWith(
    id: string,
    mutate: (existing: Element) => Partial<Element> | null,
  ): Promise<Element | null> {
    this.assertWritable();
    // Same chain as updateElement; the read happens INSIDE the lock so the
    // mutate callback always sees the latest committed state (no TOCTOU).
    return this.writeChain.run(id, async () => {
      const existing = await this.readForWrite(id);
      if (!existing) return null;
      // keel's stub is left as it is: never changed here, never thrown on (the rekey kernel calls this).
      if (isKnownOf(existing)) return existing;
      const patch = mutate(existing);
      if (patch === null || Object.keys(patch).length === 0) return existing;
      return this.applyPatchUnchained(existing, patch);
    });
  }

  private async updateElementUnchained(id: string, patch: Partial<Element>): Promise<Element> {
    const existing = await this.readForWrite(id);
    if (!existing) throw new Error(`element ${id} not found`);
    // keel's stub is never changed here (conv. 155, I5).
    if (isKnownOf(existing)) throw new PlainError(KNOWN_OF_REFUSAL);
    return this.applyPatchUnchained(existing, patch);
  }

  private async applyPatchUnchained(existing: Element, patch: Partial<Element>): Promise<Element> {
    const next: Element = dropLastWriter({
      ...existing,
      ...patch,
      id: existing.id,
      type: existing.type,
      // An edit sorts past the baseline it was made on, whatever this clock says.
      local_updated_at: editStamp(this.clock(), patch.server_updated_at ?? existing.server_updated_at),
      server_updated_at: patch.server_updated_at ?? existing.server_updated_at,
    });
    await this.writeElementAndRename(existing.type, existing.id, next, existing.name);
    return next;
  }

  /**
   * Write an element body, renaming the file only when the name (and
   * therefore the slug) genuinely changed since the last write.
   *
   * STICKY RULE (2026-07-03): the file keeps its current name
   * whenever that name is any valid form for the NEW name, compared
   * case-insensitively. This covers three hazards at once: (a) name
   * unchanged — plain overwrite; (b) a foreign case-variant of a valid form —
   * on a case-folding filesystem (NTFS/APFS) the lowercase twin IS the same
   * physical entry, so write-new + delete-old would delete the file just
   * written; (c) a full-id fallback file whose tail collision has since
   * cleared — body-only edits must not churn it (filenames never change
   * because a sibling vanished; convergence is the open-time tidy's job).
   */
  private async writeElementAndRename(
    type: ElementType,
    id: string,
    next: Element,
    previousName: string,
  ): Promise<void> {
    // An existing element is rewritten WHERE IT LIVES — a map found in a
    // legacy `spatial/` folder stays there rather than silently migrating to
    // `elements/` on its next edit. Only a brand-new element uses the world's
    // write layout.
    const entry = this.indexEntry(id);
    const layout = entry?.layout ?? ELEMENTS_DIR;
    const dir = await getDir(this.requireRoot(), elementDirSegmentsIn(layout, type));
    const currentFilename = entry?.filename ?? elementFilename(id, previousName);
    if (validElementFilenames(id, next.name).some(f => sameFsName(f, currentFilename))) {
      await this.writeElementFile(dir, currentFilename, next);
      this.setIndex(id, type, layout, currentFilename);
      this.cacheSet(next);
      return;
    }
    // Name genuinely changed: the new body goes into the CURRENT file first, then the new name gets
    // the same body, then the old file goes. resolveFilename outputs are valid forms and lc-equality
    // with the current name was excluded above, so old and new are DISTINCT physical entries even on
    // case-folding filesystems. A crash at any step leaves either one file with the new body (the
    // open-time tidy renames it) or two files with the same body (the dedupe drops one, whichever
    // order serves): never two different bodies, so the format's first-by-name rule can never serve
    // the version from before the edit.
    const newFilename = this.resolveFilename(type, layout, id, next.name);
    await this.writeElementFile(dir, currentFilename, next);
    await this.writeElementFile(dir, newFilename, next);
    this.setIndex(id, type, layout, newFilename);
    this.cacheSet(next);
    await removeFile(dir, currentFilename).catch(err => {
      console.warn(`[fs-folder-store] rename: failed to remove old file ${currentFilename}`, err);
    });
  }

  async findDependents(id: string): Promise<Element[]> {
    const target = await this.getElement(id);
    if (!target) return [];
    if (target.type === 'pin' || target.type === 'marker') return [];
    if (target.type === 'zone') {
      // Markers carry the zone relationship; the zone has no children otherwise.
      const markers = (await this.listElements('marker')) as Array<Element & { zone_id?: string }>;
      return markers.filter(m => m.zone_id === id);
    }
    if (target.type === 'map') {
      // Pins + markers carry map_id. Zones do NOT (see DESIGN_ZONES.md §1):
      // a zone whose only markers were on the deleted map becomes "orphan"
      // metadata, preserved for potential re-acquisition of geometry.
      const out: Element[] = [];
      for (const t of ['pin', 'marker'] as const) {
        const list = (await this.listElements(t)) as Array<Element & { map_id?: string }>;
        for (const e of list) if (e.map_id === id) out.push(e);
      }
      return out;
    }
    if (target.type === 'narrative') {
      // Narratives form a parent_narrative chain (writing tree). Deleting a
      // book/chapter must cascade-delete its descendant narratives too —
      // otherwise children become orphaned with a dangling parent_narrative
      // FK and re-surface as loose roots in the writing tree. Plus pins.
      const allNarratives = (await this.listElements('narrative')) as Array<Element & { parent_narrative?: string }>;
      const descendantIds = new Set<string>();
      const queue: string[] = [id];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const n of allNarratives) {
          if (n.parent_narrative === cur && n.id !== id && !descendantIds.has(n.id)) {
            descendantIds.add(n.id);
            queue.push(n.id);
          }
        }
      }
      const descendants = allNarratives.filter(n => descendantIds.has(n.id));
      const pins = (await this.listElements('pin')) as Array<Element & { element_id?: string }>;
      const targetIds = new Set([id, ...descendantIds]);
      const pinsForCascade = pins.filter(p => p.element_id != null && targetIds.has(p.element_id));
      return [...descendants, ...pinsForCascade];
    }
    // Content element: pins that reference it
    const pins = (await this.listElements('pin')) as Array<Element & { element_id?: string }>;
    return pins.filter(p => p.element_id === id);
  }

  async deleteElement(id: string, opts: { cascade?: boolean; silent?: boolean } = {}): Promise<{ tombstones: Tombstone[] }> {
    // Silent deletes are the ENGINE's channel (server-side deletes applying
    // locally) — they bypass the view-only guard; UI deletes never pass silent.
    if (!opts.silent) this.assertWritable();
    if (!opts.silent && this.rekeyPendingIds.has(id)) throw new RekeyPendingError();
    if (!opts.silent && isKnownOf(await this.getElement(id))) throw new PlainError(KNOWN_OF_REFUSAL);
    // Same chain as updateElement: an in-flight update to this id lands (or
    // fails) before the file disappears — no "element not found" tail errors.
    const result = await this.writeChain.run(id, () => this.deleteElementUnchained(id, opts));
    // Links to what just died are removed from every other element, as keel
    // does (`store/scrub-links.ts`). Outside the target's slot: each
    // referrer goes through its own chain. Silent deletes are the engine's
    // and Route 2's channel (the server already scrubbed, or the id is being
    // swapped), so they never scrub.
    if (!opts.silent) await scrubReferrers(this, new Set(result.tombstones.map(t => t.id)));
    return result;
  }

  async deleteSilentlyIfUnchanged(
    id: string, expected: { local_updated_at: string | null; server_updated_at: string | null },
  ): Promise<boolean> {
    return this.writeChain.run(id, async () => {
      // The file AS IT IS ON DISK, as in applyServerRecordIfUnchanged: an
      // outside edit with a fresh stamp keeps the file. Both stamps: a Keep
      // clears `server_updated_at` and leaves the edit time alone.
      const current = await this.readForWrite(id);
      if ((current?.local_updated_at ?? null) !== expected.local_updated_at) return false;
      if (current && (current.server_updated_at ?? null) !== expected.server_updated_at) return false;
      if (current) await this.deleteElementUnchained(id, { silent: true });
      return true;
    });
  }

  private async deleteElementUnchained(id: string, opts: { cascade?: boolean; silent?: boolean } = {}): Promise<{ tombstones: Tombstone[] }> {
    const silent = opts.silent ?? false;
    const cascade = silent ? false : (opts.cascade ?? true);
    const existing = await this.getElement(id);
    if (!existing) return { tombstones: [] };

    const written: Tombstone[] = [];
    if (cascade) {
      const deps = await this.findDependents(id);
      for (const dep of deps) {
        const tomb: Tombstone = { id: dep.id, type: dep.type, deleted_at: this.clock() };
        // EACH DEPENDENT GOES THROUGH ITS OWN WRITE CHAIN.
        //
        // `deleteElement` serializes on the TARGET's id only. The cascade used
        // to unlink descendants directly from inside that slot, and
        // `PerIdWriteChain` is per-id by design ("operations on DIFFERENT
        // elements stay concurrent"), so a concurrent `updateElement(dep.id)`
        // was NOT serialized against that dependent's deletion.
        //
        // The interleaving that loses data: the update's read resolves before
        // `unlinkElement(dep)` removes the file, and its `writeJsonAtomic`
        // lands after — RECREATING the file and restoring it to `fileIndex`
        // and `bodyCache`, while the tombstone is already logged. The next
        // sync round then pushes a DELETE for an element that still exists
        // locally: permanent divergence, and atlas has no undo.
        //
        // Realistic trigger: the writing workspace flushes a debounced save
        // for the narrative you just switched away from (`flushPendingSave` is
        // fired-and-forgotten on switch and unmount), and a subtree delete
        // lands in that window. Found by an integration review — the
        // keeper had noticed the bypass and moved on without following it.
        //
        // The guard below matters: we are already INSIDE `run(id, ...)`, so
        // re-entering the same id would await our own tail and deadlock.
        // `findDependents` never returns the target today; this keeps that
        // from becoming a silent hang if it ever does.
        const unlinkDep = async (): Promise<void> => {
          await this.appendTombstone(tomb);
          await this.unlinkElement(dep);
        };
        if (dep.id === id) await unlinkDep();
        else await this.writeChain.run(dep.id, unlinkDep);
        written.push(tomb);
      }
    }
    if (!silent) {
      const primary: Tombstone = { id, type: existing.type, deleted_at: this.clock() };
      await this.appendTombstone(primary);
      written.push(primary);
    }
    await this.unlinkElement(existing);
    return { tombstones: written };
  }

  private async unlinkElement(elem: Element): Promise<void> {
    const entry = this.indexEntry(elem.id);
    // The DIRECTORY the file was found in, never the type its body declares:
    // a body saying "location" inside elements/character/ used to be "deleted"
    // from elements/location/ (not found = success) and came back on the next
    // open.
    const dirType = entry?.type ?? elem.type;
    const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(this.layoutOf(elem.id, dirType), dirType));
    if (!dir) return;
    const filename = entry?.filename ?? elementFilename(elem.id, elem.name);
    await removeFile(dir, filename);
    this.fileIndex.delete(elem.id);
    this.fileStamps.delete(elem.id);
    this.bodyCache.delete(elem.id);
  }

  // ---- Spatial wrappers (typed accessors over the unified element store) ----

  async listMaps(): Promise<WorldMap[]> { return (await this.listElements('map')) as WorldMap[]; }
  async getMap(id: string): Promise<WorldMap | null> { return (await this.getElement(id)) as WorldMap | null; }
  async createMap(data: Partial<WorldMap>): Promise<WorldMap> { return (await this.createElement('map', data)) as WorldMap; }
  async updateMap(id: string, patch: Partial<WorldMap>): Promise<WorldMap> { return (await this.updateElement(id, patch)) as WorldMap; }
  async deleteMap(id: string, opts?: { cascade?: boolean }) { return this.deleteElement(id, opts); }

  async listPins(mapId?: string): Promise<Pin[]> {
    const all = (await this.listElements('pin')) as Pin[];
    return mapId ? all.filter(p => p.map_id === mapId) : all;
  }
  async getPin(id: string): Promise<Pin | null> { return (await this.getElement(id)) as Pin | null; }
  async createPin(data: Partial<Pin>): Promise<Pin> { return (await this.createElement('pin', data)) as Pin; }
  async updatePin(id: string, patch: Partial<Pin>): Promise<Pin> { return (await this.updateElement(id, patch)) as Pin; }
  async deletePin(id: string) { return this.deleteElement(id); }

  async listZones(): Promise<Zone[]> {
    return (await this.listElements('zone')) as Zone[];
  }
  async getZone(id: string): Promise<Zone | null> { return (await this.getElement(id)) as Zone | null; }
  async createZone(data: Partial<Zone>): Promise<Zone> { return (await this.createElement('zone', data)) as Zone; }
  async updateZone(id: string, patch: Partial<Zone>): Promise<Zone> { return (await this.updateElement(id, patch)) as Zone; }
  async deleteZone(id: string) { return this.deleteElement(id); }

  async listMarkers(filter?: { mapId?: string; zoneId?: string }): Promise<Marker[]> {
    const all = (await this.listElements('marker')) as Marker[];
    if (!filter) return all;
    return all.filter(m =>
      (filter.mapId === undefined || m.map_id === filter.mapId) &&
      (filter.zoneId === undefined || m.zone_id === filter.zoneId),
    );
  }
  async getMarker(id: string): Promise<Marker | null> { return (await this.getElement(id)) as Marker | null; }
  async createMarker(data: Partial<Marker>): Promise<Marker> { return (await this.createElement('marker', data)) as Marker; }
  async updateMarker(id: string, patch: Partial<Marker>): Promise<Marker> { return (await this.updateElement(id, patch)) as Marker; }
  async deleteMarker(id: string) { return this.deleteElement(id); }

  // ---- Media ----

  async addMedia(elementId: string, file: File, folder = 'default'): Promise<MediaItem> {
    this.assertWritable();
    const mediaRoot = await getDir(this.requireRoot(), [MEDIA_DIR, elementId, folder]);
    const id = newId();
    // Use the original filename to keep the folder browsable; collisions get suffixed.
    let filename = file.name;
    const existingNames = await listFiles(mediaRoot);
    if (existingNames.includes(filename)) {
      const dot = filename.lastIndexOf('.');
      const stem = dot >= 0 ? filename.slice(0, dot) : filename;
      const ext = dot >= 0 ? filename.slice(dot) : '';
      filename = `${stem}-${id.slice(0, 8)}${ext}`;
    }
    const fh = await mediaRoot.getFileHandle(filename, { create: true });
    const writer = await fh.createWritable();
    await writer.write(file);
    await writer.close();

    const item: MediaItem = {
      id,
      element_id: elementId,
      folder,
      filename,
      mime: file.type,
      size_bytes: file.size,
      added_at: this.clock(),
    };
    // Sidecar metadata so we don't have to re-stat every file to enumerate items.
    const metaName = `${id}.meta.json`;
    await writeJsonAtomic(mediaRoot, metaName, item);
    return item;
  }

  async listMedia(elementId: string): Promise<MediaItem[]> {
    const elementDir = await tryGetDir(this.requireRoot(), [MEDIA_DIR, elementId]);
    if (!elementDir) return [];
    const out: MediaItem[] = [];
    // scan folder/* for *.meta.json
    // @ts-expect-error — values() is FS Access API, not in lib.dom
    for await (const folderEntry of elementDir.values()) {
      if (folderEntry.kind !== 'directory') continue;
      const folderHandle = folderEntry as FileSystemDirectoryHandle;
      const files = await listFiles(folderHandle);
      for (const name of files) {
        if (!name.endsWith('.meta.json')) continue;
        const item = await readJson<MediaItem>(folderHandle, name);
        if (item) out.push(item);
      }
    }
    return out;
  }

  async getMediaBlob(mediaId: string): Promise<Blob | null> {
    // Scan element folders for a matching meta sidecar, then return the blob.
    const mediaRoot = await tryGetDir(this.requireRoot(), [MEDIA_DIR]);
    if (!mediaRoot) return null;
    // @ts-expect-error — values()
    for await (const elementEntry of mediaRoot.values()) {
      if (elementEntry.kind !== 'directory') continue;
      const elementDir = elementEntry as FileSystemDirectoryHandle;
      // @ts-expect-error — values()
      for await (const folderEntry of elementDir.values()) {
        if (folderEntry.kind !== 'directory') continue;
        const folderHandle = folderEntry as FileSystemDirectoryHandle;
        const meta = await readJson<MediaItem>(folderHandle, `${mediaId}.meta.json`);
        if (!meta) continue;
        try {
          const fh = await folderHandle.getFileHandle(meta.filename);
          return await fh.getFile();
        } catch (err) {
          if (isNotFound(err)) return null;
          throw err;
        }
      }
    }
    return null;
  }

  async deleteMedia(mediaId: string): Promise<void> {
    this.assertWritable();
    const mediaRoot = await tryGetDir(this.requireRoot(), [MEDIA_DIR]);
    if (!mediaRoot) return;
    // @ts-expect-error — values()
    for await (const elementEntry of mediaRoot.values()) {
      if (elementEntry.kind !== 'directory') continue;
      const elementDir = elementEntry as FileSystemDirectoryHandle;
      // @ts-expect-error — values()
      for await (const folderEntry of elementDir.values()) {
        if (folderEntry.kind !== 'directory') continue;
        const folderHandle = folderEntry as FileSystemDirectoryHandle;
        const meta = await readJson<MediaItem>(folderHandle, `${mediaId}.meta.json`);
        if (!meta) continue;
        await removeFile(folderHandle, meta.filename);
        await removeFile(folderHandle, `${mediaId}.meta.json`);
        return;
      }
    }
  }

  async copyMediaDir(fromElementId: string, toElementId: string): Promise<number> {
    this.assertWritable();
    const fromDir = await tryGetDir(this.requireRoot(), [MEDIA_DIR, fromElementId]);
    if (!fromDir) return 0;
    // EVERYTHING under media/<from>/, at any depth: the
    // old directory is removed whole afterwards, so a file this copy skips is
    // a file deleted. Atlas writes media/<id>/<folder>/<file>, but a copied
    // or imported folder may hold loose files or deeper folders.
    const copyTree = async (src: FileSystemDirectoryHandle, destPath: string[]): Promise<number> => {
      const dest = await getDir(this.requireRoot(), destPath);
      const files: string[] = [];
      const dirs: FileSystemDirectoryHandle[] = [];
      // @ts-expect-error — values() is FS Access API, not in lib.dom
      for await (const entry of src.values()) {
        if (entry.kind === 'directory') dirs.push(entry as FileSystemDirectoryHandle);
        else if (!entry.name.endsWith('.tmp')) files.push(entry.name);
      }
      let n = 0;
      // Blobs before sidecars: `getMediaBlob` gives up on the
      // first sidecar whose blob is missing, so a sidecar never lands first.
      const sidecar = (name: string) => name.endsWith('.meta.json');
      for (const name of [...files.filter(f => !sidecar(f)), ...files.filter(sidecar)]) {
        const file = await (await src.getFileHandle(name)).getFile();
        if (sidecar(name)) {
          let item: MediaItem | null = null;
          try { item = JSON.parse(await file.text()) as MediaItem; } catch { item = null; }
          if (item && typeof item === 'object') {
            await writeJsonAtomic(dest, name, { ...item, element_id: toElementId });
            n++;
            continue;
          }
          // A sidecar that will not parse is copied byte for byte, never dropped.
        }
        const writer = await (await dest.getFileHandle(name, { create: true })).createWritable();
        await writer.write(file);
        await writer.close();
        n++;
      }
      for (const d of dirs) n += await copyTree(d, [...destPath, d.name]);
      return n;
    };
    return copyTree(fromDir, [MEDIA_DIR, toElementId]);
  }

  hasShadowCopy(id: string): boolean {
    return this.shadowedIds.has(id);
  }

  async removeMediaDir(elementId: string): Promise<void> {
    this.assertWritable();
    const mediaRoot = await tryGetDir(this.requireRoot(), [MEDIA_DIR]);
    if (!mediaRoot) return;
    try {
      await mediaRoot.removeEntry(elementId, { recursive: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async readRekeyJournal(): Promise<RekeyJournal | null> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    const journal = await readJsonStrict<RekeyJournal>(atlasDir, REKEY_JOURNAL_FILE);
    this.rekeyPendingIds = journalIds(journal);
    return journal;
  }

  async writeRekeyJournal(journal: RekeyJournal): Promise<void> {
    this.assertWritable();
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await this.atlasFileChain.run(REKEY_JOURNAL_FILE, () => writeJsonAtomic(atlasDir, REKEY_JOURNAL_FILE, journal));
    this.rekeyPendingIds = journalIds(journal);
  }

  async clearRekeyJournal(): Promise<void> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await this.atlasFileChain.run(REKEY_JOURNAL_FILE, () => removeFile(atlasDir, REKEY_JOURNAL_FILE));
    this.rekeyPendingIds = new Set();
  }

  async hasRekeyJournal(): Promise<boolean> {
    const atlasDir = await tryGetDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    if (!atlasDir) return false;
    try {
      await atlasDir.getFileHandle(REKEY_JOURNAL_FILE);
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      throw err;
    }
  }

  // ---- Sync-relevant reads ----

  async listLocallyChangedSince(baseline: string | null): Promise<Element[]> {
    const all = await this.listElements();
    return all.filter(elem => {
      if (isKnownOf(elem)) return false; // keel's stub never waits to be sent (conv. 155, I4)
      if (!elem.server_updated_at) return true;
      if (baseline === null) return elem.local_updated_at > elem.server_updated_at;
      return elem.local_updated_at > baseline;
    });
  }

  async listTombstonesSince(baseline: string | null): Promise<Tombstone[]> {
    const all = await this.readTombstoneList();
    if (baseline === null) return all;
    return all.filter(t => t.deleted_at > baseline);
  }

  async clearTombstone(id: string): Promise<void> {
    return this.runTombstoneOp(async () => {
      const all = await this.readTombstoneList();
      const next = all.filter(t => t.id !== id);
      await this.writeTombstoneList(next);
    });
  }

  async readSyncState(): Promise<SyncState> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    const state = await readJson<SyncState>(atlasDir, SYNC_STATE_FILE);
    return state ?? { ...DEFAULT_SYNC_STATE };
  }

  async writeSyncState(patch: Partial<SyncState>): Promise<SyncState> {
    return this.updateSyncState(() => patch);
  }

  async updateSyncState(mutate: (current: SyncState) => Partial<SyncState>): Promise<SyncState> {
    return this.runSyncStateOp(async () => {
      // Strict on the write path: merging into a corrupt file's null
      // would reset the cursor, conflicts and pending server deletes.
      const atlasDirR = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
      const current = (await readJsonStrict<SyncState>(atlasDirR, SYNC_STATE_FILE)) ?? { ...DEFAULT_SYNC_STATE };
      const next: SyncState = { ...current, ...mutate(current) };
      const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
      await writeJsonAtomic(atlasDir, SYNC_STATE_FILE, next);
      return next;
    });
  }

  async readCharts(): Promise<ChartConfig[]> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    const payload = await readJson<{ charts: ChartConfig[] }>(atlasDir, CHARTS_FILE);
    return payload?.charts ?? [];
  }

  async writeCharts(charts: ChartConfig[]): Promise<void> {
    this.assertWritable();
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await this.atlasFileChain.run(CHARTS_FILE, async () => {
      // The caller's list came from a tolerant read; a corrupt file read as
      // "no charts" must not be replaced by it.
      await readJsonStrict(atlasDir, CHARTS_FILE);
      await writeJsonAtomic(atlasDir, CHARTS_FILE, { charts });
    });
  }

  async readStyles(): Promise<WorldStyles> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    return parseWorldStyles(await readJson<unknown>(atlasDir, STYLES_FILE));
  }

  async writeStyles(styles: WorldStyles): Promise<void> {
    this.assertWritable();
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await this.atlasFileChain.run(STYLES_FILE, async () => {
      // Same guard as writeCharts: never replace a file we could not read.
      await readJsonStrict(atlasDir, STYLES_FILE);
      await writeJsonAtomic(atlasDir, STYLES_FILE, styles);
    });
  }

  async readWorldPrefs(): Promise<Record<string, unknown> | null> {
    const atlasDir = await tryGetDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    if (!atlasDir) return null;
    const raw = await readJsonStrict<unknown>(atlasDir, WORLD_PREFS_FILE);
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  }

  async writeWorldPrefs(prefs: Record<string, unknown>): Promise<void> {
    this.assertWritable();
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await this.atlasFileChain.run(WORLD_PREFS_FILE, async () => {
      await readJsonStrict(atlasDir, WORLD_PREFS_FILE); // never replace a file we could not read
      await writeJsonAtomic(atlasDir, WORLD_PREFS_FILE, prefs);
    });
  }

  /**
   * Move a file out of the element folders into `.atlas/quarantine/<type>/`,
   * keeping its name (numbered if taken). The body is re-serialised, not
   * byte-copied: the content is what matters and the original was valid JSON.
   */
  private async quarantineFile(dir: FileSystemDirectoryHandle, filename: string, body: Element, type: ElementType): Promise<void> {
    if (!this.root) return;
    const qdir = await getDir(this.root, [ATLAS_INTERNAL_DIR, 'quarantine', type]);
    let name = filename;
    for (let n = 2; await qdir.getFileHandle(name).then(() => true, () => false); n++) {
      name = filename.replace(/\.json$/i, '') + `-${n}.json`;
    }
    await writeJsonAtomic(qdir, name, body);
    await removeFile(dir, filename);
  }

  async stampServerUpdatedAt(id: string, _type: ElementType, server_updated_at: string, sentLocalUpdatedAt?: string | null, kept?: Readonly<Record<string, unknown>>): Promise<void> {
    // Serialize with update/delete on the same id (#79). The SyncEngine calls
    // this after a push; without the chain a concurrent local edit could land
    // between this read and write, and the stamp would revert it to a stale body.
    return this.writeChain.run(id, async () => {
      const existing = await this.readForWrite(id);
      if (!existing) return;
      const next = stampedBody(existing, server_updated_at, sentLocalUpdatedAt, kept);
      const entry = this.indexEntry(id);
      const filename = entry?.filename ?? elementFilename(id, existing.name);
      const dir = await this.dirForElement(id, existing.type);
      await this.writeElementFile(dir, filename, next);
      this.cacheSet(next);
    });
  }

  async clearServerBaseline(id: string): Promise<void> {
    return this.writeChain.run(id, async () => {
      const existing = await this.readForWrite(id);
      if (!existing) return;
      const { server_updated_at: _drop, ...rest } = existing;
      const entry = this.indexEntry(id);
      const filename = entry?.filename ?? elementFilename(id, existing.name);
      const dir = await this.dirForElement(id, existing.type);
      await this.writeElementFile(dir, filename, rest as Element);
      this.cacheSet(rest as Element);
    });
  }

  async resetSyncBaseline(): Promise<void> {
    // 1. Strip server_updated_at from every element (across every type bucket).
    //    Touching only files that ACTUALLY had a baseline keeps churn minimal
    //    on never-synced folders. Iteration is sequential — atomic writes per
    //    file matter more than parallelism here.
    //    Each clear rides the per-id chain and merges into the file AS IT IS
    //    ON DISK (rewriting from the cache reverted outside
    //    edits and raced a save landing during the unlink).
    const all = await this.listElements();
    let cleared = 0;
    for (const elem of all) {
      if (!elem.server_updated_at) continue;
      await this.clearServerBaseline(elem.id);
      cleared++;
    }
    // 2. Drop every tombstone — they target ids on the now-defunct api world.
    //    On the tombstone chain: a delete appending at this moment
    //    must not race this write through the same tmp.
    await this.runTombstoneOp(() => this.writeTombstoneList([]));
    // 3. Reset sync-state.json to the default empty-history shape. This also
    //    clears any persisted conflicts + server_deletes from the old world.
    //    On the sync-state chain: a round recording state right now
    //    otherwise overlaps this write (one tmp, two writers).
    await this.runSyncStateOp(async () => {
      const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
      await writeJsonAtomic(atlasDir, SYNC_STATE_FILE, { ...DEFAULT_SYNC_STATE });
    });
    // 4. Strip the api block from world.json so a future reload-and-rescan
    //    (e.g., handle re-permission, fresh atlas root setup) doesn't try to
    //    auto-attach against dead credentials. Rides the world-meta chain —
    //    it rewrites the same file writeWorldMeta serializes.
    let hadApi = false;
    await this.runWorldMetaOp(async () => {
      // Strict: a world.json that will not parse must not be replaced
      // by the empty default minus its api block.
      const meta = await this.readWorldMeta({ strict: true });
      hadApi = !!meta.api;
      const { api: _dropApi, ...metaRest } = meta;
      await writeJsonAtomic(this.requireRoot(), WORLD_META_FILE, metaRest as WorldMeta);
    });
    console.info('[atlas:folder] resetSyncBaseline complete', {
      elementsCleared: cleared,
      apiStripped: hadApi,
    });
  }

  /**
   * Pull-apply rides the per-id write chain: it used to be
   * the one element write outside it, so a user save landing between the
   * engine's race check and this write was overwritten and read as synced.
   */
  async applyServerRecord(
    type: ElementType, record: Record<string, unknown>, server_updated_at: string,
    opts: ApplyServerRecordOpts = {},
  ): Promise<Element> {
    const id = record.id as string;
    if (!id) throw new Error('applyServerRecord: record missing id');
    return this.writeChain.run(id, () => this.applyServerRecordUnchained(type, record, server_updated_at, opts));
  }

  /**
   * Apply only if the element's `local_updated_at` still equals the one the
   * caller decided on (null = the element did not exist). The check and the
   * write happen inside ONE chain slot, so an edit can no longer land between
   * them. Returns false when the element moved (the next round reconciles).
   */
  async applyServerRecordIfUnchanged(
    type: ElementType, record: Record<string, unknown>, server_updated_at: string,
    expectedLocalUpdatedAt: string | null,
  ): Promise<boolean> {
    const id = record.id as string;
    if (!id) throw new Error('applyServerRecord: record missing id');
    return this.writeChain.run(id, async () => {
      // The file AS IT IS ON DISK: an outside edit that followed the
      // toolkit's rule (a fresh `local_updated_at`) moved the stamp the engine
      // decided on, so the pull backs off instead of overwriting it, even
      // when no live-folder pass has adopted the edit yet. `readForWrite`
      // adopts the disk body into the cache; a file that will not parse
      // throws CorruptFileError, which pauses the round with the file named.
      const current = await this.readForWrite(id);
      if ((current?.local_updated_at ?? null) !== expectedLocalUpdatedAt) return false;
      await this.applyServerRecordUnchained(type, record, server_updated_at);
      return true;
    });
  }

  private async applyServerRecordUnchained(
    type: ElementType, served: Record<string, unknown>, server_updated_at: string,
    opts: ApplyServerRecordOpts = {},
  ): Promise<Element> {
    // keel's stub is written as a stub, its unset fields left out (conv. 155, I1); a
    // whole record over a stub file drops `known_of` with the rest of the old file (I2).
    const stub = isKnownOf(served);
    const record = stub ? stubShape(served) : served;
    const id = record.id as string;

    // Preserve atlas-extension fields from the existing local file per the
    // split policy:
    //   - LOCAL_ONLY fields (image_media_id, page blocks, richtext, ...):
    //     ALWAYS preserved — the server never knows them, so its response
    //     carries none; overlaying directly would silently destroy the local
    //     binding (e.g. a Map's locally-uploaded image pointer).
    //   - WIRE extension fields (zone visual prefs): the server round-trips
    //     them under v2, so a server value LANDS like any normal field.
    //     Preserved from local only when the server record lacks the field
    //     entirely (last written by a v1-era or non-atlas client).
    // Sync metadata (local_updated_at, server_updated_at) is set
    // authoritatively below, so we don't carry it over from existing.
    const existing = await this.getElement(id);
    const preserved: Record<string, unknown> = {};
    if (existing) {
      for (const field of ATLAS_LOCAL_ONLY_FIELDS) {
        if (opts.dropLocal?.includes(field)) continue;
        if (field === HIDDEN_SHOWN_ONLINE) continue; // the record is keel's word on the mark (conv. 170)
        if (stub && KNOWN_OF_DROPS_LOCAL.includes(field)) continue; // a mirror of a field the stub leaves unset
        const value = (existing as Record<string, unknown>)[field];
        if (value !== undefined) preserved[field] = value;
      }
      // A stub's wire fields are unknown, not kept from the whole copy (I1).
      for (const field of stub ? [] : ATLAS_WIRE_EXTENSION_FIELDS) {
        if (field in record) continue; // server value wins when present
        const value = (existing as Record<string, unknown>)[field];
        if (value !== undefined) preserved[field] = value;
      }
    }

    const elem: Element = {
      ...record,
      ...preserved,
      id,
      type,
      name: (record.name as string) ?? '',
      local_updated_at: server_updated_at,
      server_updated_at,
    };
    // Pull-side rename: the server may have changed the name, which changes
    // the slug-prefix filename. writeElementAndRename handles the rename +
    // dedupe path.
    const previousName = existing?.name ?? '';
    await this.writeElementAndRename(type, id, elem, previousName);

    // Diagnostic: read the file back immediately and confirm content matches.
    // Catches "write reports success but disk content didn't change" Chromium
    // quirks that the in-flight write-buffer can mask.
    try {
      const dir = await this.dirForElement(id, type);
      const entry = this.indexEntry(id);
      const filename = entry?.filename ?? elementFilename(id, elem.name);
      const readback = await readJson<Element>(dir, filename);
      const writtenDesc = typeof elem.description === 'string' ? (elem.description as string).slice(0, 60) : undefined;
      const readDesc = typeof readback?.description === 'string' ? (readback.description as string).slice(0, 60) : undefined;
      if (writtenDesc !== readDesc) {
        console.warn('[fs-folder-store] applyServerRecord: post-write readback DIFFERS', {
          id,
          type,
          intendedDescription: writtenDesc,
          diskDescription: readDesc,
        });
      } else {
        // Successful readback fires per element on every pull — log at debug
        // so dev tools default-filter excludes it. The DIFFERS branch above
        // stays at warn since it indicates an actual data-integrity event.
        console.debug('[fs-folder-store] applyServerRecord: post-write readback ok', {
          id,
          type,
          descriptionPreview: readDesc,
        });
      }
    } catch (err) {
      console.warn('[fs-folder-store] applyServerRecord: post-write readback failed:', err);
    }

    return elem;
  }

  // ---- Internals ----

  private async readTombstoneList(): Promise<Tombstone[]> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    // Strict: every append/clear writes this list back whole, so a
    // corrupt file read as empty would silently drop every pending delete.
    const payload = await readJsonStrict<{ deletions: Tombstone[] }>(atlasDir, TOMBSTONES_FILE);
    return payload?.deletions ?? [];
  }

  private async writeTombstoneList(deletions: Tombstone[]): Promise<void> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await writeJsonAtomic(atlasDir, TOMBSTONES_FILE, { deletions });
  }

  private appendTombstone(t: Tombstone): Promise<void> {
    return this.runTombstoneOp(async () => {
      const existing = await this.readTombstoneList();
      existing.push(t);
      await this.writeTombstoneList(existing);
    });
  }

  // ---- Test introspection ----

  __debug_tabId(): string { return this.tabId; }

  async __debug_readLock(): Promise<LockPayload | null> {
    if (!this.root) return null;
    const atlasDir = await tryGetDir(this.root, [ATLAS_INTERNAL_DIR]);
    if (!atlasDir) return null;
    return await readJson<LockPayload>(atlasDir, LOCK_FILE);
  }

  /**
   * Manually trigger a heartbeat refresh. Tests use this to bump the lock
   * without waiting for the interval timer.
   */
  async __debug_heartbeat(): Promise<void> {
    await this.refreshHeartbeat();
  }
}

// idFromFilename re-export so consumers can roundtrip ids without importing fs-utils.
export { idFromFilename };

/**
 * Per-tab stable id. Persists across reloads (sessionStorage) so a reloaded
 * tab can reclaim its own lock instead of seeing it as held by a stranger.
 * Each genuinely-new browser tab gets a fresh id.
 *
 * Tests that need a deterministic id pass `opts.tabId` directly and bypass this.
 */
/** This tab's id, as its locks carry it (a move's recovery asks whether a lock is ours). */
export function currentTabId(): string {
  return getOrCreateTabId();
}

function getOrCreateTabId(): string {
  const KEY = 'atlas_tab_id';
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = newId();
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    // No sessionStorage (e.g. private mode under strict settings). Best-effort: fresh id.
    return newId();
  }
}

/** The live folder's key for an element file Atlas does not serve. */
function otherFileKey(type: ElementType, layout: LayoutDir, filename: string): string {
  return `${layout}|${type}|${filename}`;
}

/** The inverse of `otherFileKey`. */
function splitOtherFileKey(key: string): [LayoutDir, ElementType, string] {
  const a = key.indexOf('|');
  const b = key.indexOf('|', a + 1);
  return [key.slice(0, a) as LayoutDir, key.slice(a + 1, b) as ElementType, key.slice(b + 1)];
}

/** A stamp as one comparable string ('' when unknown, which never matches a real stat). */
function stampKey(stamp: FileStamp | undefined): string {
  return stamp ? `${stamp.lastModified}:${stamp.size}` : '';
}

/** Two bodies are the same element state when they differ only in the sync stamps (a rename-crash twin). */
function sameContentIgnoringStamps(a: Element, b: Element): boolean {
  const canon = (e: Element): string => {
    const { local_updated_at: _l, server_updated_at: _s, ...rest } = e as Element & Record<string, unknown>;
    // Top-level keys sorted; nested values stringified whole. (A replacer
    // ARRAY would also filter nested keys and call differing bodies equal.)
    // A key holding `undefined` is dropped, as JSON drops it on disk: a body
    // Atlas wrote with one looked "changed" against its own file.
    const keys = Object.keys(rest).filter(k => (rest as Record<string, unknown>)[k] !== undefined).sort();
    return JSON.stringify(keys.map(k => [k, (rest as Record<string, unknown>)[k]]));
  };
  return canon(a) === canon(b);
}

/**
 * SHAPE FALLBACK, the sibling of the type fallback above: a foreign
 * writer can put a number where the schema says string, or a numeric string
 * where it says number. Coerce the few fields atlas's own code assumes, in
 * memory, so one converter's `"name": 1453` does not blank the element list
 * and search (every sort and filter calls string methods on `name`), and a
 * `"x": "120"` pin still lands on its map. Written back as the schema's type
 * only if atlas later saves the element.
 */
function coerceForeignShapes(body: Element): void {
  const rec = body as unknown as Record<string, unknown>;
  const name: unknown = rec.name;
  if (name !== undefined && name !== null && typeof name !== 'string') {
    rec.name = typeof name === 'number' || typeof name === 'boolean' ? String(name)
      : Array.isArray(name) ? name.filter((v: unknown) => typeof v === 'string').join(', ')
      : '';
  }
  for (const k of ['x', 'y', 'z', 'order'] as const) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) rec[k] = Number(v);
  }
}
