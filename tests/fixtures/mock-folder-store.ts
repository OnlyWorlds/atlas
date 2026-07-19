/**
 * MockFolderStore — in-memory implementation of FolderStore for tests.
 *
 * Honors the same contract as the real FolderStore (FS Access API). All writes
 * stamp `local_updated_at`. Deletes write tombstones. Sync state and per-element
 * `server_updated_at` mirror what the real one will do.
 */

import type { FolderStore, ListElementsOptions } from '../../src/store/folder-store';
import { newId, nowIso } from '../../src/store/folder-store';
import { PerIdWriteChain } from '../../src/store/write-chain';
import { ATLAS_LOCAL_ONLY_FIELDS, ATLAS_WIRE_EXTENSION_FIELDS } from '../../src/core/constants';
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
import type { ChartConfig } from '../../src/visualization/timeline/types';

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
  private charts: ChartConfig[] = [];
  private mediaItems = new Map<string, MediaItem>();
  private mediaBlobs = new Map<string, Blob>();
  /** Per-id serialization for update/delete — mirrors FsFolderStore (convention #79). */
  private writeChain = new PerIdWriteChain();

  // Time injection for deterministic tests.
  private clock: () => string = nowIso;
  setClock(fn: () => string): void { this.clock = fn; }

  // View-only guard (S264) — mirrors FsFolderStore: UI mutators throw; the
  // engine's channels (applyServerRecord, silent deletes, fromSync meta) pass.
  private viewOnly = false;
  setViewOnly(viewOnly: boolean): void { this.viewOnly = viewOnly; }
  private assertWritable(): void {
    if (this.viewOnly) throw new Error('This world is view-only');
  }

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

  async writeWorldMeta(patch: Partial<WorldMeta>, opts?: { fromSync?: boolean }): Promise<WorldMeta> {
    if (!opts?.fromSync) this.assertWritable();
    this.meta = { ...this.meta, ...patch };
    return { ...this.meta };
  }

  // ---- Elements (content + spatial unified) ----

  async listElements(type?: ElementType, _opts?: ListElementsOptions): Promise<Element[]> {
    const all = Array.from(this.elements.values());
    // onProgress contract (matches FsFolderStore): ticks fire ONLY during a
    // cold disk walk. The in-memory store is always warm, so it fires none —
    // callers must never rely on a terminal tick (close-gate finding).
    return type ? all.filter(e => e.type === type) : all;
  }

  async getElement(id: string): Promise<Element | null> {
    return this.elements.get(id) ?? null;
  }

  async createElement(type: ElementType, data: Partial<Element>): Promise<Element> {
    this.assertWritable();
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
    this.assertWritable();
    return this.writeChain.run(id, async () => {
      const existing = this.elements.get(id);
      if (!existing) throw new Error(`element ${id} not found`);
      // Mirror the real store's read→write I/O gap (disk read, then disk
      // write) so an UNSERIALIZED read-merge-write race manifests in vitest —
      // fakes encode real-world failure modes (convention #20).
      await Promise.resolve();
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
    });
  }

  async findDependents(id: string): Promise<Element[]> {
    const target = this.elements.get(id);
    if (!target) return [];
    const all = Array.from(this.elements.values());
    if (target.type === 'map') {
      // Pins + markers carry map_id. Zones do NOT — zones are pure metadata
      // and survive the loss of a map (DESIGN_ZONES.md §6.1).
      return all.filter(e =>
        (e.type === 'pin' || e.type === 'marker') &&
        (e as { map_id?: string }).map_id === id
      );
    }
    if (target.type === 'zone') {
      // Markers carry the zone relationship.
      return all.filter(e =>
        e.type === 'marker' && (e as { zone_id?: string }).zone_id === id
      );
    }
    // Pin and marker are leaves (no cascade).
    if (target.type === 'pin' || target.type === 'marker') {
      return [];
    }
    if (target.type === 'narrative') {
      // Narratives cascade their parent_narrative chain — see same branch in
      // folder-store-fs.ts for the rationale (writing tree integrity).
      const descendantIds = new Set<string>();
      const queue: string[] = [id];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const n of all) {
          if (n.type !== 'narrative') continue;
          if ((n as { parent_narrative?: string }).parent_narrative === cur && n.id !== id && !descendantIds.has(n.id)) {
            descendantIds.add(n.id);
            queue.push(n.id);
          }
        }
      }
      const descendants = all.filter(n => descendantIds.has(n.id));
      const targetIds = new Set([id, ...descendantIds]);
      const pins = all.filter(e =>
        e.type === 'pin' && (e as { element_id?: string }).element_id != null &&
        targetIds.has((e as { element_id?: string }).element_id as string)
      );
      return [...descendants, ...pins];
    }
    // Content element: pins point at it via element_id.
    return all.filter(e => e.type === 'pin' && (e as { element_id?: string }).element_id === id);
  }

  async deleteElement(id: string, opts: { cascade?: boolean; silent?: boolean } = {}): Promise<{ tombstones: Tombstone[] }> {
    if (!opts.silent) this.assertWritable();
    // Same chain as updateElement — an in-flight update lands before the
    // element disappears (mirrors FsFolderStore, convention #79).
    return this.writeChain.run(id, async () => {
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
    });
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
    this.assertWritable();
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

  async updateSyncState(mutate: (current: SyncState) => Partial<SyncState>): Promise<SyncState> {
    // In-memory ops complete within one turn, so this is atomic by
    // construction — but the mutator still receives the CURRENT state, so
    // read-modify-write semantics match FsFolderStore's chained impl.
    this.syncState = { ...this.syncState, ...mutate({ ...this.syncState }) };
    return { ...this.syncState };
  }

  async readCharts(): Promise<ChartConfig[]> {
    return this.charts.map(c => ({ ...c }));
  }

  async writeCharts(charts: ChartConfig[]): Promise<void> {
    this.assertWritable();
    this.charts = charts.map(c => ({ ...c }));
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
    // Mirror FsFolderStore: split preserve policy (gate 10.3). LOCAL_ONLY
    // fields always preserved (server never knows them); WIRE extension
    // fields preserved only when the server record lacks the field (server
    // value wins when present — v2 round-trips them).
    const existing = this.elements.get(id);
    const preserved: Record<string, unknown> = {};
    if (existing) {
      for (const field of ATLAS_LOCAL_ONLY_FIELDS) {
        const value = (existing as Record<string, unknown>)[field];
        if (value !== undefined) preserved[field] = value;
      }
      for (const field of ATLAS_WIRE_EXTENSION_FIELDS) {
        if (field in record) continue;
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
