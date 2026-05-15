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
export const ATLAS_LOCAL_EXTENSION_FIELDS = ['image_media_id'] as const;
export type AtlasLocalExtensionField = typeof ATLAS_LOCAL_EXTENSION_FIELDS[number];
