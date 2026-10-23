/**
 * FolderStore — the single source of truth for a world's data.
 *
 * The folder on disk IS the world. Every write goes here first (stamping
 * `local_updated_at`). Reads come from here. SyncEngine (if attached) reconciles
 * against the OW API but doesn't replace this layer.
 *
 * Two implementations:
 * - Real one (browser) — File System Access API.
 * - Mock one (tests) — in-memory map.
 *
 * Both honor the same contract.
 */

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
} from '../core/types';
import type { ChartConfig } from '../visualization/timeline/types';
import type { WorldStyles } from '../core/world-styles';
import { PlainError } from '../core/plain-error';

/**
 * Options for listElements. `onProgress(done, total)` fires per file during a
 * COLD index build (the expensive disk walk) so callers can render a real
 * loading count; warm calls (cache-served) never fire it. Total is the raw
 * .json file count, so it can slightly overshoot the returned element count
 * (unreadable files, crash-twin dedupe) — treat it as a ceiling, not a promise.
 */
export interface ListElementsOptions {
  onProgress?: (done: number, total: number) => void;
}

export interface FolderStore {
  // ---- Lifecycle ----

  /** Attach to an underlying folder (browser: DirectoryHandle; mock: noop). */
  open(handle: FileSystemDirectoryHandle | null): Promise<void>;

  /** Detach. Implementations may flush in-flight writes. */
  close(): Promise<void>;

  /**
   * View-only mode (S264 — worlds linked with a READ key). When set, every
   * UI-originated mutation throws a `PlainError` ("This world is view-only, so
   * it cannot be changed here. ..."); the sync engine's
   * legitimate write channels stay open (applyServerRecord + friends,
   * `deleteElement` with `silent` — the server-delete channel — and
   * `writeWorldMeta` with `fromSync`). One seam, both stores, so no UI call
   * site needs to know.
   */
  setViewOnly(viewOnly: boolean): void;

  // ---- World metadata ----

  /**
   * Tolerant by default: a world.json that will not parse reads as the empty
   * default, so a damaged world still OPENS. `strict` throws `CorruptFileError`
   * instead; every read whose result is diffed or sent to the server uses it
   * (S361: the sync meta step read the empty default as "every field cleared"
   * and PATCHed blanks over the server's world meta).
   */
  readWorldMeta(opts?: { strict?: boolean }): Promise<WorldMeta>;
  /** `fromSync` bypasses the view-only guard — the engine's pull-apply channel. */
  writeWorldMeta(patch: Partial<WorldMeta>, opts?: { fromSync?: boolean }): Promise<WorldMeta>;

  // ---- Content elements ----

  listElements(type?: ElementType, opts?: ListElementsOptions): Promise<Element[]>;
  getElement(id: string): Promise<Element | null>;
  /**
   * Create an element. FolderStore generates an id if not provided AND stamps
   * `local_updated_at` regardless of what the caller passed. Callers must NOT
   * pre-set timestamps; that's the store's job.
   */
  createElement(type: ElementType, data: Partial<Element>): Promise<Element>;
  /**
   * Update an element. Stamps `local_updated_at = now()` on the merged result.
   * Preserves any existing `server_updated_at` unless explicitly cleared.
   */
  updateElement(id: string, patch: Partial<Element>): Promise<Element>;
  /**
   * Read-merge-write INSIDE the per-id write chain: `mutate` receives the
   * on-disk element as read within the lock and returns the patch to apply,
   * or null for "no write" (no stamp, no file touch). Returns null when the
   * element does not exist. Use whenever a patch is COMPUTED FROM current
   * state — a patch built from a pre-chain snapshot can silently revert a
   * concurrent writer's fields (the tour heal gate's TOCTOU finding, S299).
   */
  updateElementWith(
    id: string,
    mutate: (existing: Element) => Partial<Element> | null,
  ): Promise<Element | null>;
  /**
   * Delete an element. Writes a tombstone, then removes the file.
   *
   * Cascade rules (default `opts.cascade = true`):
   * - Content element delete → also tombstones every pin whose `element_id` references it.
   * - Narrative delete → also every descendant narrative (`parent_narrative`
   *   chain) and every pin on it or a descendant (conv. 43).
   * - Map delete → also every pin and marker on that map; zones stay, as
   *   orphan metadata (DESIGN_ZONES §1).
   * - Zone delete → also every marker whose `zone_id` names it.
   * - Pin / marker delete → no cascade (leaves of the graph).
   * A non-silent delete then removes the dead ids from every link that named
   * them (conv. 101), each referrer through its own chain, after the delete.
   *
   * Cascade tombstones are pushed BEFORE the primary tombstone so server DELETEs
   * execute in dependency-safe order. Returns every tombstone written (primary
   * is always the last entry).
   *
   * Pass `cascade: false` only for advanced flows (engine cleanups, repairs);
   * UI flows must use the default to avoid orphaning dependents.
   *
   * Pass `silent: true` to remove the file WITHOUT writing tombstones. Used by
   * the re-key kernel (removing the old id after the copy at the new one,
   * and on rollback) and by the engine's resolution of a server-side delete:
   * no DELETE should propagate for either. Silent also implies
   * `cascade: false` (silent delete is a surgical operation, not a sweep).
   */
  deleteElement(id: string, opts?: { cascade?: boolean; silent?: boolean }): Promise<{ tombstones: Tombstone[] }>;
  /** A silent delete guarded INSIDE the per-id chain: removes the file only
   *  if both its stamps still equal `expected` (`local_updated_at` null =
   *  absent, a no-op that counts as done). Returns false when an edit, a Keep
   *  (which clears `server_updated_at`) or a push landed after the caller
   *  decided (#122, the server-delete review's bulk step; conv. 140). */
  deleteSilentlyIfUnchanged(
    id: string, expected: { local_updated_at: string | null; server_updated_at: string | null },
  ): Promise<boolean>;
  /**
   * Preview what would be deleted alongside `id` if `deleteElement(id)` ran with
   * cascade enabled. Returns the dependents (NOT the primary). UI uses this for
   * "delete X? this will also remove N pins" confirmation dialogs.
   */
  findDependents(id: string): Promise<Element[]>;

  // ---- Spatial elements ----

  listMaps(): Promise<WorldMap[]>;
  getMap(id: string): Promise<WorldMap | null>;
  createMap(data: Partial<WorldMap>): Promise<WorldMap>;
  updateMap(id: string, patch: Partial<WorldMap>): Promise<WorldMap>;
  /** Same cascade contract as `deleteElement` — map delete sweeps its spatial children. */
  deleteMap(id: string, opts?: { cascade?: boolean }): Promise<{ tombstones: Tombstone[] }>;

  listPins(mapId?: string): Promise<Pin[]>;
  getPin(id: string): Promise<Pin | null>;
  createPin(data: Partial<Pin>): Promise<Pin>;
  updatePin(id: string, patch: Partial<Pin>): Promise<Pin>;
  deletePin(id: string): Promise<{ tombstones: Tombstone[] }>;

  /**
   * Lists all zones. Zones have no map relationship — to find zones that
   * appear on a specific map, use the in-memory derived helper
   * `listZonesOnMap(mapId, markers, zones)` over `state.data.elements`.
   */
  listZones(): Promise<Zone[]>;
  getZone(id: string): Promise<Zone | null>;
  createZone(data: Partial<Zone>): Promise<Zone>;
  updateZone(id: string, patch: Partial<Zone>): Promise<Zone>;
  deleteZone(id: string): Promise<{ tombstones: Tombstone[] }>;

  /**
   * Lists markers, optionally filtered by map and/or zone.
   *   - `{ mapId }` → markers on that map (any or no zone)
   *   - `{ zoneId }` → markers belonging to that zone (across maps)
   *   - `{ mapId, zoneId }` → both (this zone's markers on this map)
   * Omitted filter returns all markers.
   */
  listMarkers(filter?: { mapId?: string; zoneId?: string }): Promise<Marker[]>;
  getMarker(id: string): Promise<Marker | null>;
  createMarker(data: Partial<Marker>): Promise<Marker>;
  updateMarker(id: string, patch: Partial<Marker>): Promise<Marker>;
  deleteMarker(id: string): Promise<{ tombstones: Tombstone[] }>;

  // ---- Media (always local, never synced) ----

  addMedia(elementId: string, file: File, folder?: string): Promise<MediaItem>;
  listMedia(elementId: string): Promise<MediaItem[]>;
  getMediaBlob(mediaId: string): Promise<Blob | null>;
  deleteMedia(mediaId: string): Promise<void>;

  // ---- Sync-relevant reads ----

  /**
   * Return all elements (content + spatial) whose `local_updated_at` is
   * strictly greater than the given baseline. Pass `null` to get every element
   * that has never been synced (no `server_updated_at`).
   */
  listLocallyChangedSince(baseline: string | null): Promise<Element[]>;

  /** Tombstones recorded since the given timestamp (null = all). */
  listTombstonesSince(baseline: string | null): Promise<Tombstone[]>;
  /** Remove a tombstone after successful server-side deletion. */
  clearTombstone(id: string): Promise<void>;

  readSyncState(): Promise<SyncState>;
  writeSyncState(patch: Partial<SyncState>): Promise<SyncState>;
  /**
   * Serialized read-modify-write on sync-state. The mutator receives the
   * CURRENT state (fresh read inside the store's sync-state chain) and
   * returns a partial patch merged over it. Use this — never a separate
   * readSyncState + writeSyncState — whenever the patch is computed FROM the
   * current state (conflict/server-delete list edits): the split form races
   * concurrent sync rounds and silently drops entries.
   */
  updateSyncState(mutate: (current: SyncState) => Partial<SyncState>): Promise<SyncState>;

  // ---- Charts (atlas-local saved chart configs; `.atlas/charts.json`) ----

  /**
   * Read saved chart configs. Atlas-local world config that travels with the
   * folder (like sync-state) — NOT an OW element, NOT localStorage. Returns an
   * empty array when no charts have been saved.
   */
  readCharts(): Promise<ChartConfig[]>;
  /** Overwrite the saved chart list (whole-list write, mirrors writeSyncState). */
  writeCharts(charts: ChartConfig[]): Promise<void>;

  // ---- World styles (`.atlas/styles.json`; core/world-styles.ts, S356) ----

  /** Read the world's style rules. Empty (not an error) when the file is absent or malformed. */
  readStyles(): Promise<WorldStyles>;
  /** Overwrite the world's style rules (whole-object write, like charts). */
  writeStyles(styles: WorldStyles): Promise<void>;
  /**
   * `.atlas/world-prefs.json` (S364): the world's notes, cast, calendar lens
   * and writing labels, so a copied folder carries them. `null` = no file.
   * Strict: a file that will not parse throws `CorruptFileError` (never
   * replaced by a seed).
   */
  readWorldPrefs(): Promise<Record<string, unknown> | null>;
  writeWorldPrefs(prefs: Record<string, unknown>): Promise<void>;

  /**
   * Direct write of `server_updated_at` (used by SyncEngine after a successful
   * push or pull). Does NOT change `local_updated_at`, EXCEPT when
   * `sentLocalUpdatedAt` (the stamp the pushed body carried) no longer matches
   * the file: the element was edited while the push was in flight, and it is
   * kept dirty so the edit goes out next round (S360 H1, `store/sync-stamp.ts`).
   * `null` = the server is known to hold different content: keep it dirty.
   * `kept`: fields keel wrote on that write, kept with the stamp in the same write (conv. 168).
   */
  stampServerUpdatedAt(id: string, type: ElementType, server_updated_at: string, sentLocalUpdatedAt?: string | null, kept?: Readonly<Record<string, unknown>>): Promise<void>;

  /**
   * Clear `server_updated_at` on a local element. Used when resolving a
   * server-side delete as "keep" — the element should be treated as never-synced
   * so the next push CREATEs it back on the server.
   */
  clearServerBaseline(id: string): Promise<void>;

  /**
   * Apply a server record verbatim. Sets BOTH `local_updated_at` and
   * `server_updated_at` to the server's authoritative timestamp, ensuring the
   * element won't be flagged as locally-changed on the next push pass.
   *
   * Used by SyncEngine.pullPhase when a server element is new locally OR
   * server-newer than the folder version (no local change to preserve).
   */
  applyServerRecord(
    type: ElementType, record: Record<string, unknown>, server_updated_at: string,
    opts?: ApplyServerRecordOpts,
  ): Promise<Element>;
  /** Pull-apply guarded INSIDE the per-id chain: writes only if the element's
   *  `local_updated_at` still equals `expectedLocalUpdatedAt` (null = absent).
   *  Returns false when a local edit landed first (S361, lane b M1). */
  applyServerRecordIfUnchanged(
    type: ElementType, record: Record<string, unknown>, server_updated_at: string,
    expectedLocalUpdatedAt: string | null,
  ): Promise<boolean>;

  /**
   * Sever every link this folder has to a remote api world. Used by the
   * "unlink from api" flow: after the user unlinks, the folder is
   * conceptually no longer associated with any api world, so all sync
   * metadata is invalidated. Local content (element fields, names, media,
   * relationships) is untouched.
   *
   * Concretely:
   *   - Every element's `server_updated_at` is stripped (next push treats
   *     them as never-synced → CREATEs on whatever api world is linked next).
   *   - Every tombstone is dropped (DELETEs targeted at the now-defunct api
   *     world; sending them to a different api world would 404).
   *   - sync-state.json resets to defaults (conflicts + server_deletes +
   *     last_pull_at + last_push_at all reference a now-meaningless context).
   *   - world.json's `api` block is removed (so a reload-and-rescan doesn't
   *     try to auto-re-attach with dead credentials).
   *
   * IDEMPOTENT — safe to call on a folder with no prior sync history. Without
   * this, after an unlink + re-link via Make-Online Route 1, elements with
   * lingering `server_updated_at` stamps from the deleted api world get
   * treated as UPDATEs against the new world, their pre-update GETs 404, and
   * the elements are silently routed to server_deletes — leaving the new
   * api world empty when the user expects a fresh upload.
   */
  resetSyncBaseline(): Promise<void>;

  // ---- Re-key (giving elements new ids, S363; `store/rekey.ts`) ----

  /**
   * Write `body` as a NEW element at `body.id`, verbatim: every field kept
   * (local-only ones included), `created_at` kept, `server_updated_at`
   * stripped, `local_updated_at` stamped now. No duplicate-pin guard: during a
   * re-key the old and new pin coexist by design. Runs in the per-id write
   * chain. `bindingFrom` names an existing element whose directory layout and
   * link spelling the new file inherits. When `body.id` already exists nothing
   * is written and `created: false` comes back with the element as it is.
   */
  createElementVerbatim(
    type: ElementType,
    body: Element,
    opts?: { bindingFrom?: string },
  ): Promise<{ created: boolean; element: Element }>;
  /** Copy every file under `media/<from>/` to `media/<to>/`, each blob before
   *  its sidecar; sidecars get `element_id: to`, media ids unchanged. Returns
   *  the number of files copied. */
  copyMediaDir(fromElementId: string, toElementId: string): Promise<number>;
  /** Remove `media/<elementId>/` whole. No-op when absent. Never looks up a
   *  media id (the same id lives under both dirs mid re-key). */
  removeMediaDir(elementId: string): Promise<void>;
  /** `.atlas/rekey-journal.json`. Strict: a file that will not parse throws `CorruptFileError`. */
  readRekeyJournal(): Promise<RekeyJournal | null>;
  writeRekeyJournal(journal: RekeyJournal): Promise<void>;
  clearRekeyJournal(): Promise<void>;
  /** Whether a journal file exists (parsed or not). The sync engine's gate. */
  hasRekeyJournal(): Promise<boolean>;
  /** The id lives in BOTH element layouts (`elements/` and legacy `spatial/`):
   *  one copy is served, the other left untouched. Re-keying it would leave the
   *  shadow behind to come back as a twin (S363 gate lens A F3). */
  hasShadowCopy(id: string): boolean;
  /**
   * THE LIVE FOLDER (S364): find element files another tool changed, created
   * or deleted since Atlas last read or wrote them, and serve the disk's
   * version from now on. In memory only: it writes no file and no tombstone,
   * and never invents a sync stamp. Refuses while a re-key journal exists.
   * Single-flight: a call during a run waits for one more run after it.
   * `full` confirms every served file by content ("Reload from disk"): the
   * stat pass misses an overwrite that kept its mtime and size.
   */
  rescanDisk(opts?: { full?: boolean }): Promise<RescanResult>;
}

/** One element file that changed on disk behind Atlas's back (S364). */
export interface DiskChange {
  id: string;
  type: ElementType;
  kind: 'changed' | 'created' | 'deleted' | 'unreadable';
  /** The body Atlas served before (changed, deleted). */
  before?: Element;
  /** Unreadable files: the file name (the id may be unknowable). */
  filename?: string;
}

export interface RescanResult {
  changes: DiskChange[];
  /** Why nothing was scanned: the store closed, or a re-key is unfinished. */
  skipped?: 'closed' | 'rekey';
}

/**
 * A non-silent delete of an id an unfinished re-key names (its old or new
 * copy). Deleting either one would scrub the links that already moved to it
 * (S363 gate lens A F6): finish or discard the id update first.
 */
export class RekeyPendingError extends PlainError {
  constructor() {
    super('Finish or undo the id update in Settings first.');
    this.name = 'RekeyPendingError';
  }
}

/** Every id a journal names, old and new. */
export function journalIds(journal: RekeyJournal | null): Set<string> {
  const out = new Set<string>();
  if (!journal || !journal.map || typeof journal.map !== 'object') return out;
  for (const [o, n] of Object.entries(journal.map)) { out.add(o); if (typeof n === 'string') out.add(n); }
  return out;
}

export interface ApplyServerRecordOpts {
  /**
   * Local-only fields NOT to carry over from the existing file. A server
   * record normally keeps every atlas-only field the local file had (the
   * server never knows them); Route 2's "keep the server version" policy
   * gives up the local rich text, or the editor would show local prose over
   * the server's (S367).
   */
  dropLocal?: readonly string[];
}

/** An unfinished re-key, on disk until its last step (`store/rekey.ts`). */
export interface RekeyJournal {
  version: 1;
  /** The atlas world id (registry), so recovery acts on the right world's browser state. */
  world_id: string;
  /** old id → new id. */
  map: Record<string, string>;
  /** old id → element type. */
  types: Record<string, ElementType>;
  /** old id → its `local_updated_at` when the run began: an edit since means re-copy before removing. */
  stamps: Record<string, string>;
  /** Referrers that could not be read (corrupt files) and still name old ids. */
  unrewritten: string[];
  started_at: string;
  /**
   * What started it (S367, additive: absent = 'rekey'). 'merge' is Route 2
   * moving local ids onto a server world's ids before it links; the world
   * is still local-only, so the copy that speaks about an unfinished run
   * says to run Make online again rather than "not syncing".
   */
  origin?: 'rekey' | 'merge';
}

export function newId(): string {
  // RFC 4122 v4 via crypto API; available in Node 20+ and all modern browsers.
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
