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
 * checks the lock: missing or older than LOCK_STALE_MS → take it. Otherwise →
 * open in read-only mode (writes throw).
 */

import {
  ATLAS_INTERNAL_DIR,
  ATLAS_LOCAL_ONLY_FIELDS,
  ATLAS_WIRE_EXTENSION_FIELDS,
  CHARTS_FILE,
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
} from '../core/constants';
import type { LayoutDir } from '../core/constants';
import { ALL_ELEMENT_TYPES, CONTENT_ELEMENT_TYPES, SPATIAL_ELEMENT_TYPES } from '../core/types';
import { findDuplicatePin, DuplicatePinError } from '../core/pin-uniqueness';
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
import type { FolderStore, ListElementsOptions } from './folder-store';
import type { ChartConfig } from '../visualization/timeline/types';
import { newId, nowIso } from './folder-store';

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
  /** id → the file that survived same-directory crash-twin dedupe. */
  survivors: Map<string, { filename: string; body: Element }>;
  /** Lowercased names of files the scan could not read — never a tidy target. */
  unreadableLc: Set<string>;
}
import { PerIdWriteChain } from './write-chain';
import {
  elementDirSegmentsIn,
  elementFilename,
  elementFilenameFullId,
  getDir,
  idFromFilename,
  isNotFound,
  listFiles,
  readJson,
  removeFile,
  sameFsName,
  tryGetDir,
  validElementFilenames,
  writeJsonAtomic,
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
}

export class FsFolderStore implements FolderStore {
  private root: FileSystemDirectoryHandle | null = null;
  private clock: () => string;
  private tabId: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private opts: FsFolderStoreOptions;
  /** View-only world (S264) — UI mutations throw; sync channels bypass. */
  private viewOnly = false;

  setViewOnly(viewOnly: boolean): void { this.viewOnly = viewOnly; }

  /** The view-only guard. Sits on the UI-facing mutators; the engine's write
   *  channels (applyServerRecord, silent deletes, fromSync meta) skip it. */
  private assertWritable(): void {
    if (this.viewOnly) throw new Error('This world is view-only');
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
  private fileIndex: Map<string, { type: ElementType; layout: LayoutDir; filename: string }> = new Map();
  /**
   * Where NEW spatial elements go in THIS world. Detected once at open:
   * `spatial/` when the folder already keeps spatial files there (an atlas
   * v1.0-era world), `elements/` otherwise — which is every world any other
   * tool writes, and every world atlas creates from now on.
   */
  private spatialWriteLayout: LayoutDir = ELEMENTS_DIR;
  /** Set of types whose dirs have been scanned into fileIndex. */
  private indexedTypes: Set<ElementType> = new Set();
  /**
   * Parsed element bodies, id → body (speed bout, 2026-07-19). The index pass
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
   * Store-global serialization for `world.json` (world-meta sync gate R4,
   * 2026-07-13). writeWorldMeta is a read-merge-write of one shared file with
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

  constructor(opts: FsFolderStoreOptions = {}) {
    this.opts = opts;
    this.clock = opts.clock ?? nowIso;
    this.tabId = opts.tabId ?? getOrCreateTabId();
  }

  // ---- Lifecycle ----

  async open(handle: FileSystemDirectoryHandle | null): Promise<void> {
    if (!handle) throw new Error('FsFolderStore.open requires a directory handle');
    this.root = handle;
    await this.detectSpatialLayout();
    await this.ensureLayout();
    await this.claimLock();
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
      // OTHER tab's live lock (parking bout, 2026-07-19).
      if (atlasDir) {
        const lock = await readJson<LockPayload>(atlasDir, LOCK_FILE).catch(() => null);
        if (lock && lock.tab_id === this.tabId) await removeFile(atlasDir, LOCK_FILE);
      }
    }
    this.root = null;
    this.fileIndex.clear();
    this.indexedTypes.clear();
    this.bodyCache.clear();
    this.indexBuilds.clear();
  }

  /**
   * Park (speed bout, 2026-07-19): stop heartbeating but KEEP the root, lock
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
    // Stale the on-disk heartbeat immediately (close-gate MED, 2026-07-19):
    // a parked lock with a fresh-looking heartbeat would make other tabs
    // (including a relaunch after tab close) sit behind the 90s wall with a
    // scary "open in another tab — take over?" prompt for worlds no tab is
    // using. Parked = takeable instantly; unpark still verifies tab_id, so
    // a takeover is detected and forces the cold reopen. Best-effort.
    void (async () => {
      try {
        if (!this.root) return;
        const atlasDir = await getDir(this.root, [ATLAS_INTERNAL_DIR]);
        const lock = await readJson<LockPayload>(atlasDir, LOCK_FILE);
        if (lock && lock.tab_id === this.tabId) {
          await writeJsonAtomic(atlasDir, LOCK_FILE, { ...lock, last_heartbeat: new Date(0).toISOString() });
        }
      } catch { /* parked lock staling is best-effort */ }
    })();
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
    try {
      const atlasDir = await getDir(this.root, [ATLAS_INTERNAL_DIR]);
      const lock = await readJson<LockPayload>(atlasDir, LOCK_FILE);
      if (!lock || lock.tab_id !== this.tabId) return false;
      await writeJsonAtomic(atlasDir, LOCK_FILE, { ...lock, last_heartbeat: this.clock() });
    } catch {
      return false;
    }
    if (!this.opts.disableHeartbeat && !this.heartbeatTimer) {
      this.heartbeatTimer = setInterval(() => {
        this.refreshHeartbeat().catch(err => console.warn('[fs-folder-store] heartbeat:', err));
      }, LOCK_HEARTBEAT_MS);
    }
    return true;
  }

  // ---- Layout setup + lock ----

  /**
   * Decide where this world's NEW spatial elements go, BEFORE ensureLayout
   * creates anything (otherwise every world would look legacy the moment we
   * made the directories).
   *
   * The test is FILES, not directories: an atlas world that never had a map
   * still carries four empty `spatial/` dirs from the old ensureLayout, and
   * an empty legacy dir is not a layout — it is litter. One `.json` under
   * `spatial/<type>/` means this folder's maps genuinely live there, so we
   * keep writing there and the folder stays internally coherent for whatever
   * other tool reads it next.
   */
  private async detectSpatialLayout(): Promise<void> {
    const root = this.requireRoot();
    for (const t of SPATIAL_ELEMENT_TYPES) {
      const dir = await tryGetDir(root, [SPATIAL_DIR, t]);
      if (!dir) continue;
      const files = await listFiles(dir);
      if (files.some(f => f.endsWith('.json'))) {
        this.spatialWriteLayout = SPATIAL_DIR;
        return;
      }
    }
    this.spatialWriteLayout = ELEMENTS_DIR;
  }

  private async ensureLayout(): Promise<void> {
    const root = this.requireRoot();
    await getDir(root, [ATLAS_INTERNAL_DIR]);
    await getDir(root, [ELEMENTS_DIR]);
    await getDir(root, [MEDIA_DIR]);
    for (const t of CONTENT_ELEMENT_TYPES) await getDir(root, [ELEMENTS_DIR, t]);
    // Spatial dirs are created in whichever layout this world uses. A world
    // that has never held a map gets `elements/<type>/` for all 22 and no
    // `spatial/` at all — atlas stops minting a legacy directory tree inside
    // folders it was merely asked to open.
    for (const t of SPATIAL_ELEMENT_TYPES) await getDir(root, [this.spatialWriteLayout, t]);
  }

  private async claimLock(): Promise<void> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    const existing = await readJson<LockPayload>(atlasDir, LOCK_FILE);
    if (existing) {
      const heartbeat = Date.parse(existing.last_heartbeat);
      const age = Date.now() - heartbeat;
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

  private async refreshHeartbeat(): Promise<void> {
    if (!this.root) return;
    const atlasDir = await getDir(this.root, [ATLAS_INTERNAL_DIR]);
    const existing = await readJson<LockPayload>(atlasDir, LOCK_FILE);
    if (!existing || existing.tab_id !== this.tabId) {
      // Lock was taken by another tab; stop heartbeating.
      if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
      return;
    }
    await writeJsonAtomic(atlasDir, LOCK_FILE, { ...existing, last_heartbeat: this.clock() });
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
    // In-flight guard: type indexes build CONCURRENTLY across types (speed
    // bout), so two callers racing the same type must share one build — a
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
   * Order matters: `elements/` is scanned FIRST, so when the same element id
   * exists in both layouts and the tie cannot be broken by timestamp, the
   * canonical copy is the one served.
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
    // destroying half of it. Newest `local_updated_at` is served, ties go to
    // `elements/`, and the shadowed copy is named in a warning so the state
    // is discoverable rather than mysterious.
    for (const { layout, scan } of perLayout) {
      for (const [id, rec] of scan.survivors) {
        const existing = this.fileIndex.get(id);
        if (existing && existing.type === type) {
          const kept = this.bodyCache.get(id);
          const keptStamp = kept?.local_updated_at ?? '';
          const challengerStamp = rec.body.local_updated_at ?? '';
          const challengerWins = challengerStamp > keptStamp;
          console.warn(
            `[fs-folder-store] index(${type}): id ${id} exists in BOTH layouts ` +
            `(${existing.layout}/${existing.filename} and ${layout}/${rec.filename}); ` +
            `serving the ${challengerWins ? layout : existing.layout} copy. Neither file was touched.`
          );
          if (!challengerWins) continue;
        }
        this.fileIndex.set(id, { type, layout, filename: rec.filename });
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
    // Read pass (speed bout, 2026-07-19): ONE directory enumeration collects
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
    files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    type Rec = { filename: string; body: Element };
    const bodies: Array<Element | null> = new Array(files.length);
    let cursor = 0;
    const readWorker = async () => {
      while (cursor < files.length) {
        const i = cursor++;
        try {
          const file = await files[i].handle.getFile();
          bodies[i] = JSON.parse(await file.text()) as Element;
        } catch {
          bodies[i] = null; // unreadable/corrupt — same null contract as readJson
        }
        this.indexTick?.();
      }
    };
    await Promise.all(Array.from({ length: Math.min(INDEX_READ_CONCURRENCY, files.length) }, readWorker));
    // ZOMBIE GUARD (close-gate finding, 2026-07-19): the store may have been
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
      const list = grouped.get(body.id);
      if (list) list.push({ filename, body });
      else grouped.set(body.id, [{ filename, body }]);
    }
    // Dedupe crash-twins FIRST for every group (grouping is by body id, so a
    // same-named stranger can never be a "loser"), building the survivor set.
    const survivors = new Map<string, Rec>();
    for (const [id, recs] of grouped) {
      if (!this.root) return null; // closed mid-dedupe — stop unlinking losers
      recs.sort((a, b) =>
        (a.body.local_updated_at ?? '') < (b.body.local_updated_at ?? '') ? 1
        : (a.body.local_updated_at ?? '') > (b.body.local_updated_at ?? '') ? -1 : 0);
      const [survivor, ...losers] = recs;
      for (const loser of losers) {
        await removeFile(dir, loser.filename).catch(() => {});
      }
      if (losers.length > 0) {
        console.warn(`[fs-folder-store] dedupe(${type}@${layout}): kept ${survivor.filename}, removed ${losers.map(l => l.filename).join(', ')}`);
      }
      survivors.set(id, survivor);
    }

    // Index + cache happen in the caller AS THE FILES ARE — filenames are
    // presentation, the body id is identity, so nothing about serving needs
    // canonical names. The caller also schedules this directory's tidy.
    return { dir, survivors, unreadableLc: new Set([...unreadable].map(n => n.toLowerCase())) };
  }

  /**
   * Background filename-convergence pass (the S246 lazy tidy, deferred OUT
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
            const body = this.bodyCache.get(id);
            if (!entry || entry.type !== type || entry.layout !== layout || !body) return; // deleted or re-homed meanwhile
            const filename = entry.filename;
            const short = elementFilename(id, body.name);
            const fullForm = elementFilenameFullId(id, body.name);
            const target = isFree(short, id) ? short
              : sameFsName(filename, fullForm) || isFree(fullForm, id) ? fullForm
              : filename; // both forms taken (pathological) — leave it alone
            if (sameFsName(filename, target)) {
              occupied.set(filename.toLowerCase(), id);
              return;
            }
            // Distinct entries by construction (target is free, lc-equality
            // excluded), so write-new + remove-old cannot self-delete on a
            // case-folding filesystem.
            await writeJsonAtomic(dir, target, body);
            await removeFile(dir, filename).catch(() => {});
            occupied.delete(filename.toLowerCase());
            occupied.set(target.toLowerCase(), id);
            this.fileIndex.set(id, { type, layout, filename: target });
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

  /** Where NEW elements of this type are written in THIS world. */
  private writeLayoutFor(type: ElementType): LayoutDir {
    return SPATIAL_TYPES.has(type) ? this.spatialWriteLayout : ELEMENTS_DIR;
  }

  /** The layout an element ACTUALLY lives in: its recorded one, else the write default. */
  private layoutOf(id: string, type: ElementType): LayoutDir {
    return this.fileIndex.get(id)?.layout ?? this.writeLayoutFor(type);
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
  private indexEntry(id: string): { type: ElementType; layout: LayoutDir; filename: string } | undefined {
    return this.fileIndex.get(id);
  }

  /** Record a new or updated file binding. */
  private setIndex(id: string, type: ElementType, layout: LayoutDir, filename: string): void {
    this.fileIndex.set(id, { type, layout, filename });
  }

  // ---- World meta ----

  async readWorldMeta(): Promise<WorldMeta> {
    const meta = await readJson<WorldMeta>(this.requireRoot(), WORLD_META_FILE);
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
    if (!opts?.fromSync) this.assertWritable(); // engine pull-apply bypasses (S264)
    // Serialized read-merge-write (world-meta gate R4): the read and the
    // write happen atomically relative to every other meta writer, so a
    // background pull-apply can never erase a concurrent user edit.
    return this.runWorldMetaOp(async () => {
      const current = await this.readWorldMeta();
      const next: WorldMeta = { ...current, ...patch };
      await writeJsonAtomic(this.requireRoot(), WORLD_META_FILE, next);
      return next;
    });
  }

  // ---- Elements (unified content + spatial) ----

  async listElements(type?: ElementType, opts?: ListElementsOptions): Promise<Element[]> {
    const types = type ? [type] : (ALL_ELEMENT_TYPES as readonly ElementType[]);
    // Progress plumbing (speed bout): totals come from a cheap pre-count of
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
        // (close-gate finding, 2026-07-19).
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
    const misses: Array<{ id: string; type: ElementType; layout: LayoutDir; filename: string }> = [];
    for (const [id, entry] of this.fileIndex) {
      const bucket = buckets.get(entry.type);
      if (!bucket) continue;
      const body = this.bodyCache.get(id);
      if (body) bucket.push(structuredClone(body));
      else misses.push({ id, type: entry.type, layout: entry.layout, filename: entry.filename });
    }
    for (const miss of misses) {
      const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(miss.layout, miss.type));
      if (!dir) continue;
      const elem = await readJson<Element>(dir, miss.filename);
      if (elem) {
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
    this.bodyCache.set(id, elem);
    return structuredClone(elem);
  }

  async createElement(type: ElementType, data: Partial<Element>): Promise<Element> {
    this.assertWritable();
    const id = (data.id as string) ?? newId();
    // ONE ELEMENT, ONE PIN, ONE MAP (S307). Guarded HERE and not in
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
    const layout = this.writeLayoutFor(type);
    const dir = await getDir(this.requireRoot(), elementDirSegmentsIn(layout, type));
    const filename = this.resolveFilename(type, layout, id, elem.name);
    await writeJsonAtomic(dir, filename, elem);
    this.setIndex(id, type, layout, filename);
    this.cacheSet(elem);
    return elem;
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
      const existing = await this.getElement(id);
      if (!existing) return null;
      const patch = mutate(existing);
      if (patch === null || Object.keys(patch).length === 0) return existing;
      return this.applyPatchUnchained(existing, patch);
    });
  }

  private async updateElementUnchained(id: string, patch: Partial<Element>): Promise<Element> {
    const existing = await this.getElement(id);
    if (!existing) throw new Error(`element ${id} not found`);
    return this.applyPatchUnchained(existing, patch);
  }

  private async applyPatchUnchained(existing: Element, patch: Partial<Element>): Promise<Element> {
    const next: Element = {
      ...existing,
      ...patch,
      id: existing.id,
      type: existing.type,
      local_updated_at: this.clock(),
      server_updated_at: patch.server_updated_at ?? existing.server_updated_at,
    };
    await this.writeElementAndRename(existing.type, existing.id, next, existing.name);
    return next;
  }

  /**
   * Write an element body, renaming the file only when the name (and
   * therefore the slug) genuinely changed since the last write.
   *
   * STICKY RULE (gate finding, 2026-07-03): the file keeps its current name
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
    const layout = entry?.layout ?? this.writeLayoutFor(type);
    const dir = await getDir(this.requireRoot(), elementDirSegmentsIn(layout, type));
    const currentFilename = entry?.filename ?? elementFilename(id, previousName);
    if (validElementFilenames(id, next.name).some(f => sameFsName(f, currentFilename))) {
      await writeJsonAtomic(dir, currentFilename, next);
      this.setIndex(id, type, layout, currentFilename);
      this.cacheSet(next);
      return;
    }
    // Name genuinely changed — write the new file first, then remove the old.
    // resolveFilename outputs are valid forms and lc-equality with the current
    // name was excluded above, so old and new are DISTINCT physical entries
    // even on case-folding filesystems. A crash between the two steps is
    // covered by ensureIndexFor's dedupe (latest local_updated_at wins).
    const newFilename = this.resolveFilename(type, layout, id, next.name);
    await writeJsonAtomic(dir, newFilename, next);
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
    // Same chain as updateElement: an in-flight update to this id lands (or
    // fails) before the file disappears — no "element not found" tail errors.
    return this.writeChain.run(id, () => this.deleteElementUnchained(id, opts));
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
        // EACH DEPENDENT GOES THROUGH ITS OWN WRITE CHAIN (S310).
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
        // lands in that window. Found by the S310 integration gate — the
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
    const dir = await tryGetDir(this.requireRoot(), elementDirSegmentsIn(this.layoutOf(elem.id, elem.type), elem.type));
    if (!dir) return;
    const entry = this.indexEntry(elem.id);
    const filename = entry?.filename ?? elementFilename(elem.id, elem.name);
    await removeFile(dir, filename);
    this.fileIndex.delete(elem.id);
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

  // ---- Sync-relevant reads ----

  async listLocallyChangedSince(baseline: string | null): Promise<Element[]> {
    const all = await this.listElements();
    return all.filter(elem => {
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
      const current = await this.readSyncState();
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
    await writeJsonAtomic(atlasDir, CHARTS_FILE, { charts });
  }

  async stampServerUpdatedAt(id: string, _type: ElementType, server_updated_at: string): Promise<void> {
    // Serialize with update/delete on the same id (#79). The SyncEngine calls
    // this after a push; without the chain a concurrent local edit could land
    // between this read and write, and the stamp would revert it to a stale body.
    return this.writeChain.run(id, async () => {
      const existing = await this.getElement(id);
      if (!existing) return;
      const next: Element = { ...existing, server_updated_at };
      const entry = this.indexEntry(id);
      const filename = entry?.filename ?? elementFilename(id, existing.name);
      const dir = await this.dirForElement(id, existing.type);
      await writeJsonAtomic(dir, filename, next);
      this.cacheSet(next);
    });
  }

  async clearServerBaseline(id: string): Promise<void> {
    return this.writeChain.run(id, async () => {
      const existing = await this.getElement(id);
      if (!existing) return;
      const { server_updated_at: _drop, ...rest } = existing;
      const entry = this.indexEntry(id);
      const filename = entry?.filename ?? elementFilename(id, existing.name);
      const dir = await this.dirForElement(id, existing.type);
      await writeJsonAtomic(dir, filename, rest as Element);
      this.cacheSet(rest as Element);
    });
  }

  async resetSyncBaseline(): Promise<void> {
    // 1. Strip server_updated_at from every element (across every type bucket).
    //    Touching only files that ACTUALLY had a baseline keeps churn minimal
    //    on never-synced folders. Iteration is sequential — atomic writes per
    //    file matter more than parallelism here.
    const all = await this.listElements();
    let cleared = 0;
    for (const elem of all) {
      if (!elem.server_updated_at) continue;
      const { server_updated_at: _drop, ...rest } = elem;
      const entry = this.indexEntry(elem.id);
      const filename = entry?.filename ?? elementFilename(elem.id, elem.name);
      const dir = await this.dirForElement(elem.id, elem.type);
      await writeJsonAtomic(dir, filename, rest as Element);
      this.cacheSet(rest as Element);
      cleared++;
    }
    // 2. Drop every tombstone — they target ids on the now-defunct api world.
    await this.writeTombstoneList([]);
    // 3. Reset sync-state.json to the default empty-history shape. This also
    //    clears any persisted conflicts + server_deletes from the old world.
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await writeJsonAtomic(atlasDir, SYNC_STATE_FILE, { ...DEFAULT_SYNC_STATE });
    // 4. Strip the api block from world.json so a future reload-and-rescan
    //    (e.g., handle re-permission, fresh atlas root setup) doesn't try to
    //    auto-attach against dead credentials. Rides the world-meta chain —
    //    it rewrites the same file writeWorldMeta serializes (gate R4).
    let hadApi = false;
    await this.runWorldMetaOp(async () => {
      const meta = await this.readWorldMeta();
      hadApi = !!meta.api;
      const { api: _dropApi, ...metaRest } = meta;
      await writeJsonAtomic(this.requireRoot(), WORLD_META_FILE, metaRest as WorldMeta);
    });
    console.info('[atlas:folder] resetSyncBaseline complete', {
      elementsCleared: cleared,
      apiStripped: hadApi,
    });
  }

  async applyServerRecord(type: ElementType, record: Record<string, unknown>, server_updated_at: string): Promise<Element> {
    const id = record.id as string;
    if (!id) throw new Error('applyServerRecord: record missing id');

    // Preserve atlas-extension fields from the existing local file per the
    // split policy (gate 10.3, v2 port):
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
        const value = (existing as Record<string, unknown>)[field];
        if (value !== undefined) preserved[field] = value;
      }
      for (const field of ATLAS_WIRE_EXTENSION_FIELDS) {
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
    const payload = await readJson<{ deletions: Tombstone[] }>(atlasDir, TOMBSTONES_FILE);
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
