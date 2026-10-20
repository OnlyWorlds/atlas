/**
 * Atlas constants — storage keys, small invariants, SDK re-exports.
 */

import { ELEMENT_ICONS as SDK_ELEMENT_ICONS } from '@onlyworlds/sdk';
import type { ElementType } from './types';
import { ELEMENT_FAMILIES, elementColor } from './element-colors';

/**
 * Material Symbol name per element type (re-exported from SDK with strict typing).
 * SDK 4.7.3 (dist.19) gives Marker `polyline` and Zone `pentagon`, so the local
 * Marker override is gone (S390).
 */
export const ELEMENT_ICONS = SDK_ELEMENT_ICONS as Record<ElementType, string>;

/**
 * Element-type color palette — used by the context-pane graph for optional
 * edge tinting (per the non-center node's type). Reused from the
 * dcc-viewer / element-viewer-trial palettes; tuned for the dark cyan-leaning
 * atlas background. Picks tend toward higher saturation so the colors stay
 * legible at low alpha when used for edges.
 *
 * Spatial types (map / pin / marker / zone) get a neutral fallback — they
 * don't appear as graph nodes in the context pane anyway.
 */
/**
 * S308: the 22 hand-picked hues are GONE. This is now derived from the single
 * family palette in `core/element-colors.ts` — see that file for the measured
 * reason (the old set failed CVD separation: Title vs Trait were ΔE 1.3 apart
 * for deutan viewers, Object and Construct read as grey).
 *
 * Kept as a named export so existing call sites keep working; new code should
 * call `elementColor(type)` directly.
 */
export const ELEMENT_TYPE_COLORS: Record<ElementType, string> = Object.fromEntries(
  (Object.keys(ELEMENT_FAMILIES) as ElementType[]).map(t => [t, elementColor(t)]),
) as Record<ElementType, string>;

/** Friendly singular/plural per element type. */
export const ELEMENT_LABELS: Record<ElementType, { singular: string; plural: string }> = {
  character: { singular: 'character', plural: 'characters' },
  creature: { singular: 'creature', plural: 'creatures' },
  species: { singular: 'species', plural: 'species' },
  family: { singular: 'family', plural: 'families' },
  collective: { singular: 'collective', plural: 'collectives' },
  institution: { singular: 'institution', plural: 'institutions' },
  location: { singular: 'location', plural: 'locations' },
  object: { singular: 'object', plural: 'objects' },
  construct: { singular: 'construct', plural: 'constructs' },
  ability: { singular: 'ability', plural: 'abilities' },
  trait: { singular: 'trait', plural: 'traits' },
  title: { singular: 'title', plural: 'titles' },
  language: { singular: 'language', plural: 'languages' },
  law: { singular: 'law', plural: 'laws' },
  event: { singular: 'event', plural: 'events' },
  narrative: { singular: 'narrative', plural: 'narratives' },
  phenomenon: { singular: 'phenomenon', plural: 'phenomena' },
  relation: { singular: 'relation', plural: 'relations' },
  map: { singular: 'map', plural: 'maps' },
  pin: { singular: 'pin', plural: 'pins' },
  marker: { singular: 'marker', plural: 'markers' },
  zone: { singular: 'zone', plural: 'zones' },
};


// localStorage keys
export const REGISTRY_STORAGE_KEY = 'atlas_worlds_registry';
export const UI_PREFS_STORAGE_KEY = 'atlas_ui_prefs';
export const SHELL_RATIOS_STORAGE_KEY = 'atlas_shell_ratios_v2';
/** Right-pane open tabs (rightTabs + rightActiveIndex). Persists across reloads. */
export const RIGHT_TABS_STORAGE_KEY = 'atlas_right_tabs';
/** Per-world unsaved knowledge draft (`/knowledge/new`). Key = prefix + worldId. */
export const KNOWLEDGE_DRAFT_STASH_PREFIX = 'atlas_knowledge_draft_';

// IDB schema (handle-vault only — no world data in IDB)
export const HANDLE_VAULT_DB = 'atlas-handles';
export const HANDLE_VAULT_STORE = 'handles';

/** Fixed handle-vault key for the atlas root folder (one per browser profile). */
export const ATLAS_ROOT_HANDLE_KEY = '__atlas_root__';
/** Marker file written inside an atlas root folder for future "import existing atlas folder" detection. */
export const ATLAS_ROOT_MARKER = '.atlas-root';
/**
 * Subfolder atlas creates inside a user-picked folder, unless the picked folder
 * is already an atlas root (has `.atlas-root`) or already contains one.
 * Named with brand prefix so it self-identifies in file browsers.
 */
export const ATLAS_ROOT_SUBFOLDER = 'onlyworlds-atlas';

/**
 * Previously-used names for the wrapper subfolder. Re-use detection looks here
 * too so existing setups don't get double-wrapped after a name change.
 * Add new names at index 0; keep old ones forever.
 */
export const ATLAS_ROOT_SUBFOLDER_LEGACY_NAMES = ['atlas-worlds'] as const;

// Folder layout
export const ATLAS_INTERNAL_DIR = '.atlas';
export const SYNC_STATE_FILE = 'sync-state.json';
export const TOMBSTONES_FILE = 'tombstones.json';
/** Saved chart configs — atlas-local, travels with the folder (DESIGN_CHARTS.md). */
export const CHARTS_FILE = 'charts.json';
/** `.atlas/rekey-journal.json`: present only while a re-key is unfinished (`store/rekey.ts`, S363). */
export const REKEY_JOURNAL_FILE = 'rekey-journal.json';
/** World styles — how the world draws its kinds (core/world-styles.ts, S356). */
export const STYLES_FILE = 'styles.json';
/** What the world's user wrote about it that is not an element: notes, cast, calendar lens, writing labels (core/world-prefs.ts, S364). */
export const WORLD_PREFS_FILE = 'world-prefs.json';
export const LOCK_FILE = 'lock';
export const WORLD_META_FILE = 'world.json';
/**
 * The Folder Format spec version a folder atlas CREATES is written against
 * (`world.json.format_version`; spec §4.2, minted v0.3.3, moves whenever the
 * spec's version moves). Stamped ONCE, at a folder's birth, by the store's
 * meta writer; never added to a folder atlas merely opened or edited (a
 * reader must not rewrite keys as a side effect, and an edit is not a
 * capture). Absence means pre-0.3.3 or unknown, which every reader tolerates.
 */
export const FOLDER_FORMAT_VERSION = '0.3.12';
export const ELEMENTS_DIR = 'elements' as const;
export const SPATIAL_DIR = 'spatial' as const;
export const MEDIA_DIR = 'media';

/**
 * The two top-level homes an element file can have.
 *
 * THE LAYOUT RULE (Folder Format spec v0.3, 2026-07-28): `elements/<type>/`
 * is the format for ALL 22 types. `spatial/<type>/` is a NAMED, DATED LEGACY
 * path — atlas through v1.0 wrote maps, pins, zones and markers there, and
 * no other implementation ever did.
 *
 * Atlas therefore READS BOTH (the union read) and WRITES whichever layout the
 * world already uses, defaulting to `elements/` for anything new. Before the
 * union read, a world written by any other tool lost all four spatial types
 * SILENTLY and looked complete — the failure shape the format exists to
 * prevent.
 */
export type LayoutDir = typeof ELEMENTS_DIR | typeof SPATIAL_DIR;

/** Types that a legacy-layout folder keeps under SPATIAL_DIR/<type>/. */
export const SPATIAL_TYPES = new Set(['map', 'pin', 'zone', 'marker']);

// Lock file lifecycle
export const LOCK_HEARTBEAT_MS = 30_000;
export const LOCK_STALE_MS = 90_000;

/**
 * The public OnlyWorlds demo keys, `0000000000`-`0000000009`.
 *
 * A protocol fact, not an atlas policy: keel resolves this range to READ
 * scope, so nothing can write with one of these keys on any route (a write
 * attempt earns a 403). They also skip PIN enforcement on reads, which is
 * why linking one must take the view-only branch — it has no PIN to give.
 *
 * Legacy non-demo keys are also 10 digits, so the range check is exact
 * rather than length-based.
 */
export function isDemoKey(apiKey: string): boolean {
  return /^000000000[0-9]$/.test(apiKey.trim());
}

/**
 * Atlas-extension field policy (split 2026-07-12, v2 port gate 10.3).
 *
 * Two buckets with DIFFERENT wire + pull semantics:
 *
 *   - `ATLAS_LOCAL_ONLY_FIELDS` — live only on local element files. Stripped
 *     from every write body AND preserved from the existing local file when
 *     `applyServerRecord` overlays a server response (otherwise pulling an
 *     update on e.g. a Map silently destroys its local `image_media_id`
 *     binding, orphaning the media file under `media/`).
 *
 *   - `ATLAS_WIRE_EXTENSION_FIELDS` — ride the v2 wire via keel's extension
 *     passthrough (`atlas_*`/`x_*`/`shadow_*` round-trip verbatim). Sent on
 *     write; on pull the SERVER value lands like any normal field — preserved
 *     from local only when the server record doesn't carry the field at all
 *     (element last written by a v1-era or non-atlas client). Without this
 *     split, multi-device sync of zone visuals was a silent one-way no-op:
 *     the preserve-loop would clobber every pulled change with the stale
 *     local value.
 *
 * The v1 dialect rejects ALL extension fields (Skeld 2026-07-12), so wire
 * extensions are v2-only. The sync path is v2 only (`OwV2ClientAdapter`);
 * the v1 adapter this line once described is gone.
 *
 * Add new atlas-only fields to LOCAL_ONLY; new synced extensions to WIRE.
 */
export const ATLAS_WIRE_EXTENSION_FIELDS = [
  // Zone visual extensions (DESIGN_ZONES.md §5): atlas_color is a hex string;
  // atlas_opacity is 0..1; atlas_label_visible is boolean; atlas_shape (ZD6)
  // is 'polygon' | 'line'. Synced under v2 so multi-device zone styling
  // converges. (Pre-v2 these were local-only — the old server 400'd on them,
  // which session 221 learned the hard way.)
  'atlas_color',
  'atlas_opacity',
  'atlas_label_visible',
  'atlas_shape',
  // A map's style (S423, `core/map-ink.ts`): 'ink' draws its zones from their
  // kinds. Synced, so a collaborator opens the map in the same register.
  'atlas_map_style',
  // Calendar config (2B, design 2026-07-14): the machine structure of a
  // calendar Construct (supertype 'calendar' by convention; DETECTION keys on
  // this field's presence, never the supertype). A nested JSON object — the
  // first non-scalar wire extension; keel passthrough round-trips it (probe
  // owed before the sync-touching bout). WIRE (not LOCAL_ONLY) is load-bearing:
  // calendars must travel between devices through the element pipeline, and
  // WIRE membership also hides it from the custom-fields editor
  // (isCustomEditableField excludes the combined list) — builder-only editing.
  'atlas_calendar',
] as const;

/**
 * Who wrote an element, as keel records it: `created_by` (keel membership
 * phase 2, 2026-09-28), `changed_by` and `changed_via` (keel #299, SDK 4.26:
 * the membership and the door of the LAST write). Server-authored and
 * read-only: kept on disk as received, never sent (keel ignores them in a
 * write body, `elements/serialize.py` IGNORED_READONLY_FIELDS; atlas does not
 * rely on that), never a difference anyone made, and meaningless in another
 * world, so an import drops them. One list for every site that must agree.
 */
export const SERVER_AUTHOR_FIELDS = ['created_by', 'changed_by', 'changed_via'] as const;

export const ATLAS_LOCAL_ONLY_FIELDS = [
  'image_media_id',
  // Writing workspace richtext payload (DESIGN_WRITING.md §Storage model, convention #47).
  // TipTap JSON document for Narrative elements. The canonical `story` field
  // holds markdown serialization for OW-tool interop; this field holds the
  // high-fidelity richtext for atlas-only features. Stripped on API push.
  'atlas_richtext_json',
  // Name aliases for any element (DESIGN_WRITING.md §Linking, convention #49).
  // string[] of alternate names that the @ picker and first-mention auto-link
  // match against in addition to the canonical `name` field. Atlas-local;
  // stripped on API push. Council-motion candidate (DESIGN.md tracking section).
  'atlas_aliases',
  // Per-narrative suggestion dismissals for the writing-context pane. Writer
  // ×-dismisses a suggested element in the Suggested list → its id is added
  // to this array on the narrative. Surfaces NOT to suggest again for this
  // narrative. Atlas-local; never pushed.
  'atlas_dismissed_suggestions',
  // Sharing page composition (DESIGN_SHARING.md, core/sharing.ts). Stored on
  // Narrative elements with subtype 'page'. The blocks array is the page's
  // source of truth; `atlas_page_refs` is the flat element-id mirror that
  // keeps element-card bindings safe when ids change (the re-key kernel's
  // rekeyBody handles flat arrays and walks the blocks too; blocksOf() heals
  // nested ids from the mirror). Intent is the
  // sharing axis (show/reference/publish); theme is reserved for the S3
  // token work. The canonical `story` field carries a derived plain-markdown
  // compilation (synced); these four never reach the OW API.
  'atlas_page_blocks',
  'atlas_page_refs',
  'atlas_page_intent',
  'atlas_page_theme',
  // Published-state mirror (S4, SHARING_CONTRACT v0.2): `{ id, slug,
  // published_at, updated_at, revoked }` from the sharing backend, written
  // after each publish/republish/revoke so the share room can display state
  // offline. The sharing API rows are the truth; this is a display cache.
  // Never reaches the OW worldapi.
  'atlas_page_pub',
] as const;

/**
 * Combined list — the v1-dialect strip set (v1 rejects every extension field)
 * and the historical name most call sites grew up with. Prefer the split
 * constants above for new code; this stays the correct set for "fields the
 * OLD server never accepts" (v1 adapter, import/export compatibility checks).
 */
export const ATLAS_LOCAL_EXTENSION_FIELDS = [
  ...ATLAS_LOCAL_ONLY_FIELDS,
  ...ATLAS_WIRE_EXTENSION_FIELDS,
] as const;
export type AtlasLocalExtensionField = typeof ATLAS_LOCAL_EXTENSION_FIELDS[number];

/**
 * The extension NAMESPACES keel v2 round-trips verbatim (Skeld T2, probed
 * live 2026-07-12): any field whose name starts with one of these prefixes is
 * legal wire data — including user-defined custom fields (D9's enablement
 * layer). Import keeps them, the validator doesn't flag them, export carries
 * them, and the v2 adapter sends them (minus ATLAS_LOCAL_ONLY_FIELDS, which
 * stay atlas-internal machinery).
 */
export const EXTENSION_FIELD_NAMESPACES = ['atlas_', 'x_', 'shadow_'] as const;

/** True when a field name lives in one of the extension namespaces. */
export function isExtensionField(name: string): boolean {
  return EXTENSION_FIELD_NAMESPACES.some(ns => name.startsWith(ns));
}

/**
 * Published extension profiles' keys (schema-dist `profiles/`): a meaning other
 * tools read the same way, so a person never names, edits or deletes one as a
 * custom field. `x_identity_key` says two elements are one being (the
 * cross-world identity profile, Skeld h58 #8890): a typed "Identity key" would
 * merge two beings, and a deleted one would split one (Kael #8886). Shown
 * read-only, and never rewritten by a re-key (the profile's rule 9).
 */
export const PROFILE_FIELD_PREFIXES = ['x_identity_'] as const;

export function isProfileField(name: string): boolean {
  return PROFILE_FIELD_PREFIXES.some(p => name.startsWith(p));
}

/**
 * A user-editable custom field: extension-namespaced but NOT atlas machinery
 * (page blocks, richtext, aliases, zone visuals, ...) and not a published
 * profile's key. The D9 custom-fields section in element detail renders
 * exactly these; a `null` value is the field's delete tombstone (keel keeps
 * null-valued extension keys — probed 2026-07-12) and hides the row.
 */
export function isCustomEditableField(name: string): boolean {
  return isExtensionField(name)
    && !(ATLAS_LOCAL_EXTENSION_FIELDS as readonly string[]).includes(name)
    && !isProfileField(name);
}

/**
 * Does a custom-field value carry real content? `''` is a live-but-empty
 * field (created, not yet filled — still renders a row); `null` is deleted.
 * Used by suggestion derivation and delete-confirm gating, where only
 * content matters.
 */
export function isPopulatedCustomValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'number' || typeof value === 'boolean';
}

// Map visual prefs storage keys (DESIGN_MAPS.md §11).
export const MAP_VIEW_PREFS_DEFAULTS_KEY = 'atlas_map_view_defaults';
export const MAP_VIEW_PREFS_BY_MAP_KEY = 'atlas_map_view_prefs';

/**
 * Per-map camera state (zoom + pan center). Saved as the user pans/zooms so
 * a reload or tab-switch lands back where they left off. Falls back to
 * fitToCanvas when no entry exists for the map.
 *
 * Schema: `Record<mapId, { center: [lat, lng], zoom: number }>`.
 */
export const MAP_CAMERA_STATE_KEY = 'atlas_map_camera_state';
