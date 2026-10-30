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
  /** Folder Format spec version the folder was written against (§4.2). Stamped at birth; see FOLDER_FORMAT_VERSION. */
  format_version?: string;
  /**
   * Which tool made this folder and from what (spec §4.2, v0.3.14): written at
   * birth only, kept verbatim after; absent where no maker wrote one. See
   * `core/provenance.ts` `atlasProducer`.
   */
  producer?: { tool: string; version: string; input: string };
  /**
   * Where the world first came from, as the server keeps it (spec §4.2,
   * v0.3.16): `{ source, producer }`, each an object or null.
   * Carried as served (a linked world's GET /world, a site download); never
   * derived, never sent. Absent in a folder with no server behind it.
   */
  origin?: Record<string, unknown>;
  /** World cover image URL. Preserved on import/export round-trip (DESIGN_IMPORT.md). */
  image_url?: string;
  /**
   * True only for the bundled sample world. Gestures inside a
   * demo world never earn a guide note. Lives in world.json so the flag
   * survives localStorage wipes + rediscovery; make-online and keeping the
   * tour world at its finale clear it (the world is genuinely yours then). Normal imports never set it — the import
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
    /** View-only world — mirror of the registry flag so root discovery
     *  (registry wiped, folder survives) restores view-only status. */
    read_only?: boolean;
    /**
     * Opened as an agent seat (#104): its writes carry the seat's own
     * secret, never the account PIN. Mirrored so discovery knows the world is
     * a seat. The secret itself is NEVER here (`WorldRegistryEntry.api.seat_secret`):
     * the folder travels, and the store strips it at every write.
     */
    seat?: { role?: string };
  };
  /** Time format config — passes through to OW schema. */
  time_format_names?: string[];
  time_format_equivalents?: Array<string | number>;
  time_basic_unit?: string;
  time_current?: number;
  time_range_min?: number;
  time_range_max?: number;
  /** World units (standard 00.31.00, folder spec v0.3.7): free-text labels, synced as world meta. */
  length_unit?: string;
  mass_unit?: string;
  distance_unit?: string;
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
   * side-effects weren't persisted (2026-07-12). Cleared by
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
   * Elements this world's key no longer sees online, kept here as they are
   * (Titus 2026-10-20; conv. 151): a role change never takes
   * from the copy. Kept elements stop syncing; a later walk that names one
   * gives it back. Cleared by resetSyncBaseline.
   */
  kept_outside_view?: string[];
  /**
   * Ids that left this copy because keel took them out of the key's view (a
   * delete row with reason `hidden`, a resync with reason `view`; keel's
   * one-rule §3). Links to them stay in the copy and never go out in a body,
   * as for kept ids (keel refuses a write naming one and keeps the link).
   * The feed naming one again (an unhide, a raise) takes it out.
   * Cleared by resetSyncBaseline.
   */
  left_view?: string[];
  /**
   * Hidden elements this key cannot put on OnlyWorlds (folder spec §4.8, conv.
   * 170: keel takes the mark on a create from the owner or a co-builder
   * only), with what is anchored on them: never sent, and links to them stay in
   * the copy. Worked out afresh each push round from the key's role, so a raise
   * sends them. Cleared by resetSyncBaseline.
   */
  hidden_held?: string[];
  /**
   * Ids whose whole copy was kept as last known when keel served them as a
   * stub on a walk no `view` reset started (conv. 155, I3). A later view
   * reset never replaces them; the element arriving whole takes it out.
   * Cleared by resetSyncBaseline.
   */
  kept_whole?: string[];
  /**
   * Edits keel took as proposals (conv. 163): a seat's write on a
   * world whose keeper reviews AI seats answers 202 and the element does not
   * change. One entry per element, the newest proposal; the local edit stays
   * on disk, and the version the entry names is never sent again. Settled by
   * keel's queue: accepted takes the server's copy, declined or lapsed goes
   * to the conflict review. Cleared by resetSyncBaseline.
   */
  proposed?: ProposedEdit[];
  /**
   * The key's role (keel `GET /me`) when the folder was last walked whole: a
   * resync under another role is a role change, and keeps (conv. 151).
   */
  walked_as_role?: string;
  /**
   * World-meta sync baseline: a CANONICAL snapshot of the 8
   * synced world.json wire fields as last confirmed with the server
   * (''/[]/null empties — see META_SYNC_FIELDS in sync/world-meta-sync.ts).
   * Absent = meta never synced: the next meta step SEEDS it from GET /world
   * and never PATCHes that round (the absent-baseline blind-push).
   * Refreshed PER-FIELD: only fields a
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
   * resolved via the conflict-review modal's world-settings rows.
   */
  meta_conflicts?: string[];
  /**
   * A profile's `x_` keys on the World at the last agreement:
   * key → canonical JSON (`canonicalExtValue`), absent = the key was absent.
   * Its own map so a world linked before these keys synced seeds them once.
   * Contested keys join `meta_conflicts` by name. Cleared by resetSyncBaseline.
   */
  meta_ext_baseline?: Record<string, string> | null;
  /**
   * Elements whose CREATE keel refused because the id already lives in
   * another OnlyWorlds world (a copied or imported folder, a world taken
   * online twice): the re-key's worklist (`sync/foreign-ids.ts`).
   * Recorded only on evidence (a /bulk `id_conflict`, or a single-create 409
   * whose read-back returned nothing), merged at the end of each round, and
   * scoped to the api world it was observed against. Readers intersect it
   * with "still here, still never synced" at the moment of use.
   */
  foreign?: ForeignIds;
  /**
   * Every finished re-key's map, old id → new id.
   * Kept so a link inside a file that could not be read during the re-key (a
   * git conflict) can still follow once the file is repaired
   * (`repairRekeyedLinks`); without it the map died with the journal.
   */
  rekeyed?: Record<string, string>;
  /**
   * Ids a Route 2 merge created on the server before it finished.
   * Written before the creates go out, cleared when a merge returns. A
   * rerun that meets one of these as a same-id match knows the server copy
   * is the user's own upload, not a duplicate, so "keep the server version"
   * does not revert edits made since.
   */
  route2_created?: string[];
}

export interface ForeignIds {
  api_world_id: string | null;
  ids: Array<{ id: string; type: ElementType; first_seen: string }>;
}

export interface ServerDeleteRecord {
  id: string;
  type: ElementType;
  detected_at: string;
  /** Local name at detection time — for display in the review modal. */
  name?: string;
}

/** A server-delete record as the review shows it (#122): the local copy's
 *  stamp when read, the guard for the bulk delete, and whether it holds
 *  edits never synced. */
export interface ServerDeleteReviewRow extends ServerDeleteRecord {
  local_updated_at: string | null;
  server_updated_at: string | null;
  unsynced: boolean;
}

export interface Conflict {
  element_id: string;
  type: ElementType;
  detected_at: string;
  local_updated_at: string;
  server_updated_at: string;
  /** Fields that diverged between local pre-edit baseline and server. */
  fields: string[];
  /**
   * Set when the conflict is a proposal keel did not take (conv. 163): the
   * keeper declined it (with their reason, when given), or it lapsed or was
   * withdrawn. Overwrite proposes again; Pull drops the edit.
   */
  proposal?: { outcome: 'declined' | 'lapsed' | 'withdrawn'; reason?: string };
}

/** One edit keel holds as a proposal (conv. 163; SyncState.proposed). */
export interface ProposedEdit {
  element_id: string;
  type: ElementType;
  /** keel's proposal id. */
  proposal_id: string;
  /** The local version sent: an edit after it has a newer stamp and is sent again. */
  local_updated_at: string;
  at: string;
}

// ---- Tombstones (per-world .atlas/tombstones.json) ----

export interface Tombstone {
  id: string;
  type: ElementType;
  deleted_at: string;
}

// ---- Sync engine state (observable for UI) ----

/** Why the engine is held (`SyncEngine.hold`): the pill says each in its own sentence. */
export type SyncHoldReason = 'rekey' | 'disk' | 'move' | 'download';

export type SyncEngineState =
  | { kind: 'idle'; last_sync_at: string | null }
  | { kind: 'syncing'; phase: 'pull' | 'push'; progress?: { done: number; total: number } }
  /** `held`: an exclusive local operation (the re-key) owns the world; nothing syncs until it ends. */
  | { kind: 'paused'; reason: 'manual' | 'network' | 'held'; pending_changes: number; held_for?: SyncHoldReason }
  | { kind: 'error'; message: string; recoverable: boolean };

/**
 * Why keel refused a world's key (#198), from its typed error: `key_revoked`
 * (revoked on onlyworlds.com), `key_unknown` (401 `invalid_credentials` with
 * no param: keel no longer knows the key, because the world was deleted or
 * the member removed), `pin` (the same code with param `API-Pin`:
 * a wrong or missing PIN), `read_only_key` (403 `permission_error` on a
 * write). Copy: `src/sync/world-key-lines.ts`.
 */
export type KeyRefusal = 'key_revoked' | 'key_unknown' | 'pin' | 'read_only_key';

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
   * PIN" (2026-07-13 — minted account-mode keys are revocable from
   * the portal independently of the PIN). `read_only_key` is a 403
   * permission_error — the key can never write, so the round bails like any
   * auth failure but the copy must say "read-only key", never "check your
   * PIN" (2026-07-13).
   */
  auth_reason?: KeyRefusal;
  /**
   * The round stopped early because OnlyWorlds was busy (503 server_busy),
   * rate limited (429, e.g. a PIN lockout) or unreachable.
   * Nothing is paused and no baseline moved; the engine retries once after
   * `retry_after_ms`. `transient_reason` picks the words the user sees.
   */
  transient_blocked?: boolean;
  transient_reason?: 'busy' | 'rate_limited' | 'offline';
  retry_after_ms?: number;
  /**
   * World-meta fields (disk names) the meta step PUSHED to / PULLED from
   * `PATCH|GET /world` this round (world-meta sync). Lets the UI
   * surface meta-only rounds honestly — pushed/pulled above count elements
   * only, so without these a meta-only round reads as "nothing synced"
   * (the lying-pill class).
   */
  meta_pushed?: string[];
  meta_pulled?: string[];
  /** The key's role, when the round read keel's `GET /me` (conv. 151). */
  own_role?: string;
  /** The key's membership id from the same `GET /me` (null for the owner); reported with `own_role`, when /me served it. */
  own_membership?: string | null;
  /** Elements a resync found outside this key's view and kept (conv. 151). */
  kept?: number;
  /** Local edits to kept elements: they stay here, unsent (conv. 151). */
  kept_edit_ids?: string[];
  /** Hidden elements held because the key cannot hide (conv. 170): said once per session. */
  hidden_held_ids?: string[];
  /** Hidden elements here whose id OnlyWorlds shows (conv. 170): nothing sent for them, said once. */
  hidden_shown_ids?: string[];
  /** Edits keel took as proposals this round (conv. 163, P2): the keeper decides. */
  proposed_ids?: string[];
  /** Deletes keel kept for the keeper (`proposed_only`): each element is back (conv. 163, P6). */
  delete_refused?: Array<{ id: string; type: ElementType; name?: string }>;
  /** Proposals the round settled (conv. 163, P5): accepted ones took the server's copy. */
  proposals_accepted?: string[];
}

export interface PerElementFailure {
  element_id: string;
  /** `'world'` = a world-meta step failure (element_id 'world'). */
  type: ElementType | 'world';
  operation: 'create' | 'update' | 'delete' | 'read';
  message: string;
  /**
   * The thrown error's `name` when it carried one: `InvalidStateError`
   * from a file another program holds reads the same in every locale, where
   * its message does not. What the toast classifies on.
   */
  error_name?: string;
  /**
   * A server refusal's HTTP status, error code and named field. The
   * details block prints these instead of `message`, which is server or
   * browser text and can quote a name.
   */
  status?: number;
  code?: string;
  param?: string;
  source?: 'server' | 'disk';
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
    /**
     * View-only world: linked with a READ key, no PIN anywhere. The
     * engine never pushes (pull-only), and UI writes are blocked at the store
     * seam. Mirrored in `WorldMeta.api.read_only` so discovery restores it.
     */
    read_only?: boolean;
    /**
     * The key's role as last told to the person (keel `GET /me`: owner,
     * co_builder, contributor, guest; conv. 151). A change from a
     * known role is said once; first sight is recorded silently.
     */
    member_role?: string;
    /**
     * This key's own membership id, as keel `GET /me` last answered it (what
     * `created_by` holds for what this key creates); null for the owner.
     * Kept and cleared beside `member_role`; absent until the first round reads it.
     */
    membership?: string | null;
    /** An agent seat (#104); mirrored in `WorldMeta.api.seat`. Read through `worldPin`. */
    seat?: { role?: string };
    /**
     * The seat's own `ow_s_` secret: this world's PIN, in this browser only
     * (never in world.json). Absent on a seat world means this browser lost
     * it, and the world is opened again from onlyworlds.com.
     */
    seat_secret?: string;
    /**
     * The id and key-tail of the key Atlas minted from the account token for
     * this world (#814). Registry only, never world.json: a folder's key is
     * shared by every copy of the folder, so only a browser world's key is
     * ever taken back, and then only while `api_key` still ends with `tail`
     * (`mintedKeyId`). A pasted key clears it; a swap writes it fresh.
     */
    key_mint?: { id: string; tail: string };
  };
  /**
   * Server world id this entry was PREVIOUSLY linked to (set by unlink /
   * detachApi). Lets the account-mode remote list suppress worlds that are
   * already here as local-only folders — without it, an unlinked world
   * reappears "On OnlyWorlds" and re-opening it would duplicate the folder.
   */
  former_api_world_id?: string;
  /**
   * Every world is a folder of files: on the user's drive, or in this
   * browser's storage (`where`, 1.17). For a browser world `folder_name` is
   * its directory under `browser-worlds/` and `handle_key` stays its identity
   * (`world-<id>`) though no vault entry is kept for it.
   */
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
  /**
   * The charts room's last active calendar LENS for this world (2B): the id of
   * a calendar Construct, or null/absent = bare numbers. Device-local room
   * state (like camera persist) — saved charts carry their own calendarId in
   * ChartConfig; there is deliberately NO "world default calendar" concept.
   * A dangling id degrades to bare numbers at resolution, never an error.
   */
  active_calendar_id?: string | null;
  /**
   * Home onboarding this world has dismissed: since 1.19 (#127) only
   * `next-steps` (the next-steps list's ×) is read; older ids from the earlier
   * cards (`create-event`, `cta-object`) linger harmlessly. Absent = nothing
   * dismissed.
   */
  tour_dismissed?: string[];
  /** Mirror of `WorldMeta.demo` — the bundled sample world. Gestures in a demo world never earn a guide note. */
  demo?: boolean;
  /**
   * A view-only copy (conv. 177): mirror of world.json's `writable: false`
   * with its `snapshot_of` and `snapshot_at` (`core/world-copy.ts`). Present
   * = view-only here and never online; the activation heals it from the file.
   */
  copy_of?: { world_id?: string; at?: string };
  /**
   * Where the world lives (1.17): `'browser'` = in this browser's storage,
   * under `browser-worlds/`; absent = a folder (vault handle). Top level, not
   * inside `folder`, so the two-tab registry merge carries it as one field.
   * Read through `isBrowserWorld` (`core/browser-worlds.ts`).
   */
  where?: 'browser';
  /**
   * When Atlas found a browser world's storage gone (the browser cleared it).
   * The entry is kept, with its `api` block, until the user removes it
   * (DESIGN_LAWS conv. 129).
   */
  cleared_at?: string;
  /**
   * A move to a folder that has started and not committed (1.17, contract
   * §4.2 step 2): saved BEFORE the destination folder exists, so a crash
   * leaves a record of which folder on the drive was this move's. Recovery
   * removes that folder only when its `.atlas/move-incoming.json` carries
   * this `move_id`; the browser copy stays the world.
   */
  move?: { move_id: string; to_folder_name: string; started_at: string };
  /**
   * After a move's commit, the browser directory the world left, until it is
   * removed (contract §4.2 step 7, §4.3). Boot and activation finish it.
   */
  moved_from?: string;
  /**
   * When this browser last handed the whole world over as one file (1.17,
   * contract §5.1, §6.1). The keep-safe card reads it; Atlas cannot know the
   * file was kept, only that the download was handed to the browser.
   */
  kept_download_at?: string;
  /** When this world was last exported as JSON from the Data room (the keep-safe card's reduced form). */
  kept_export_at?: string;
  /** The keep-safe card's × hides it until then (a week). */
  keep_nudge_snoozed_until?: string;
  /**
   * A linked world restored from a world file (1.17, contract §5.2): its first
   * sync round runs as pause-and-review whatever the policy, so the file's
   * older edits never overwrite newer ones on OnlyWorlds (Skeld's
   * third condition, 2026-10-04). Cleared once a round has run.
   */
  review_first_sync?: boolean;
  /**
   * What keel's roster last said (Titus's (a), 2026-10-20):
   * someone besides the owner can write here (an active person or agent; a
   * player's link does not count). Unset until a roster read answers. A
   * shared world syncs as pause-and-review and pulls when it opens
   * (`src/sync/shared-world.ts`).
   */
  shared_with_others?: boolean;
  /** The person turned the shared rule off for this world in Settings: it follows the default policy. */
  shared_keep_policy?: boolean;
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
   * @deprecated Dropped when the context tab became permanent +
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
   * Context pane: the lens the Web reads through (#841), a lens element's id.
   * Kept on this computer, never written to the world. Absent, or an id that
   * is no longer a readable lens in the world, reads as none.
   */
  context_lens?: string;
  /** When the big-world note on lenses was shown in this world (#841's P5). */
  lens_note_at?: string;
  /**
   * Where the guide's path stands in this world (#964): the step its card
   * speaks for, or `done` after the last Next. Kept in this browser, never
   * synced; written only by a press (Start from nothing, Next) or a world
   * made from a Start-page link, and only ever forward.
   */
  guide_step?: 'someone' | 'placed' | 'happened' | 'story' | 'copy' | 'done';
  /** The path's rooms seen once their step was lit (#964): `happened` (the chart), `story` (the writing room). */
  guide_visited?: string[];
  /**
   * Per-world freeform notes — atlas-local (never synced). Accessed via the
   * notes overlay (src/ui/notes-overlay.ts). Lives in the registry so it
   * survives reloads without depending on the world's folder being granted
   * permission. Titus mentioned wanting "a random notes modal/page that is
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
  /** A member's role on a shared row (keel D72); absent on an owned one. */
  member_role?: 'co_builder' | 'contributor' | 'guest';
  public_read: boolean;
  keys: Array<{ last4: string; scope: 'READ' | 'WRITE'; revoked: boolean }>;
}

export interface WorldsRegistry {
  version: number;
  worlds: WorldRegistryEntry[];
  /** Global PIN for OW api access. */
  pin?: string;
  /** Global email for OW account: prefills the sign-in in Make online and New world on OnlyWorlds. */
  email?: string;
  /**
   * OnlyWorlds account token (`ow_a_...`), pasted from the portal Tokens UI.
   * Grants account-scoped reads (world list) and key minting — sync itself
   * still runs on per-world keys in world.json. Same trust posture as `pin`:
   * a bearer credential on the user's own machine.
   */
  account_token?: string;
  /**
   * keel's id for `account_token`, kept only when Atlas minted the token (Sign
   * in with OnlyWorlds, or the email and password): Atlas revokes it by this id
   * when it lets the token go. A pasted token has none and is never
   * revoked. Always written together with `account_token` (`setAccountToken`).
   */
  account_token_id?: string;
  /**
   * The last eight characters of the token `account_token_id` was recorded
   * with: an id counts only beside that token (`mintedTokenId`). A tab still
   * on 1.92 wrote a new token and kept the old id.
   */
  account_token_id_tail?: string;
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

  /** The Worlds list's row of add-world icons. Default: shown; false leaves the labelled "add a world" button alone. */
  worlds_add_icons?: boolean;

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
   * names" into per-context preferences.
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
     * icon-thumbnail flip this same setting in place.
     */
    show_element_images?: boolean;
    /**
     * Element pages show only the fields that hold something (#24: a new
     * character was ~25 dash rows). An element with nothing filled keeps its
     * first section whole. Default off; the line under the fields flips it.
     */
    hide_empty_fields?: boolean;
    /**
     * Names on the elements sidebar's type strip (#24, Titus 2026-10-11: "default to
     * current, but allow b and c too"). 'icons' (A, the default): icons only, names on hover.
     * 'all' (B): every type named, two columns. 'held' (C): the types the world holds named with
     * their counts, the rest icons below.
     */
    type_strip_names?: TypeStripNames;
  };
}

export type TypeStripNames = 'icons' | 'all' | 'held';

export function defaultRegistry(): WorldsRegistry {
  return { version: 1, worlds: [] };
}
