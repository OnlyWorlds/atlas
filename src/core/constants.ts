/**
 * Atlas constants — storage keys, small invariants, SDK re-exports.
 */

import { ELEMENT_ICONS as SDK_ELEMENT_ICONS } from '@onlyworlds/sdk';
import type { ElementType } from './types';

/** Material Symbol name per element type (re-exported from SDK with strict typing). */
export const ELEMENT_ICONS = SDK_ELEMENT_ICONS as Record<ElementType, string>;

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
export const LOCK_FILE = 'lock';
export const WORLD_META_FILE = 'world.json';
export const ELEMENTS_DIR = 'elements';
export const SPATIAL_DIR = 'spatial';
export const MEDIA_DIR = 'media';

// Spatial element types live under SPATIAL_DIR/<type>/, content under ELEMENTS_DIR/<type>/.
export const SPATIAL_TYPES = new Set(['map', 'pin', 'zone', 'marker']);

// Lock file lifecycle
export const LOCK_HEARTBEAT_MS = 30_000;
export const LOCK_STALE_MS = 90_000;

/**
 * Atlas-extension fields that live ONLY on local element files and are never
 * sent to/from the OW server. Two consequences:
 *
 *   1. Adapter strips them from write bodies (server 422s on unknown fields).
 *   2. `applyServerRecord` MUST preserve them from the existing local file
 *      when overlaying a server response — otherwise pulling an update on
 *      e.g. a Map silently destroys its local `image_media_id` binding,
 *      orphaning the media file under `media/`.
 *
 * Add new atlas-only fields here; both ends pick them up automatically.
 */
export const ATLAS_LOCAL_EXTENSION_FIELDS = [
  'image_media_id',
  // Zone visual extensions (DESIGN_ZONES.md §5) — stored on the Zone element
  // file, never pushed to the OW API. atlas_color is a hex string; atlas_opacity
  // is 0..1; atlas_label_visible is boolean.
  'atlas_color',
  'atlas_opacity',
  'atlas_label_visible',
  // Zone shape kind (ZD6) — 'polygon' | 'line'. Local-only; the OW server's
  // Zone schema doesn't include it and rejects writes that carry it with a 400.
  // Without this strip, every zone CREATE fails server-side, which cascades to
  // FK failures on marker CREATEs that reference the (now-orphan) zone.
  // (Bug surfaced session 221 against live OW; fakes silently accepted the
  // unknown field so it slipped past the existing test coverage.)
  'atlas_shape',
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
] as const;
export type AtlasLocalExtensionField = typeof ATLAS_LOCAL_EXTENSION_FIELDS[number];

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
