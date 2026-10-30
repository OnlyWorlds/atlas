/**
 * MockFolderStore — in-memory implementation of FolderStore for tests.
 *
 * Honors the same contract as the real FolderStore (FS Access API). All writes
 * stamp `local_updated_at`. Deletes write tombstones. Sync state and per-element
 * `server_updated_at` mirror what the real one will do.
 */

import { PlainError } from '../../src/core/plain-error';
import type { FolderStore, ListElementsOptions, RekeyJournal, RescanResult, ApplyServerRecordOpts } from '../../src/store/folder-store';
import { journalIds, RekeyPendingError } from '../../src/store/folder-store';
import { newElementId, newId, nowIso } from '../../src/store/folder-store';
import { PerIdWriteChain } from '../../src/store/write-chain';
import { isKnownOf, KNOWN_OF_DROPS_LOCAL, KNOWN_OF_REFUSAL, stubShape } from '../../src/sync/known-of';
import { ATLAS_LOCAL_ONLY_FIELDS, ATLAS_WIRE_EXTENSION_FIELDS, FOLDER_FORMAT_VERSION } from '../../src/core/constants';
import { findDuplicatePin, DuplicatePinError } from '../../src/core/pin-uniqueness';
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
import { EMPTY_STYLES, type WorldStyles } from '../../src/core/world-styles';
import { stampedBody, editStamp, dropLastWriter } from '../../src/store/sync-stamp';
import { scrubReferrers } from '../../src/store/scrub-links';
import { CorruptFileError } from '../../src/store/fs-utils';
import { withoutSeatSecret } from '../../src/core/seat';
import { HIDDEN_SHOWN_ONLINE } from '../../src/core/hidden-mark';

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
  private styles: WorldStyles = { ...EMPTY_STYLES, rules: [] };
  /**
   * Media keyed by (element dir, media id), like the real folder
   * (`media/<elementId>/...`): a re-key copies an element's media, so the same
   * media id lives under two directories at once and must not overwrite
   * (re-key gate, lens 1 F5). Lookups by media id scan NEWEST directory first,
   * the adversarial order for anything that picks "the first match".
   */
  private mediaItems = new Map<string, MediaItem>();
  private mediaBlobs = new Map<string, Blob>();
  private static mediaKey(elementId: string, mediaId: string): string { return `${elementId}\u0000${mediaId}`; }
  private mediaKeysById(mediaId: string): string[] {
    return Array.from(this.mediaItems.keys()).reverse().filter(k => k.endsWith(`\u0000${mediaId}`));
  }
  /** Test hook: ids whose file "will not parse" on a chained read-modify-write. */
  corruptIds = new Set<string>();
  private rekeyJournal: RekeyJournal | null = null;
  /** Test hook: the journal file exists but will not parse. */
  rekeyJournalCorrupt = false;
  /** Per-id serialization for update/delete — mirrors FsFolderStore (convention #79). */
  private writeChain = new PerIdWriteChain();

  // Time injection for deterministic tests.
  private clock: () => string = nowIso;
  setClock(fn: () => string): void { this.clock = fn; }

  // View-only guard — mirrors FsFolderStore: UI mutators throw; the
  // engine's channels (applyServerRecord, silent deletes, fromSync meta) pass.
  private viewOnly: boolean | 'copy' = false;
  setViewOnly(viewOnly: boolean | 'copy'): void { this.viewOnly = viewOnly; }
  private assertWritable(): void {
    if (this.viewOnly) throw new PlainError('This world is view-only, so it cannot be changed here. Make your own copy to edit it.');
  }

  /**
   * What a mocked first download landed on a handle (`mock-first-download.ts`):
   * the next store opened on that handle takes its whole state, as a real
   * store opened on landed files reads them.
   */
  static landed = new WeakMap<object, MockFolderStore>();

  async open(handle: FileSystemDirectoryHandle | null): Promise<void> {
    const from = handle ? MockFolderStore.landed.get(handle) : undefined;
    if (from) {
      MockFolderStore.landed.delete(handle!);
      Object.assign(this, from);
    }
    this.opened = true;
  }

  async close(): Promise<void> {
    this.opened = false;
  }

  // ---- World metadata ----

  /** Test hook: world.json exists but will not parse (a git conflict). Mirrors
   *  FsFolderStore: the tolerant read returns the empty default, a strict read
   *  and every write throw `CorruptFileError`. */
  worldMetaCorrupt = false;

  async readWorldMeta(opts?: { strict?: boolean }): Promise<WorldMeta> {
    if (this.worldMetaCorrupt) {
      if (opts?.strict) throw new CorruptFileError('world.json', new SyntaxError('Unexpected token <'));
      return { id: '', name: '' };
    }
    return { ...this.meta };
  }

  private metaBorn = false;

  async writeWorldMeta(patch: Partial<WorldMeta>, opts?: { fromSync?: boolean }): Promise<WorldMeta> {
    if (!opts?.fromSync) this.assertWritable();
    if (this.worldMetaCorrupt) throw new CorruptFileError('world.json', new SyntaxError('Unexpected token <'));
    // Mirrors FsFolderStore's birth stamp (folder-format §4.2): the
    // first write to a store that has no meta yet records the spec version.
    const stamp = !this.metaBorn && patch.format_version === undefined
      ? { format_version: FOLDER_FORMAT_VERSION }
      : {};
    // And its producer line: taken at birth only.
    const { producer: offered, ...rest } = patch;
    const producer = !this.metaBorn && offered !== undefined ? { producer: offered } : {};
    this.metaBorn = true;
    this.meta = withoutSeatSecret({ ...this.meta, ...stamp, ...rest, ...producer });
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
    const id = (data.id as string) ?? newElementId();
    // Mirrors FsFolderStore's pin-uniqueness guard. Convention 20: a
    // fake that accepts what production rejects produces confident-wrong
    // tests. Both stores read the SAME predicate so they cannot drift.
    if (type === 'pin') {
      const dupe = findDuplicatePin(data as Partial<Pin>, this.elements.values(), id);
      if (dupe) {
        throw new DuplicatePinError(dupe.id);
      }
    }
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

  async updateElementWith(
    id: string,
    mutate: (existing: Element) => Partial<Element> | null,
  ): Promise<Element | null> {
    this.assertWritable();
    return this.writeChain.run(id, async () => {
      const existing = this.elements.get(id);
      if (!existing) return null;
      if (isKnownOf(existing)) return structuredClone(existing);
      if (this.corruptIds.has(id)) throw new CorruptFileError(`${id}.json`, new SyntaxError('Unexpected token <'));
      await Promise.resolve(); // mirror the real store's in-chain read gap
      // Deep-clone like the real store's getElement (structuredClone) — the
      // mutate callback must not be able to reach the mock's stored nested
      // refs (fakes encode the real store's isolation, convention #20).
      const patch = mutate(structuredClone(existing));
      if (patch === null || Object.keys(patch).length === 0) return structuredClone(existing);
      const next: Element = dropLastWriter({
        ...existing,
        ...patch,
        id: existing.id,
        type: existing.type,
        local_updated_at: editStamp(this.clock(), patch.server_updated_at ?? existing.server_updated_at),
        server_updated_at: patch.server_updated_at ?? existing.server_updated_at,
      });
      this.elements.set(id, next);
      return { ...next };
    });
  }

  async updateElement(id: string, patch: Partial<Element>): Promise<Element> {
    this.assertWritable();
    return this.writeChain.run(id, async () => {
      const existing = this.elements.get(id);
      if (!existing) throw new Error(`element ${id} not found`);
      if (isKnownOf(existing)) throw new PlainError(KNOWN_OF_REFUSAL);
      // Mirror the real store's read→write I/O gap (disk read, then disk
      // write) so an UNSERIALIZED read-merge-write race manifests in vitest —
      // fakes encode real-world failure modes (convention #20).
      await Promise.resolve();
      const next: Element = dropLastWriter({
        ...existing,
        ...patch,
        id: existing.id,
        type: existing.type,
        local_updated_at: editStamp(this.clock(), patch.server_updated_at ?? existing.server_updated_at),
        // Preserve server_updated_at unless patch explicitly sets it.
        server_updated_at: patch.server_updated_at ?? existing.server_updated_at,
      });
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
    // Mirrors FsFolderStore.
    if (!opts.silent && journalIds(this.rekeyJournal).has(id)) throw new RekeyPendingError();
    if (!opts.silent && isKnownOf(this.elements.get(id))) throw new PlainError(KNOWN_OF_REFUSAL);
    const result = await this.deleteElementInChain(id, opts);
    // Mirrors FsFolderStore: a UI delete removes the dead ids from every
    // referrer's links, as keel does (`store/scrub-links.ts`).
    if (!opts.silent) await scrubReferrers(this, new Set(result.tombstones.map(t => t.id)));
    return result;
  }

  /** Test hook: ids whose guarded delete throws, as a file that will not parse does in FsFolderStore. */
  deleteFailures = new Set<string>();

  async deleteSilentlyIfUnchanged(
    id: string, expected: { local_updated_at: string | null; server_updated_at: string | null },
  ): Promise<boolean> {
    // Mirrors FsFolderStore: the check and the delete share one chain slot.
    return this.writeChain.run(id, async () => {
      if (this.deleteFailures.has(id)) throw new Error(`delete failed: ${id}`);
      const current = await this.getElement(id);
      if ((current?.local_updated_at ?? null) !== expected.local_updated_at) return false;
      if (current && (current.server_updated_at ?? null) !== expected.server_updated_at) return false;
      // A silent delete: no cascade, no tombstone (as deleteElementInChain).
      if (current) this.elements.delete(id);
      return true;
    });
  }

  private deleteElementInChain(id: string, opts: { cascade?: boolean; silent?: boolean }): Promise<{ tombstones: Tombstone[] }> {
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
          // Mirror the real store's tombstone WRITE before the unlink
          // (`await this.appendTombstone(tomb)` — a full read-modify-write of
          // tombstones.json). Without this yield the fake could not exhibit
          // the cascade-vs-update race that the real store has, and a test
          // written against it passed on unfixed code: a false green.
          // Fakes encode real I/O gaps (convention #20).
          await Promise.resolve();
          // Each dependent goes through ITS OWN write chain, mirroring
          // FsFolderStore — deleting inside the TARGET's slot leaves a
          // concurrent update to the dependent unserialized, and its write can
          // land after the delete and resurrect the element.
          if (dep.id === id) {
            this.elements.delete(dep.id);
          } else {
            await this.writeChain.run(dep.id, async () => {
              this.elements.delete(dep.id);
            });
          }
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
    const key = MockFolderStore.mediaKey(elementId, id);
    this.mediaItems.set(key, item);
    this.mediaBlobs.set(key, file);
    return { ...item };
  }

  async listMedia(elementId: string): Promise<MediaItem[]> {
    const prefix = `${elementId}\u0000`;
    return Array.from(this.mediaItems.entries())
      .filter(([k]) => k.startsWith(prefix))
      .map(([, m]) => ({ ...m }));
  }

  async getMediaBlob(mediaId: string): Promise<Blob | null> {
    // Mirrors FsFolderStore: the first sidecar found wins, and a sidecar
    // whose blob is missing answers null rather than scanning on.
    const key = this.mediaKeysById(mediaId)[0];
    return key ? this.mediaBlobs.get(key) ?? null : null;
  }

  async deleteMedia(mediaId: string): Promise<void> {
    this.assertWritable();
    // Mirrors FsFolderStore: removes the FIRST match only.
    const key = this.mediaKeysById(mediaId)[0];
    if (!key) return;
    this.mediaItems.delete(key);
    this.mediaBlobs.delete(key);
  }

  async copyMediaDir(fromElementId: string, toElementId: string): Promise<number> {
    this.assertWritable();
    const prefix = `${fromElementId}\u0000`;
    let copied = 0;
    for (const [k, item] of Array.from(this.mediaItems.entries())) {
      if (!k.startsWith(prefix)) continue;
      const key = MockFolderStore.mediaKey(toElementId, item.id);
      const blob = this.mediaBlobs.get(k);
      if (blob) { this.mediaBlobs.set(key, blob); copied++; } // blob first
      this.mediaItems.set(key, { ...item, element_id: toElementId });
      copied++;
    }
    return copied;
  }

  async removeMediaDir(elementId: string): Promise<void> {
    this.assertWritable();
    const prefix = `${elementId}\u0000`;
    for (const k of Array.from(this.mediaItems.keys())) {
      if (k.startsWith(prefix)) { this.mediaItems.delete(k); this.mediaBlobs.delete(k); }
    }
    for (const k of Array.from(this.mediaBlobs.keys())) {
      if (k.startsWith(prefix)) this.mediaBlobs.delete(k);
    }
  }

  async createElementVerbatim(
    type: ElementType,
    body: Element,
    _opts?: { bindingFrom?: string },
  ): Promise<{ created: boolean; element: Element }> {
    this.assertWritable();
    return this.writeChain.run(body.id, async () => {
      const existing = this.elements.get(body.id);
      if (existing) return { created: false, element: structuredClone(existing) };
      await Promise.resolve();
      const now = this.clock();
      const { server_updated_at: _drop, ...rest } = structuredClone(body);
      const elem: Element = { ...rest, created_at: body.created_at ?? now, id: body.id, type, name: body.name ?? '', local_updated_at: now };
      this.elements.set(body.id, elem);
      return { created: true, element: structuredClone(elem) };
    });
  }

  async readRekeyJournal(): Promise<RekeyJournal | null> {
    if (this.rekeyJournalCorrupt) throw new CorruptFileError('rekey-journal.json', new SyntaxError('Unexpected token <'));
    return this.rekeyJournal ? structuredClone(this.rekeyJournal) : null;
  }

  async writeRekeyJournal(journal: RekeyJournal): Promise<void> {
    this.assertWritable();
    this.rekeyJournal = structuredClone(journal);
    this.rekeyJournalCorrupt = false;
  }

  async clearRekeyJournal(): Promise<void> {
    this.rekeyJournal = null;
    this.rekeyJournalCorrupt = false;
    this.rekeyJournalEmpty = false;
  }

  async hasRekeyJournal(): Promise<boolean> {
    return this.rekeyJournal !== null || this.rekeyJournalCorrupt || this.rekeyJournalEmpty;
  }

  /** Test hook: the journal file exists and is empty (a tab closed inside its first write). */
  rekeyJournalEmpty = false;

  /** Test hook: ids "found in both element layouts" (the mock has no directories). */
  shadowIds = new Set<string>();
  hasShadowCopy(id: string): boolean {
    return this.shadowIds.has(id);
  }

  /** One map, no cache separate from "disk": nothing can change behind it. The real store's kernel runs on fake-fs. */
  async rescanDisk(_opts?: { full?: boolean }): Promise<RescanResult> {
    return { changes: [] };
  }

  /** The mock has no files to fail; a test sets what an index would have left out. */
  unreadable: string[] = [];
  unreadableFiles(): string[] {
    return [...this.unreadable];
  }

  // ---- Sync-relevant reads ----

  async listLocallyChangedSince(baseline: string | null): Promise<Element[]> {
    return Array.from(this.elements.values()).filter(elem => {
      if (isKnownOf(elem)) return false;
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

  /** Test hook: sync-state.json exists but will not parse. Mirrors
   *  FsFolderStore: the tolerant read returns defaults, writes throw. */
  syncStateCorrupt = false;

  async writeSyncState(patch: Partial<SyncState>): Promise<SyncState> {
    if (this.syncStateCorrupt) throw new CorruptFileError('sync-state.json', new SyntaxError('Unexpected token <'));
    this.syncState = { ...this.syncState, ...patch };
    return { ...this.syncState };
  }

  async updateSyncState(mutate: (current: SyncState) => Partial<SyncState>): Promise<SyncState> {
    // In-memory ops complete within one turn, so this is atomic by
    // construction — but the mutator still receives the CURRENT state, so
    // read-modify-write semantics match FsFolderStore's chained impl.
    if (this.syncStateCorrupt) throw new CorruptFileError('sync-state.json', new SyntaxError('Unexpected token <'));
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

  async readStyles(): Promise<WorldStyles> {
    return { version: this.styles.version, rules: this.styles.rules.map(r => ({ ...r })) };
  }

  async writeStyles(styles: WorldStyles): Promise<void> {
    this.assertWritable();
    this.styles = { version: styles.version, rules: styles.rules.map(r => ({ ...r })) };
  }

  /** `.atlas/world-prefs.json`; `worldPrefsCorrupt` makes a read throw like the real store. */
  worldPrefs: Record<string, unknown> | null = null;
  worldPrefsCorrupt = false;
  async readWorldPrefs(): Promise<Record<string, unknown> | null> {
    if (this.worldPrefsCorrupt) throw new CorruptFileError('world-prefs.json', new SyntaxError('Unexpected token <'));
    return this.worldPrefs ? structuredClone(this.worldPrefs) : null;
  }
  async writeWorldPrefs(prefs: Record<string, unknown>): Promise<void> {
    this.assertWritable();
    if (this.worldPrefsCorrupt) throw new CorruptFileError('world-prefs.json', new SyntaxError('Unexpected token <'));
    this.worldPrefs = structuredClone(prefs);
  }

  async stampServerUpdatedAt(id: string, _type: ElementType, server_updated_at: string, sentLocalUpdatedAt?: string | null, kept?: Readonly<Record<string, unknown>>): Promise<void> {
    const existing = this.elements.get(id);
    if (!existing) return;
    this.elements.set(id, stampedBody(existing, server_updated_at, sentLocalUpdatedAt, kept));
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

  // Parity with FsFolderStore: pull-apply rides the per-id chain, and
  // the guarded variant checks the local stamp inside the same slot.
  async applyServerRecord(
    type: ElementType, record: Record<string, unknown>, server_updated_at: string,
    opts: ApplyServerRecordOpts = {},
  ): Promise<Element> {
    const id = record.id as string;
    if (!id) throw new Error('applyServerRecord: record missing id');
    return this.writeChain.run(id, () => this.applyServerRecordUnchained(type, record, server_updated_at, opts));
  }

  async applyServerRecordIfUnchanged(
    type: ElementType, record: Record<string, unknown>, server_updated_at: string,
    expectedLocalUpdatedAt: string | null,
  ): Promise<boolean> {
    const id = record.id as string;
    if (!id) throw new Error('applyServerRecord: record missing id');
    return this.writeChain.run(id, async () => {
      const current = await this.getElement(id);
      if ((current?.local_updated_at ?? null) !== expectedLocalUpdatedAt) return false;
      await this.applyServerRecordUnchained(type, record, server_updated_at);
      return true;
    });
  }

  private async applyServerRecordUnchained(
    type: ElementType, served: Record<string, unknown>, server_updated_at: string,
    opts: ApplyServerRecordOpts = {},
  ): Promise<Element> {
    // Mirrors FsFolderStore: keel's stub is written as a stub (conv. 155, I1, I2).
    const stub = isKnownOf(served);
    const record = stub ? stubShape(served) : served;
    const id = record.id as string;
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
        if (opts.dropLocal?.includes(field)) continue;
        if (field === HIDDEN_SHOWN_ONLINE) continue; // the record is keel's word on the mark (conv. 170, F3)
        if (stub && KNOWN_OF_DROPS_LOCAL.includes(field)) continue; // a mirror of a field the stub leaves unset (gate G6)
        const value = (existing as Record<string, unknown>)[field];
        if (value !== undefined) preserved[field] = value;
      }
      for (const field of stub ? [] : ATLAS_WIRE_EXTENSION_FIELDS) {
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
