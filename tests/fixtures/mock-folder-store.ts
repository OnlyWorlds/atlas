/**
 * MockFolderStore — in-memory implementation of FolderStore for tests.
 *
 * Honors the same contract as the real FolderStore (FS Access API). All writes
 * stamp `local_updated_at`. Deletes write tombstones. Sync state and per-element
 * `server_updated_at` mirror what the real one will do.
 */

import type { FolderStore } from '../../src/store/folder-store';
import { newId, nowIso } from '../../src/store/folder-store';
import { ATLAS_LOCAL_EXTENSION_FIELDS } from '../../src/core/constants';
import type {
  Element,
  ElementType,
  WorldMap,
  Pin,
  Zone,
  Marker,
  MediaItem,
  WorldMeta,
  SyncState,
  Tombstone,
} from '../../src/core/types';

const defaultMeta: WorldMeta = { id: 'mock-world', name: 'mock world' };
const defaultSyncState: SyncState = {
  last_pull_at: null,
  last_push_at: null,
  paused: false,
  conflicts: [],
};

export class MockFolderStore implements FolderStore {
  private opened = false;
  private meta: WorldMeta = { ...defaultMeta };
  private elements = new Map<string, Element>();
  private tombstones: Tombstone[] = [];
  private syncState: SyncState = { ...defaultSyncState };
  private mediaItems = new Map<string, MediaItem>();
  private mediaBlobs = new Map<string, Blob>();

  // Time injection for deterministic tests.
  private clock: () => string = nowIso;
  setClock(fn: () => string): void { this.clock = fn; }

  async open(_handle: FileSystemDirectoryHandle | null): Promise<void> {
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  // ---- World metadata ----

  async readWorldMeta(): Promise<WorldMeta> {
    return { ...this.meta };
  }

  async writeWorldMeta(patch: Partial<WorldMeta>): Promise<WorldMeta> {
    this.meta = { ...this.meta, ...patch };
    return { ...this.meta };
  }

  // ---- Elements (content + spatial unified) ----

  async listElements(type?: ElementType): Promise<Element[]> {
    const all = Array.from(this.elements.values());
    return type ? all.filter(e => e.type === type) : all;
  }

  async getElement(id: string): Promise<Element | null> {
    return this.elements.get(id) ?? null;
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
    this.elements.set(id, elem);
    return { ...elem };
  }

  async updateElement(id: string, patch: Partial<Element>): Promise<Element> {
    const existing = this.elements.get(id);
    if (!existing) throw new Error(`element ${id} not found`);
    const next: Element = {
      ...existing,
      ...patch,
      id: existing.id,
      type: existing.type,
      local_updated_at: this.clock(),
      // Preserve server_updated_at unless patch explicitly sets it.
      server_updated_at: patch.server_updated_at ?? existing.server_updated_at,
    };
    this.elements.set(id, next);
    return { ...next };
  }

  async findDependents(id: string): Promise<Element[]> {
    const target = this.elements.get(id);
    if (!target) return [];
    const all = Array.from(this.elements.values());
    if (target.type === 'map') {
      return all.filter(e =>
        (e.type === 'pin' || e.type === 'zone' || e.type === 'marker') &&
        (e as { map_id?: string }).map_id === id
      );
    }
    // Pin/zone/marker have no dependents (leaves of the graph).
    if (target.type === 'pin' || target.type === 'zone' || target.type === 'marker') {
      return [];
    }
    // Content element: pins point at it via element_id.
    return all.filter(e => e.type === 'pin' && (e as { element_id?: string }).element_id === id);
  }

  async deleteElement(id: string, opts: { cascade?: boolean; silent?: boolean } = {}): Promise<{ tombstones: Tombstone[] }> {
    const silent = opts.silent ?? false;
    const cascade = silent ? false : (opts.cascade ?? true);
    const existing = this.elements.get(id);
    if (!existing) return { tombstones: [] };

    const written: Tombstone[] = [];
    if (cascade) {
      const deps = await this.findDependents(id);
      for (const dep of deps) {
        const tomb: Tombstone = { id: dep.id, type: dep.type, deleted_at: this.clock() };
        this.tombstones.push(tomb);
        this.elements.delete(dep.id);
        written.push(tomb);
      }
    }
    if (!silent) {
      const primary: Tombstone = { id, type: existing.type, deleted_at: this.clock() };
      this.tombstones.push(primary);
      written.push(primary);
    }
    this.elements.delete(id);
    return { tombstones: written };
  }

  // ---- Spatial passthroughs — same store, typed accessors ----

  async listMaps(): Promise<WorldMap[]> { return this.listElements('map') as Promise<WorldMap[]>; }
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

  async listZones(mapId?: string): Promise<Zone[]> {
    const all = (await this.listElements('zone')) as Zone[];
    return mapId ? all.filter(z => z.map_id === mapId) : all;
  }
  async getZone(id: string): Promise<Zone | null> { return (await this.getElement(id)) as Zone | null; }
  async createZone(data: Partial<Zone>): Promise<Zone> { return (await this.createElement('zone', data)) as Zone; }
  async updateZone(id: string, patch: Partial<Zone>): Promise<Zone> { return (await this.updateElement(id, patch)) as Zone; }
  async deleteZone(id: string) { return this.deleteElement(id); }

  async listMarkers(mapId?: string): Promise<Marker[]> {
    const all = (await this.listElements('marker')) as Marker[];
    return mapId ? all.filter(m => m.map_id === mapId) : all;
  }
  async getMarker(id: string): Promise<Marker | null> { return (await this.getElement(id)) as Marker | null; }
  async createMarker(data: Partial<Marker>): Promise<Marker> { return (await this.createElement('marker', data)) as Marker; }
  async updateMarker(id: string, patch: Partial<Marker>): Promise<Marker> { return (await this.updateElement(id, patch)) as Marker; }
  async deleteMarker(id: string) { return this.deleteElement(id); }

  // ---- Media ----

  async addMedia(elementId: string, file: File, folder = 'default'): Promise<MediaItem> {
    const id = newId();
    const item: MediaItem = {
      id,
      element_id: elementId,
      folder,
      filename: file.name,
      mime: file.type,
      size_bytes: file.size,
      added_at: this.clock(),
    };
    this.mediaItems.set(id, item);
    this.mediaBlobs.set(id, file);
    return { ...item };
  }

  async listMedia(elementId: string): Promise<MediaItem[]> {
    return Array.from(this.mediaItems.values()).filter(m => m.element_id === elementId);
  }

  async getMediaBlob(mediaId: string): Promise<Blob | null> {
    return this.mediaBlobs.get(mediaId) ?? null;
  }

  async deleteMedia(mediaId: string): Promise<void> {
    this.mediaItems.delete(mediaId);
    this.mediaBlobs.delete(mediaId);
  }

  // ---- Sync-relevant reads ----

  async listLocallyChangedSince(baseline: string | null): Promise<Element[]> {
    return Array.from(this.elements.values()).filter(elem => {
      // Never synced → always pending.
      if (!elem.server_updated_at) return true;
      // No baseline → all of them.
      if (baseline === null) return elem.local_updated_at > elem.server_updated_at;
      return elem.local_updated_at > baseline;
    });
  }

  async listTombstonesSince(baseline: string | null): Promise<Tombstone[]> {
    if (baseline === null) return [...this.tombstones];
    return this.tombstones.filter(t => t.deleted_at > baseline);
  }

  async clearTombstone(id: string): Promise<void> {
    this.tombstones = this.tombstones.filter(t => t.id !== id);
  }

  async readSyncState(): Promise<SyncState> {
    return { ...this.syncState };
  }

  async writeSyncState(patch: Partial<SyncState>): Promise<SyncState> {
    this.syncState = { ...this.syncState, ...patch };
    return { ...this.syncState };
  }

  async stampServerUpdatedAt(id: string, _type: ElementType, server_updated_at: string): Promise<void> {
    const existing = this.elements.get(id);
    if (!existing) return;
    this.elements.set(id, { ...existing, server_updated_at });
  }

  async clearServerBaseline(id: string): Promise<void> {
    const existing = this.elements.get(id);
    if (!existing) return;
    const { server_updated_at: _drop, ...rest } = existing;
    this.elements.set(id, rest as Element);
  }

  async resetSyncBaseline(): Promise<void> {
    // Mirror FsFolderStore.resetSyncBaseline contract: strip server_updated_at
    // from every element, drop tombstones, reset sync-state, strip world.json
    // api block. See folder-store.ts interface comment for rationale.
    for (const [id, elem] of this.elements) {
      if (!elem.server_updated_at) continue;
      const { server_updated_at: _drop, ...rest } = elem;
      this.elements.set(id, rest as Element);
    }
    this.tombstones = [];
    this.syncState = {
      last_pull_at: null,
      last_push_at: null,
      paused: false,
      conflicts: [],
    };
    const { api: _dropApi, ...metaRest } = this.meta;
    this.meta = metaRest as WorldMeta;
  }

  async applyServerRecord(type: ElementType, record: Record<string, unknown>, server_updated_at: string): Promise<Element> {
    const id = record.id as string;
    if (!id) throw new Error('applyServerRecord: record missing id');
    const failure = this.applyFailures.get(id);
    if (failure) {
      this.applyFailures.delete(id); // one-shot
      throw new Error(failure);
    }
    // Mirror FsFolderStore: preserve atlas-extension fields from existing
    // before overlaying the server record. See FsFolderStore.applyServerRecord
    // for the rationale (image_media_id and friends never live on server).
    const existing = this.elements.get(id);
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
    this.elements.set(id, elem);
    return { ...elem };
  }

  // ---- Test introspection helpers ----

  /** Inject a one-shot failure for a future applyServerRecord call. */
  __inject_apply_failure(id: string, msg = 'injected failure'): void {
    this.applyFailures.set(id, msg);
  }
  private applyFailures = new Map<string, string>();

  __debug_elementCount(): number { return this.elements.size; }
  __debug_tombstoneCount(): number { return this.tombstones.length; }
  __debug_isOpen(): boolean { return this.opened; }
}
