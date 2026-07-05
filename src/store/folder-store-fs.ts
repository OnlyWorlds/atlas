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
  ATLAS_LOCAL_EXTENSION_FIELDS,
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
import { ALL_ELEMENT_TYPES, CONTENT_ELEMENT_TYPES, SPATIAL_ELEMENT_TYPES } from '../core/types';
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
import type { FolderStore } from './folder-store';
import type { ChartConfig } from '../visualization/timeline/types';
import { newId, nowIso } from './folder-store';
import { PerIdWriteChain } from './write-chain';
import {
  elementDirSegments,
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

  /**
   * Per-element filename index. Maps `id → { type, filename }` so reads and
   * writes can locate the on-disk file without scanning directories. Critical
   * because filenames are no longer derivable from id alone — they encode the
   * element's name as a slug prefix (`<slug>--<uuid>.json`).
   *
   * Built lazily per type on first read/write that needs it. Updated in-place
   * on create/update/delete. Cleared in close().
   */
  private fileIndex: Map<string, { type: ElementType; filename: string }> = new Map();
  /** Set of types whose dirs have been scanned into fileIndex. */
  private indexedTypes: Set<ElementType> = new Set();
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
      if (atlasDir) await removeFile(atlasDir, LOCK_FILE);
    }
    this.root = null;
    this.fileIndex.clear();
    this.indexedTypes.clear();
  }

  // ---- Layout setup + lock ----

  private async ensureLayout(): Promise<void> {
    const root = this.requireRoot();
    await getDir(root, [ATLAS_INTERNAL_DIR]);
    await getDir(root, [ELEMENTS_DIR]);
    await getDir(root, [SPATIAL_DIR]);
    await getDir(root, [MEDIA_DIR]);
    for (const t of CONTENT_ELEMENT_TYPES) await getDir(root, [ELEMENTS_DIR, t]);
    for (const t of SPATIAL_ELEMENT_TYPES) await getDir(root, [SPATIAL_DIR, t]);
  }

  private async claimLock(): Promise<void> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    const existing = await readJson<LockPayload>(atlasDir, LOCK_FILE);
    if (existing) {
      const heartbeat = Date.parse(existing.last_heartbeat);
      const age = Date.now() - heartbeat;
      if (Number.isFinite(heartbeat) && age < LOCK_STALE_MS) {
        if (this.opts.takeStaleLock === false) {
          throw new ELockHeld(existing);
        }
        // takeStaleLock: stale-only enforcement happens in the else branch.
        // Live lock + takeStaleLock !== false → still throw (we don't steal live).
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
  private async ensureIndexFor(type: ElementType): Promise<void> {
    if (this.indexedTypes.has(type)) return;
    const dir = await tryGetDir(this.requireRoot(), elementDirSegments(type));
    if (!dir) { this.indexedTypes.add(type); return; }
    const files = await listFiles(dir);
    type Rec = { filename: string; body: Element };
    const grouped = new Map<string, Rec[]>();
    const unreadable = new Set<string>();
    for (const filename of files) {
      if (!filename.endsWith('.json')) continue;
      const body = await readJson<Element>(dir, filename);
      if (!body || typeof body.id !== 'string' || !body.id) {
        unreadable.add(filename);
        console.warn(`[fs-folder-store] index(${type}): skipping unreadable/id-less file ${filename}`);
        continue;
      }
      const list = grouped.get(body.id);
      if (list) list.push({ filename, body });
      else grouped.set(body.id, [{ filename, body }]);
    }
    // Dedupe crash-twins FIRST for every group (grouping is by body id, so a
    // same-named stranger can never be a "loser"), building the survivor set.
    const survivors = new Map<string, Rec>();
    for (const [id, recs] of grouped) {
      recs.sort((a, b) =>
        (a.body.local_updated_at ?? '') < (b.body.local_updated_at ?? '') ? 1
        : (a.body.local_updated_at ?? '') > (b.body.local_updated_at ?? '') ? -1 : 0);
      const [survivor, ...losers] = recs;
      for (const loser of losers) {
        await removeFile(dir, loser.filename).catch(() => {});
      }
      if (losers.length > 0) {
        console.warn(`[fs-folder-store] dedupe(${type}): kept ${survivor.filename}, removed ${losers.map(l => l.filename).join(', ')}`);
      }
      survivors.set(id, survivor);
    }

    // FULL occupancy view before any tidy write (gate finding, 2026-07-03,
    // 3-lens convergent): the tidy target must never be a name ANY other
    // survivor currently holds — checking only already-processed ids lets an
    // early id overwrite a later sibling's live file, then lose its own.
    // Keys are LOWERCASED: case-folding filesystems (NTFS/APFS) treat case
    // variants as the same physical entry, and OPFS-based tests can't see
    // that — so equivalence is by lowercase throughout.
    const occupied = new Map<string, string>(); // lc(filename) → id
    for (const [id, rec] of survivors) {
      if (!occupied.has(rec.filename.toLowerCase())) occupied.set(rec.filename.toLowerCase(), id);
    }
    const unreadableLc = new Set([...unreadable].map(n => n.toLowerCase()));
    const isFree = (candidate: string, forId: string): boolean => {
      const lc = candidate.toLowerCase();
      const owner = occupied.get(lc);
      return (owner === undefined || owner === forId) && !unreadableLc.has(lc);
    };

    // Converge toward the short canonical form, id-sorted so which of two
    // colliding ids keeps the short name is DETERMINISTIC (lower id wins) —
    // two machines produce the same layout from the same world data.
    let tidied = 0;
    for (const id of [...survivors.keys()].sort()) {
      const survivor = survivors.get(id)!;
      const filename = survivor.filename;
      const short = elementFilename(id, survivor.body.name);
      const fullForm = elementFilenameFullId(id, survivor.body.name);
      // Pick the target: short when free; a file already on the full-id
      // fallback keeps it while the short form is taken (and converges once
      // the collision clears — the one sanctioned sibling-dependent rename).
      const target = isFree(short, id) ? short
        : sameFsName(filename, fullForm) || isFree(fullForm, id) ? fullForm
        : filename; // both forms taken (pathological) — leave the file alone
      if (!sameFsName(filename, target)) {
        // Distinct entries by construction (target is free, and lc-equality
        // was excluded above), so write-new + remove-old cannot self-delete
        // on a case-folding filesystem.
        await writeJsonAtomic(dir, target, survivor.body);
        await removeFile(dir, filename).catch(() => {});
        occupied.delete(filename.toLowerCase());
        occupied.set(target.toLowerCase(), id);
        survivor.filename = target;
        tidied++;
      } else {
        occupied.set(filename.toLowerCase(), id);
      }
      this.fileIndex.set(id, { type, filename: survivor.filename });
    }
    if (tidied > 0) {
      console.info(`[fs-folder-store] tidy(${type}): ${tidied} file(s) renamed to canonical form`);
    }
    this.indexedTypes.add(type);
  }

  /**
   * Filename for a NEW write of (id, name): the short canonical unless a
   * DIFFERENT id of the same type already holds it (case-insensitively) —
   * then the full-id fallback. Runtime stickiness for EXISTING files is
   * handled by writeElementAndRename, not here.
   */
  private resolveFilename(type: ElementType, id: string, name: string | null | undefined): string {
    const candidate = elementFilename(id, name);
    for (const [otherId, entry] of this.fileIndex) {
      if (otherId !== id && entry.type === type && sameFsName(entry.filename, candidate)) {
        return elementFilenameFullId(id, name);
      }
    }
    return candidate;
  }

  /** Resolve the on-disk filename for an id. Returns null if not indexed. */
  private indexEntry(id: string): { type: ElementType; filename: string } | undefined {
    return this.fileIndex.get(id);
  }

  /** Record a new or updated filename binding. */
  private setIndex(id: string, type: ElementType, filename: string): void {
    this.fileIndex.set(id, { type, filename });
  }

  // ---- World meta ----

  async readWorldMeta(): Promise<WorldMeta> {
    const meta = await readJson<WorldMeta>(this.requireRoot(), WORLD_META_FILE);
    return meta ?? { ...DEFAULT_META };
  }

  async writeWorldMeta(patch: Partial<WorldMeta>): Promise<WorldMeta> {
    const current = await this.readWorldMeta();
    const next: WorldMeta = { ...current, ...patch };
    await writeJsonAtomic(this.requireRoot(), WORLD_META_FILE, next);
    return next;
  }

  // ---- Elements (unified content + spatial) ----

  async listElements(type?: ElementType): Promise<Element[]> {
    const types = type ? [type] : (ALL_ELEMENT_TYPES as readonly ElementType[]);
    const out: Element[] = [];
    for (const t of types) {
      await this.ensureIndexFor(t);
      const dir = await tryGetDir(this.requireRoot(), elementDirSegments(t));
      if (!dir) continue;
      for (const [, entry] of this.fileIndex) {
        if (entry.type !== t) continue;
        const elem = await readJson<Element>(dir, entry.filename);
        if (elem) out.push(elem);
      }
    }
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
    const dir = await tryGetDir(this.requireRoot(), elementDirSegments(entry.type));
    if (!dir) return null;
    const elem = await readJson<Element>(dir, entry.filename);
    if (!elem) {
      // File vanished out from under us — drop the stale index entry.
      this.fileIndex.delete(id);
    }
    return elem;
  }

  async createElement(type: ElementType, data: Partial<Element>): Promise<Element> {
    const id = (data.id as string) ?? newId();
    const elem: Element = {
      ...data,
      id,
      type,
      name: (data.name as string) ?? '',
      local_updated_at: this.clock(),
    };
    await this.ensureIndexFor(type);
    const dir = await getDir(this.requireRoot(), elementDirSegments(type));
    const filename = this.resolveFilename(type, id, elem.name);
    await writeJsonAtomic(dir, filename, elem);
    this.setIndex(id, type, filename);
    return elem;
  }

  async updateElement(id: string, patch: Partial<Element>): Promise<Element> {
    // Per-id serialization (convention #79): two concurrent updates to the
    // same element race the read-merge-write below — the second call's read
    // predates the first call's write, silently reverting its fields.
    return this.writeChain.run(id, () => this.updateElementUnchained(id, patch));
  }

  private async updateElementUnchained(id: string, patch: Partial<Element>): Promise<Element> {
    const existing = await this.getElement(id);
    if (!existing) throw new Error(`element ${id} not found`);
    const next: Element = {
      ...existing,
      ...patch,
      id: existing.id,
      type: existing.type,
      local_updated_at: this.clock(),
      server_updated_at: patch.server_updated_at ?? existing.server_updated_at,
    };
    await this.writeElementAndRename(existing.type, id, next, existing.name);
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
    const dir = await getDir(this.requireRoot(), elementDirSegments(type));
    const entry = this.indexEntry(id);
    const currentFilename = entry?.filename ?? elementFilename(id, previousName);
    if (validElementFilenames(id, next.name).some(f => sameFsName(f, currentFilename))) {
      await writeJsonAtomic(dir, currentFilename, next);
      this.setIndex(id, type, currentFilename);
      return;
    }
    // Name genuinely changed — write the new file first, then remove the old.
    // resolveFilename outputs are valid forms and lc-equality with the current
    // name was excluded above, so old and new are DISTINCT physical entries
    // even on case-folding filesystems. A crash between the two steps is
    // covered by ensureIndexFor's dedupe (latest local_updated_at wins).
    const newFilename = this.resolveFilename(type, id, next.name);
    await writeJsonAtomic(dir, newFilename, next);
    this.setIndex(id, type, newFilename);
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
        await this.appendTombstone(tomb);
        await this.unlinkElement(dep);
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
    const dir = await tryGetDir(this.requireRoot(), elementDirSegments(elem.type));
    if (!dir) return;
    const entry = this.indexEntry(elem.id);
    const filename = entry?.filename ?? elementFilename(elem.id, elem.name);
    await removeFile(dir, filename);
    this.fileIndex.delete(elem.id);
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
      const dir = await getDir(this.requireRoot(), elementDirSegments(existing.type));
      await writeJsonAtomic(dir, filename, next);
    });
  }

  async clearServerBaseline(id: string): Promise<void> {
    return this.writeChain.run(id, async () => {
      const existing = await this.getElement(id);
      if (!existing) return;
      const { server_updated_at: _drop, ...rest } = existing;
      const entry = this.indexEntry(id);
      const filename = entry?.filename ?? elementFilename(id, existing.name);
      const dir = await getDir(this.requireRoot(), elementDirSegments(existing.type));
      await writeJsonAtomic(dir, filename, rest as Element);
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
      const dir = await getDir(this.requireRoot(), elementDirSegments(elem.type));
      await writeJsonAtomic(dir, filename, rest as Element);
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
    //    auto-attach against dead credentials.
    const meta = await this.readWorldMeta();
    const { api: _dropApi, ...metaRest } = meta;
    await writeJsonAtomic(this.requireRoot(), WORLD_META_FILE, metaRest as WorldMeta);
    console.info('[atlas:folder] resetSyncBaseline complete', {
      elementsCleared: cleared,
      apiStripped: !!meta.api,
    });
  }

  async applyServerRecord(type: ElementType, record: Record<string, unknown>, server_updated_at: string): Promise<Element> {
    const id = record.id as string;
    if (!id) throw new Error('applyServerRecord: record missing id');

    // Preserve atlas-extension fields (image_media_id, ...) from the existing
    // local file if present. The server doesn't know about these fields, so
    // its response carries none — overlaying the response directly would
    // silently destroy the local binding (e.g. a Map's locally-uploaded image
    // pointer). Sync metadata (local_updated_at, server_updated_at) is set
    // authoritatively below, so we don't carry it over from existing.
    const existing = await this.getElement(id);
    const preserved: Record<string, unknown> = {};
    if (existing) {
      for (const field of ATLAS_LOCAL_EXTENSION_FIELDS) {
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
      const dir = await getDir(this.requireRoot(), elementDirSegments(type));
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
