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
 *
 * The named optional fields below cover (a) common SDK fields that atlas reads
 * across element types (description, image_url, story, dates) and (b) the
 * atlas-local extension fields (atlas_richtext_json, atlas_aliases) — see
 * `ATLAS_LOCAL_EXTENSION_FIELDS` in core/constants.ts for the strip-discipline
 * contract. Listed here so readers don't need `(el as any).field` to access
 * them safely; the index signature still covers the long tail of SDK fields.
 */
export interface Element {
  id: string;
  type: ElementType;
  name: string;
  local_updated_at: string;
  server_updated_at?: string;
  // Common SDK fields read in multiple places (no narrowing without these
  // explicit declarations because the index signature returns `unknown`).
  description?: string;
  image_url?: string;
  /** Long-form prose / narrative body. Markdown serialization. */
  story?: string;
  /** Display date for events, narratives, etc. Date string OR numeric stamp. */
  start_date?: string | number;
  end_date?: string | number;
  // Atlas-local extension fields (see DESIGN.md "Atlas-Specific Fields"
  // tracking section and ATLAS_LOCAL_EXTENSION_FIELDS in core/constants.ts).
  // Stripped on API push; preserved on pull overlay.
  /** TipTap JSON document for Narrative richtext (convention #47). */
  atlas_richtext_json?: unknown;
  /** Alternate names matched by @ picker + auto-link (convention #49). */
  atlas_aliases?: string[];
  /**
   * Per-narrative suggestion dismissals for the writing-context pane. When
   * the writer × dismisses a suggested element in the Suggested list, its id
   * is added here so it stops surfacing for THIS narrative. Other narratives
   * (sibling chapters, the next book) compute suggestions independently.
   * Atlas-local extension; never pushed to the API.
   */
  atlas_dismissed_suggestions?: string[];
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

/**
 * Zone — pure metadata (per OW SDK Zone schema, verified 2026-05-16).
 *
 * Zones have NO map field and NO geometry. They are conceptual elements
 * (a Kingdom, a Forest, a Trade Route). Their spatial existence is emergent:
 * a zone "appears" on a map IFF at least one Marker references both that
 * zone and that map. Geometry is reconstructed by sorting those markers
 * by `order`. See DESIGN_ZONES.md §1.
 *
 * Atlas-extension fields (folder-only, never pushed to API):
 *   - atlas_color: zone outline + fill color (hex string)
 *   - atlas_opacity: zone fill opacity (0..1)
 *   - atlas_label_visible: render zone name as on-canvas label
 *
 * Other fields come through the index signature on `Element` from the SDK
 * schema (role, dates, phenomena, linked_zones, populations, etc.).
 */
export interface Zone extends Element {
  type: 'zone';
  atlas_color?: string;
  atlas_opacity?: number;
  atlas_label_visible?: boolean;
}

/**
 * Marker — spatial truth for zones.
 *
 * Each marker carries BOTH the map relationship AND the zone relationship
 * AND the coordinates. `order` determines sequence within a zone's geometry.
 * See DESIGN_ZONES.md §1.
 */
export interface Marker extends Element {
  type: 'marker';
  map_id: string;
  zone_id?: string;
  x: number;
  y: number;
  z?: number;
  order?: number;
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
  /** World cover image URL. Preserved on import/export round-trip (DESIGN_IMPORT.md). */
  image_url?: string;
  /**
   * True only for the bundled sample world (Bout OW/DEMO). Gestures inside a
   * demo world never complete waypoints. Lives in world.json so the flag
   * survives localStorage wipes + rediscovery; make-online clears it (the
   * world is genuinely yours then). Normal imports never set it — the import
   * world-block mapper whitelists fields, and createWorldFromImportedData
   * strips it defensively.
   */
  demo?: boolean;
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
  /**
   * Opaque /changes watermark for the v2 delta pull (format "<seq>:<id>",
   * treated as opaque). Null/absent = never walked; the next pull cold-starts
   * from the world's epoch. Advanced only in lockstep with the round's
   * derived side-effects (server_deletes + conflicts) — never past ops whose
   * side-effects weren't persisted (gate finding, 2026-07-12). Cleared by
   * resetSyncBaseline: a re-link must never inherit another world's cursor.
   */
  changes_cursor?: string | null;
  /**
   * Highest change_seq ever APPLIED from the /changes feed. The rewind
   * detector's memory: a /changes response whose `head` is BELOW this means
   * the server was restored from backup (the one legal rewind path, Skeld
   * §8) — the engine re-baselines with a cold walk instead of trusting a
   * cursor pointing past the world's history. Cleared with the cursor by
   * resetSyncBaseline.
   */
  changes_last_seq?: number | null;
  conflicts: Conflict[];
  /**
   * Server-deleted elements detected during pull (Phase 3.5+).
   * Local file still exists; awaiting user decision (delete locally vs re-push).
   */
  server_deletes?: ServerDeleteRecord[];
  /**
   * World-meta sync baseline (S262, gate R2): a CANONICAL snapshot of the 8
   * synced world.json wire fields as last confirmed with the server
   * (''/[]/null empties — see META_SYNC_FIELDS in sync/world-meta-sync.ts).
   * Absent = meta never synced: the next meta step SEEDS it from GET /world
   * and never PATCHes that round (the absent-baseline blind-push was the
   * gate's 3-lens convergent finding). Refreshed PER-FIELD: only fields a
   * PATCH sent or a pull applied — untouched fields keep their stale baseline
   * so later server-only changes still surface. Cleared by resetSyncBaseline.
   */
  meta_baseline?: Record<string, unknown> | null;
  /** Server updated_at from the last /world read or PATCH echo. Informational
   *  skip-optimization only — never load-bearing (redundant same-value
   *  PATCHes bump it server-side; the field diff is the truth). */
  meta_server_updated_at?: string | null;
  /**
   * Contested world-meta fields under pause-and-review (both sides changed
   * since baseline, values differ). Persisted so the badge survives reload;
   * resolved via the conflict-review modal's world-settings rows (gate R9).
   */
  meta_conflicts?: string[];
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
   * Element ids that pull just APPLIED to local — i.e. CREATEs (downloaded
   * fresh) plus UPDATEs (overwritten locally). Used by the UI to flash
   * recently-pulled rows non-obtrusively (P3). Empty array on push-only
   * rounds.
   */
  pulled_ids?: string[];
  /**
   * Set when the round was aborted by an authentication failure (HTTP 401/403).
   * Distinct from per-element `failures` because auth-failed pushes/pulls bail
   * early — every subsequent op would fail the same way, so the engine stops
   * the round and transitions to `error` state. UI surfaces "auth failed —
   * verify pin or unlink" in the sync pill; pending writes stay on disk until
   * recovery (PIN change in settings → engine re-attach with fresh creds).
   */
  auth_blocked?: boolean;
  /**
   * Refines auth_blocked when the server's typed error distinguished the
   * cause: a REVOKED key wants "mint a new key" guidance, not "check your
   * PIN" (gate R4, 2026-07-13 — minted account-mode keys are revocable from
   * the portal independently of the PIN). `read_only_key` is a 403
   * permission_error — the key can never write, so the round bails like any
   * auth failure but the copy must say "read-only key", never "check your
   * PIN" (world-meta gate R1, 2026-07-13).
   */
  auth_reason?: 'key_revoked' | 'read_only_key';
  /**
   * World-meta fields (disk names) the meta step PUSHED to / PULLED from
   * `PATCH|GET /world` this round (world-meta sync, S262). Lets the UI
   * surface meta-only rounds honestly — pushed/pulled above count elements
   * only, so without these a meta-only round reads as "nothing synced"
   * (gate R7, the lying-pill class).
   */
  meta_pushed?: string[];
  meta_pulled?: string[];
}

export interface PerElementFailure {
  element_id: string;
  /** `'world'` = a world-meta step failure (element_id 'world', S262). */
  type: ElementType | 'world';
  operation: 'create' | 'update' | 'delete' | 'read';
  message: string;
}

// ---- Registry ----

export type WorldState = 'local-only' | 'api-linked';

/**
 * One open tab on the right pane. Map-index is implicit (always present).
 * Lives in types.ts (not state.ts) because the registry persists it per-world
 * and importing state.ts from registry/ would create a dependency cycle.
 *
 * `worldId` (map tabs only): stamped when the tab opens. Lets the stale-tab
 * pane name which world the map belongs to ("this map belongs to <World X>")
 * — tabs persist across world switches by design (§5), so we can't infer the
 * owning world from active state.
 */
export type RightTabRef =
  /**
   * Context tab — permanent leftmost tab per world. Shows a graph + details
   * area whose contents derive from the current route (route.mode + relevant
   * id). Managed by `context-tab-lifecycle.ts`: ensured to exist at index 0
   * whenever an active world is loaded. Never carries a subject id on the ref
   * — subject is always read from the URL.
   */
  | { kind: 'context' }
  | { kind: 'map-index' }
  | { kind: 'map'; mapId: string; label: string; worldId?: string };

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
  /**
   * Server world id this entry was PREVIOUSLY linked to (set by unlink /
   * detachApi). Lets the account-mode remote list suppress worlds that are
   * already here as local-only folders — without it, an unlinked world
   * reappears "On OnlyWorlds" and re-opening it would duplicate the folder.
   */
  former_api_world_id?: string;
  /** Present for every world — Atlas always has a folder. */
  folder: {
    handle_key: string;
    folder_name: string;
    last_path_hint?: string;
  };
  parent_id?: string;
  order?: number;
  favorite?: boolean;
  /**
   * Home-cover favorites (D2b): the world's named cast — a protagonist
   * (character) and a home/nexus (location). Assignment via the element-detail
   * header icon (char + loc only); rendered as the cast slot on the home
   * cover page. Atlas-local (registry-side, never synced).
   */
  favorites?: {
    protagonist_id?: string | null;
    nexus_id?: string | null;
  };
  /** Mirror of `WorldMeta.demo` — the bundled sample world. Gestures in a demo world never complete waypoints. */
  demo?: boolean;
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
  /**
   * Customizable labels for the writing room's four tier hierarchy
   * (DESIGN_WRITING.md). Defaults: Book / Chapter / Scene / Draft. The label
   * IS the storage value for `Narrative.supertype` — atlas writes
   * `supertype = labels.l1` when creating a Book, etc. Filter is reversed:
   * narratives whose supertype matches one of l1-l4 are in the writing tree.
   *
   * Labels are atlas-local (never synced as a registry field) but the supertype
   * value on each Narrative IS synced (it's a core OW field).
   *
   * Renaming a label triggers a migration offer that updates existing
   * narratives' supertype to the new value (so display + storage stay
   * consistent, no canonical/display split).
   */
  writing_labels?: {
    l1: string;
    l2: string;
    l3: string;
    l4: string;
  };
  /**
   * One-time flag set after the user completes the writing-setup flow for
   * this world (confirms labels, optionally promotes existing structured
   * narratives). When false/missing, opening the writing room shows the setup
   * screen INSTEAD of the tree — but only if there's a meaningful decision to
   * make (existing narrative structure detected, or non-default candidates).
   * Fresh worlds with no narratives default to initialized + default labels.
   */
  writing_initialized?: boolean;
  /**
   * Writing room — IDs of nodes the user has collapsed in the tree. Default
   * is expanded (a node is collapsed iff its id appears in this array).
   * Atlas-local; never synced. Persisted in registry so collapse state
   * survives reloads.
   */
  writing_tree_collapsed?: string[];
  /**
   * Writing room — the last narrative the user had selected. Used by the
   * room-nav writing icon to restore the previous editing context when the
   * user returns to writing after navigating elsewhere. Atlas-local; never
   * synced. Cleared if the narrative no longer exists (handled at read time).
   */
  last_writing_narrative_id?: string;
  /**
   * Writing workspace prose font size in CSS px (DESIGN_WRITING.md §The
   * writing workspace). Atlas-local pref; persists per-world. Range: 12–20.
   * Defaults to 15 when missing. Applied via the
   * `--atlas-prose-font-size` CSS variable on the workspace root.
   */
  writing_font_size_px?: number;
  /**
   * Writing workspace prose font family — picks a system-font stack via the
   * `--atlas-prose-font-family` CSS variable. System fonts only (no webfont
   * download). Reading mode and writing mode share this choice; reading mode
   * adds its own size + line-height + max-width on top. Atlas-local pref.
   * Defaults to 'sans' when missing.
   */
  writing_font_family?: 'sans' | 'serif' | 'slab' | 'mono';
  /**
   * Writing workspace — last-selected tab on the character-cast strip
   * (DESIGN_WRITING.md §Cast strip). Persists per-world so a TTRPG writer
   * who lives in Creatures lands on Creatures by default. Atlas-local.
   */
  writing_cast_tab?: 'characters' | 'locations' | 'objects' | 'events' | 'creatures';
  /**
   * Browser-native spellcheck on the writing-workspace prose. Toggleable
   * because element-name squiggles (proper nouns) annoy worldbuilders.
   * Defaults to true when missing. Applied via the contenteditable's
   * spellcheck attribute on editor mount + on registry change.
   */
  writing_spellcheck?: boolean;
  /**
   * @deprecated Session 231: dropped when the context tab became permanent +
   * tool-global. Field is still tolerated on load for backward-compat with
   * existing registry entries but no code reads it. Safe to remove once
   * persisted registries have rolled over.
   */
  writing_context_auto_open?: boolean;
  /**
   * Context pane: element types the user has hidden from the graph + below-
   * graph lists. Persisted per-world; survives page reload. Empty/absent =
   * all types shown. Set via the context-pane toolbar's type chips.
   */
  context_filters_off?: ElementType[];
  /**
   * Context pane: graph hop depth (number of rings outward from the subject).
   * 1 = direct cast only; 2 = cast + adjacent; 3-4 = wider exploration with
   * per-ring caps. Absent = tier-derived default (narrative subjects at
   * scene/draft default to 2; at chapter/book default to 1; non-narratives
   * default to 2). Set via the context-pane toolbar's hop pill or
   * Settings → Context.
   */
  context_hop_depth?: 1 | 2 | 3 | 4;
  /**
   * Context pane: lock the graph layout when toggling type filters. When
   * true, hiding a type just visibility-toggles the existing nodes/edges
   * instead of re-running the physics sim — surviving nodes don't jump.
   * When false/absent (default), filter toggles re-run the sim so the
   * remaining nodes use the available space.
   */
  context_lock_layout?: boolean;
  /**
   * Context pane: tint graph edges by the non-center node's element type
   * (using the shared ELEMENT_TYPE_COLORS palette). When false/absent
   * (default), all edges render in the neutral cyan accent.
   */
  context_edge_color?: boolean;
  /**
   * Per-world freeform notes — atlas-local (never synced). Accessed via the
   * notes overlay (src/ui/notes-overlay.ts). Lives in the registry so it
   * survives reloads without depending on the world's folder being granted
   * permission. Captain mentioned wanting "a random notes modal/page that is
   * persistent in app, just overlays and for random dumps" — this is it.
   */
  notes?: string;
  /**
   * Atlas-local cache of published showcases for this world. Backend is the
   * truth (POST /showcase/publish/ + GET /showcase/<id>/); this list is the
   * offline-tolerant index. See DESIGN_PUBLISHING.md.
   */
  showcases?: ShowcaseEntry[];
}

export interface ShowcaseEntry {
  showcase_id: string;
  element_id: string;
  element_type: ElementType;
  published_at: string;
  public_url: string;
  hidden_fields?: string[];
  /** Atlas extensions to showcase_config — see DESIGN_PUBLISHING.md "Atlas extensions". */
  atlas_bundle_ids?: string[];
  atlas_layout?: 'card' | 'page' | 'book' | string;
  atlas_cover_image_url?: string;
}

/**
 * One world row from GET /api/v2/account/worlds (account-mode). Wire shape
 * pinned 2026-07-13 — see Notes/2026-07-13-account-mode-design.md.
 */
export interface AccountWorldRow {
  id: string;
  name: string;
  role: 'owner' | 'collaborator';
  public_read: boolean;
  keys: Array<{ last4: string; scope: 'READ' | 'WRITE'; revoked: boolean }>;
}

export interface WorldsRegistry {
  version: number;
  worlds: WorldRegistryEntry[];
  /** Global PIN for OW api access. */
  pin?: string;
  /** Global email for OW account (used by create-world-external). */
  email?: string;
  /**
   * OnlyWorlds account token (`ow_a_...`), pasted from the portal Tokens UI.
   * Grants account-scoped reads (world list) and key minting — sync itself
   * still runs on per-world keys in world.json. Same trust posture as `pin`:
   * a bearer credential on the user's own machine.
   */
  account_token?: string;
  /** Display cache from GET /account at sign-in ("Signed in as …"). */
  account_username?: string;
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

  /**
   * Autosave debounce window for pushes (ms). After a local write, the
   * SyncEngine waits this long before pushing — coalesces bursts of edits
   * into one round-trip. Default 5000. Settable via Settings → Sync.
   * Null/undefined → engine default (5000). The sync pill renders a decay
   * ring during this window.
   */
  sync_debounce_ms?: number | null;

  // ---- Maps subsystem settings (DESIGN_MAPS.md §3.5) ----
  /**
   * Atlas-level map behavior toggles. All default OFF. Stored at the registry
   * level (not per-world) — they're user preferences about how atlas presents
   * maps, not facts about any particular world.
   *
   * Three independent label toggles, each surfacing a different name next to
   * a glyph in the element-detail top bar. Splits originally bundled "show
   * names" into per-context preferences (session 211 smoke).
   */
  maps_settings?: {
    /** Show map name next to `[map]` icons in Location element headers. */
    show_map_names_in_header?: boolean;
    /** Show pin's map name next to `[pin]` icons in any element header. */
    show_pin_map_names_in_header?: boolean;
    /** Show pinned element name next to category icons on Map detail header. */
    show_pinned_element_names_in_header?: boolean;
  };

  /**
   * Editor-wide preferences for how field rows accept value edits.
   * `field_edit_mode` selects the affordance:
   *   - 'modal'         (default): clicking a field value opens FieldEditPopover
   *   - 'inline-single':           transforms the row into a single-line input
   *                                in-place; growable as user types more
   *   - 'inline-multi':            transforms into a ~4-line textarea in-place
   * Applies to text-short / text-long / number widgets. Link widgets always
   * use the picker modal regardless.
   */
  editor_settings?: {
    field_edit_mode?: 'modal' | 'inline-single' | 'inline-multi';
    /**
     * Group element-detail "Referenced by" entries by the relationship field
     * that points at the element ("Rival of…", "Birthplace of…") instead of by
     * element type. Default off (group by type).
     */
    refs_group_by_field?: boolean;
    /** Ask for confirmation before deleting an element. Default on. */
    confirm_before_delete?: boolean;
    /**
     * Render element images (image_url) in atlas chrome — detail banner +
     * context-pane thumb. Default on. The banner's × and the header's
     * icon-thumbnail flip this same setting in place (session 239).
     */
    show_element_images?: boolean;
  };
}

export function defaultRegistry(): WorldsRegistry {
  return { version: 1, worlds: [] };
}
