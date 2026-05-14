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

export interface FolderStore {
  // ---- Lifecycle ----

  /** Attach to an underlying folder (browser: DirectoryHandle; mock: noop). */
  open(handle: FileSystemDirectoryHandle | null): Promise<void>;

  /** Detach. Implementations may flush in-flight writes. */
  close(): Promise<void>;

  // ---- World metadata ----

  readWorldMeta(): Promise<WorldMeta>;
  writeWorldMeta(patch: Partial<WorldMeta>): Promise<WorldMeta>;

  // ---- Content elements ----

  listElements(type?: ElementType): Promise<Element[]>;
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
   * Delete an element. Writes a tombstone, then removes the file.
   *
   * Cascade rules (default `opts.cascade = true`):
   * - Content element delete → also tombstones every pin whose `element_id` references it.
   * - Map delete → also tombstones every pin / zone / marker on that map.
   * - Pin / zone / marker delete → no cascade (leaves of the graph).
   *
   * Cascade tombstones are pushed BEFORE the primary tombstone so server DELETEs
   * execute in dependency-safe order. Returns every tombstone written (primary
   * is always the last entry).
   *
   * Pass `cascade: false` only for advanced flows (engine cleanups, repairs);
   * UI flows must use the default to avoid orphaning dependents.
   *
   * Pass `silent: true` to remove the file WITHOUT writing tombstones. Used by
   * id-swap during Route 2 merge — the local file at the old id never had a
   * server counterpart, so no DELETE should propagate. Silent also implies
   * `cascade: false` (silent delete is a surgical operation, not a sweep).
   */
  deleteElement(id: string, opts?: { cascade?: boolean; silent?: boolean }): Promise<{ tombstones: Tombstone[] }>;
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

  listZones(mapId?: string): Promise<Zone[]>;
  getZone(id: string): Promise<Zone | null>;
  createZone(data: Partial<Zone>): Promise<Zone>;
  updateZone(id: string, patch: Partial<Zone>): Promise<Zone>;
  deleteZone(id: string): Promise<{ tombstones: Tombstone[] }>;

  listMarkers(mapId?: string): Promise<Marker[]>;
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
   * Direct write of `server_updated_at` (used by SyncEngine after a successful
   * push or pull). Does NOT change `local_updated_at`.
   */
  stampServerUpdatedAt(id: string, type: ElementType, server_updated_at: string): Promise<void>;

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
  applyServerRecord(type: ElementType, record: Record<string, unknown>, server_updated_at: string): Promise<Element>;

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
}

export function newId(): string {
  // RFC 4122 v4 via crypto API; available in Node 20+ and all modern browsers.
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
