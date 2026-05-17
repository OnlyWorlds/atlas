/**
 * FsFolderStore — the real FolderStore, backed by the File System Access API.
 *
 * The folder on disk IS the world. Every element is a file. Sync state, tombstones,
 * and the writer lock live under `.atlas/`. Layout matches DESIGN.md:
 *
 *   <root>/
 *     world.json
 *     .atlas/{sync-state.json, tombstones.json, lock}
 *     elements/<content-type>/<id>.json
 *     spatial/<spatial-type>/<id>.json
 *     media/<element-id>/<folder>/<filename>
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
import { newId, nowIso } from './folder-store';
import {
  elementDirSegments,
  elementFilename,
  getDir,
  idFromFilename,
  isNotFound,
  listFiles,
  parseIdFromFilename,
  readJson,
  removeFile,
  tryGetDir,
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
   * Handles the rename-crash dedupe: if the directory contains multiple files
   * for the same id (atlas crashed between writing the new filename and
   * deleting the old), the survivor is the one whose body has the latest
   * `local_updated_at`. Losers are removed from disk.
   */
  private async ensureIndexFor(type: ElementType): Promise<void> {
    if (this.indexedTypes.has(type)) return;
    const dir = await tryGetDir(this.requireRoot(), elementDirSegments(type));
    if (!dir) { this.indexedTypes.add(type); return; }
    const files = await listFiles(dir);
    // Group filenames by id; if multiple, dedupe by latest local_updated_at.
    const grouped = new Map<string, string[]>();
    for (const name of files) {
      const id = parseIdFromFilename(name);
      if (!id) continue;
      const list = grouped.get(id);
      if (list) list.push(name);
      else grouped.set(id, [name]);
    }
    for (const [id, names] of grouped) {
      if (names.length === 1) {
        this.fileIndex.set(id, { type, filename: names[0] });
      } else {
        const survivor = await this.dedupeFilesForId(dir, names);
        if (survivor) this.fileIndex.set(id, { type, filename: survivor });
      }
    }
    this.indexedTypes.add(type);
  }

  /**
   * Two-or-more files claim the same id. Read each body, keep the one with the
   * latest `local_updated_at`, unlink the others. Returns the survivor name or
   * null if every read failed.
   */
  private async dedupeFilesForId(
    dir: FileSystemDirectoryHandle,
    names: string[],
  ): Promise<string | null> {
    type Candidate = { name: string; ts: string };
    const candidates: Candidate[] = [];
    for (const name of names) {
      const body = await readJson<Element>(dir, name);
      if (!body) continue;
      candidates.push({ name, ts: body.local_updated_at ?? '' });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
    const [survivor, ...losers] = candidates;
    for (const loser of losers) {
      await removeFile(dir, loser.name).catch(() => {});
    }
    if (losers.length > 0) {
      console.warn(`[fs-folder-store] dedupe: kept ${survivor.name}, removed ${losers.map(l => l.name).join(', ')}`);
    }
    return survivor.name;
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
    const filename = elementFilename(id, elem.name);
    await writeJsonAtomic(dir, filename, elem);
    this.setIndex(id, type, filename);
    return elem;
  }

  async updateElement(id: string, patch: Partial<Element>): Promise<Element> {
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
   * Write an element body, renaming the file if the name (and therefore the
   * slug) changed since the last write. Crash window between write-new and
   * delete-old is covered by ensureIndexFor's dedupe pass on next open.
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
    const newFilename = elementFilename(id, next.name);
    if (currentFilename === newFilename) {
      await writeJsonAtomic(dir, newFilename, next);
      this.setIndex(id, type, newFilename);
      return;
    }
    // Name changed — write the new file first, then remove the old. If we
    // crash between these two steps, ensureIndexFor's dedupe (latest
    // local_updated_at wins) cleans it up on next open.
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
    // Content element: pins that reference it
    const pins = (await this.listElements('pin')) as Array<Element & { element_id?: string }>;
    return pins.filter(p => p.element_id === id);
  }

  async deleteElement(id: string, opts: { cascade?: boolean; silent?: boolean } = {}): Promise<{ tombstones: Tombstone[] }> {
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
    const all = await this.readTombstoneList();
    const next = all.filter(t => t.id !== id);
    await this.writeTombstoneList(next);
  }

  async readSyncState(): Promise<SyncState> {
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    const state = await readJson<SyncState>(atlasDir, SYNC_STATE_FILE);
    return state ?? { ...DEFAULT_SYNC_STATE };
  }

  async writeSyncState(patch: Partial<SyncState>): Promise<SyncState> {
    const current = await this.readSyncState();
    const next: SyncState = { ...current, ...patch };
    const atlasDir = await getDir(this.requireRoot(), [ATLAS_INTERNAL_DIR]);
    await writeJsonAtomic(atlasDir, SYNC_STATE_FILE, next);
    return next;
  }

  async stampServerUpdatedAt(id: string, _type: ElementType, server_updated_at: string): Promise<void> {
    const existing = await this.getElement(id);
    if (!existing) return;
    const next: Element = { ...existing, server_updated_at };
    const entry = this.indexEntry(id);
    const filename = entry?.filename ?? elementFilename(id, existing.name);
    const dir = await getDir(this.requireRoot(), elementDirSegments(existing.type));
    await writeJsonAtomic(dir, filename, next);
  }

  async clearServerBaseline(id: string): Promise<void> {
    const existing = await this.getElement(id);
    if (!existing) return;
    const { server_updated_at: _drop, ...rest } = existing;
    const entry = this.indexEntry(id);
    const filename = entry?.filename ?? elementFilename(id, existing.name);
    const dir = await getDir(this.requireRoot(), elementDirSegments(existing.type));
    await writeJsonAtomic(dir, filename, rest as Element);
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
        console.info('[fs-folder-store] applyServerRecord: post-write readback ok', {
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

  private async appendTombstone(t: Tombstone): Promise<void> {
    const existing = await this.readTombstoneList();
    existing.push(t);
    await this.writeTombstoneList(existing);
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
