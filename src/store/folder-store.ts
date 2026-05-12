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
   * Delete an element. Writes a tombstone, then removes the file. Cascade
   * deletion of dependent spatial elements (pins, markers referencing it) is
   * caller's responsibility — pass them through deleteElement individually.
   */
  deleteElement(id: string): Promise<void>;

  // ---- Spatial elements ----

  listMaps(): Promise<WorldMap[]>;
  getMap(id: string): Promise<WorldMap | null>;
  createMap(data: Partial<WorldMap>): Promise<WorldMap>;
  updateMap(id: string, patch: Partial<WorldMap>): Promise<WorldMap>;
  deleteMap(id: string): Promise<void>;

  listPins(mapId?: string): Promise<Pin[]>;
  getPin(id: string): Promise<Pin | null>;
  createPin(data: Partial<Pin>): Promise<Pin>;
  updatePin(id: string, patch: Partial<Pin>): Promise<Pin>;
  deletePin(id: string): Promise<void>;

  listZones(mapId?: string): Promise<Zone[]>;
  getZone(id: string): Promise<Zone | null>;
  createZone(data: Partial<Zone>): Promise<Zone>;
  updateZone(id: string, patch: Partial<Zone>): Promise<Zone>;
  deleteZone(id: string): Promise<void>;

  listMarkers(mapId?: string): Promise<Marker[]>;
  getMarker(id: string): Promise<Marker | null>;
  createMarker(data: Partial<Marker>): Promise<Marker>;
  updateMarker(id: string, patch: Partial<Marker>): Promise<Marker>;
  deleteMarker(id: string): Promise<void>;

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
}

export function newId(): string {
  // RFC 4122 v4 via crypto API; available in Node 20+ and all modern browsers.
  return crypto.randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}
