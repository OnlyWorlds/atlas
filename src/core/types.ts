/**
 * Core types for atlas. Folder-first architecture.
 *
 * Element / WorldMap / Pin / Zone / Marker shapes match OnlyWorlds SDK types
 * loosely — we don't import them directly here to keep the core decoupled
 * from SDK details. Adapter layer (in sync/) handles the SDK boundary.
 */

// ---- Element types ----

export const CONTENT_ELEMENT_TYPES = [
  'character', 'creature', 'species', 'family', 'collective', 'institution',
  'location', 'object', 'construct', 'ability', 'trait', 'title', 'language',
  'law', 'event', 'narrative', 'phenomenon', 'relation',
] as const;

export const SPATIAL_ELEMENT_TYPES = ['map', 'pin', 'zone', 'marker'] as const;

export const ALL_ELEMENT_TYPES = [...CONTENT_ELEMENT_TYPES, ...SPATIAL_ELEMENT_TYPES] as const;

export type ContentElementType = typeof CONTENT_ELEMENT_TYPES[number];
export type SpatialElementType = typeof SPATIAL_ELEMENT_TYPES[number];
export type ElementType = typeof ALL_ELEMENT_TYPES[number];

// ---- Element shape (folder representation) ----

/**
 * Element as stored on disk. Fields beyond core are open-ended (per SDK schema).
 *
 * - `local_updated_at` is stamped by FolderStore on every write
 * - `server_updated_at` is stamped by SyncEngine on successful sync; absent if never synced
 */
export interface Element {
  id: string;
  type: ElementType;
  name: string;
  local_updated_at: string;
  server_updated_at?: string;
  [field: string]: unknown;
}

// ---- Spatial-specific types (light typing; SDK has the truth) ----

/**
 * Map element.
 *
 * Schema fields (sync with OW API): image_url, width, height, depth,
 * background_color, hierarchy, parent_map, location. All optional except
 * the inherited name/id.
 *
 * Atlas-extension field (never pushed to API): image_media_id — reference
 * to a local media item used as image fallback when image_url is empty.
 *
 * Field semantics (see DESIGN_MAPS.md §1):
 *   - parent_map: "this map is geographically within the parent map's
 *     boundaries." Explicit nesting in the map tree.
 *   - location: "this map is OF this place." When set without parent_map,
 *     the tree-builder infers placement via Location.parent_location chain.
 *   - hierarchy: sibling ordering only (lower comes first). No absolute-
 *     scale semantic. Ties broken alphabetically.
 *   - background_color: fallback canvas color; atlas auto-extracts edge
 *     color from image too.
 *   - depth: reserved, currently unused.
 */
export interface WorldMap extends Element {
  type: 'map';
  image_url?: string;
  width?: number;
  height?: number;
  depth?: number;
  background_color?: string;
  hierarchy?: number;
  parent_map?: string;
  location?: string;
  /** Atlas-extension: reference to local media item (never pushed to API). */
  image_media_id?: string;
}

export interface Pin extends Element {
  type: 'pin';
  element_id: string;
  element_type?: string;
  map_id: string;
  x: number;
  y: number;
}

export interface Zone extends Element {
  type: 'zone';
  map_id: string;
  coordinates?: number[][];
}

export interface Marker extends Element {
  type: 'marker';
  map_id: string;
  x: number;
  y: number;
}

// ---- Media ----

export interface MediaItem {
  id: string;
  element_id: string;
  folder: string;
  filename: string;
  mime: string;
  size_bytes: number;
  added_at: string;
}

// ---- World metadata (per-world world.json) ----

export interface WorldMeta {
  id: string;
  name: string;
  description?: string;
  version?: string;
  /** Present iff world is api-linked. */
  api?: {
    world_id: string;
    api_key: string;
    /**
     * Name of the world on the OW server, as returned by `client.worlds.get()`.
     * Populated at link time AND refreshed on every Test Connection. May
     * differ from the LOCAL world name (`WorldMeta.name`) when the user
     * picked a different display name during Make-Online, or when the user
     * renamed locally vs server-side. Display-only — atlas never renames
     * the server world to match local.
     */
    world_name?: string;
  };
  /** Time format config — passes through to OW schema. */
  time_format_names?: string[];
  time_format_equivalents?: string[];
  time_basic_unit?: string;
  time_current?: number;
  time_range_min?: number;
  time_range_max?: number;
}

// ---- Sync state (per-world .atlas/sync-state.json) ----

export interface SyncState {
  last_pull_at: string | null;
  last_push_at: string | null;
  paused: boolean;
  pause_reason?: 'manual' | 'network';
  conflicts: Conflict[];
  /**
   * Server-deleted elements detected during pull (Phase 3.5+).
   * Local file still exists; awaiting user decision (delete locally vs re-push).
   */
  server_deletes?: ServerDeleteRecord[];
}

export interface ServerDeleteRecord {
  id: string;
  type: ElementType;
  detected_at: string;
  /** Local name at detection time — for display in the review modal. */
  name?: string;
}

export interface Conflict {
  element_id: string;
  type: ElementType;
  detected_at: string;
  local_updated_at: string;
  server_updated_at: string;
  /** Fields that diverged between local pre-edit baseline and server. */
  fields: string[];
}

// ---- Tombstones (per-world .atlas/tombstones.json) ----

export interface Tombstone {
  id: string;
  type: ElementType;
  deleted_at: string;
}

// ---- Sync engine state (observable for UI) ----

export type SyncEngineState =
  | { kind: 'idle'; last_sync_at: string | null }
  | { kind: 'syncing'; phase: 'pull' | 'push'; progress?: { done: number; total: number } }
  | { kind: 'paused'; reason: 'manual' | 'network'; pending_changes: number }
  | { kind: 'error'; message: string; recoverable: boolean };

export interface SyncResult {
  pushed: { creates: number; updates: number; deletes: number };
  pulled: { creates: number; updates: number; deletes: number };
  conflicts: Conflict[];
  /** Per-element failures during push (4xx, validation, etc.) — non-fatal. */
  failures: PerElementFailure[];
  /**
   * Set when the round was aborted by an authentication failure (HTTP 401/403).
   * Distinct from per-element `failures` because auth-failed pushes/pulls bail
   * early — every subsequent op would fail the same way, so the engine stops
   * the round and transitions to `error` state. UI surfaces "auth failed —
   * verify pin or unlink" in the sync pill; pending writes stay on disk until
   * recovery (PIN change in settings → engine re-attach with fresh creds).
   */
  auth_blocked?: boolean;
}

export interface PerElementFailure {
  element_id: string;
  type: ElementType;
  operation: 'create' | 'update' | 'delete';
  message: string;
}

// ---- Registry ----

export type WorldState = 'local-only' | 'api-linked';

/**
 * One open tab on the right pane. Map-index is implicit (always present).
 * Lives in types.ts (not state.ts) because the registry persists it per-world
 * and importing state.ts from registry/ would create a dependency cycle.
 *
 * `locked` (map tabs only): when true, selecting an element (sidebar OR pin
 * click) does NOT auto-switch the map. See DESIGN_MAPS.md §3.4.
 *
 * `worldId` (map tabs only): stamped when the tab opens. Lets the stale-tab
 * pane name which world the map belongs to ("this map belongs to <World X>")
 * — tabs persist across world switches by design (§5), so we can't infer the
 * owning world from active state.
 */
export type RightTabRef =
  | { kind: 'map-index' }
  | { kind: 'map'; mapId: string; label: string; worldId?: string; locked?: boolean };

/**
 * Per-world right-pane tab snapshot. Persisted on WorldRegistryEntry so the
 * tab state survives world switches and page reloads.
 */
export interface RightTabsSnapshot {
  tabs: RightTabRef[];
  activeIndex: number;
}

export interface WorldRegistryEntry {
  id: string;
  name: string;
  state: WorldState;
  /** Present iff api-linked. */
  api?: {
    world_id: string;
    api_key: string;
    /** See `WorldMeta.api.world_name` — display-only mirror of server-side name. */
    world_name?: string;
  };
  /** Present for every world — Atlas always has a folder. */
  folder: {
    handle_key: string;
    folder_name: string;
    last_path_hint?: string;
  };
  parent_id?: string;
  order?: number;
  favorite?: boolean;
  created_at: string;
  last_opened_at?: string;
  /**
   * Per-world "stay offline" toggle (Phase 3.5+). When true, the engine is
   * attached but immediately paused — no pushes, no pulls, no debounced sync.
   * User can flip it back on to resume. Persists across reloads.
   */
  sync_paused?: boolean;
  /**
   * Per-world right-pane tab snapshot (DESIGN_MAPS.md §5). Restored on
   * activation; snapshotted before world switch. Absent → defaults to
   * `[{kind:'map-index'}]` + active index 0.
   */
  right_tabs?: RightTabsSnapshot;
}

export interface WorldsRegistry {
  version: number;
  worlds: WorldRegistryEntry[];
  /** Global PIN for OW api access. */
  pin?: string;
  /** Global email for OW account (used by create-world-external). */
  email?: string;
  active_world_id?: string;
  /**
   * Default container folder for newly-created local worlds.
   * Holds atlas-managed worlds as subfolders.
   * The actual handle lives in handle-vault under `ATLAS_ROOT_HANDLE_KEY`.
   * Independently of this, each world has its own handle in the vault — so
   * the root is a creation convenience, not a storage layer.
   */
  atlas_root?: {
    handle_key: string;
    folder_name: string;
    path_hint?: string;
    set_at: string;
  };

  // ---- Sync settings (Phase 3.5+) ----
  // All global. Per-world overrides are deferred to 3.6 if needed.

  /** Pull from API when an api-linked world activates. Default: false. */
  sync_pull_on_activate?: boolean;

  /**
   * Cadence for periodic auto-pull while the tab is visible and an api-linked
   * world is active. Null/undefined = off (default). Otherwise ms between polls.
   */
  sync_cadence_ms?: number | null;

  /**
   * Default conflict policy (Phase 3.5+, simplified to two values):
   *   - `local-wins` (default): local edits always win. Push overwrites server.
   *     Pull skips applying server changes for elements you've also edited.
   *     One-shot toast per sync round. No badge, no modal.
   *   - `pause-and-review`: nothing auto-resolves. Push skips, pull skips.
   *     ⚠ badge fires. Modal lets user pick overwrite vs pull per element.
   *
   * Legacy values (`drain-blind`, `pause-on-conflict`, `ask`) are migrated on
   * load — see `loadRegistry`.
   */
  sync_default_policy?: 'local-wins' | 'pause-and-review';

  /** Confirm before deleting locally to match a server-side delete. Default: true. */
  sync_confirm_server_deletes?: boolean;

  /** Master kill switch — pauses every engine if true. Default: false. */
  sync_pause_all?: boolean;
}

export function defaultRegistry(): WorldsRegistry {
  return { version: 1, worlds: [] };
}
