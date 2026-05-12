/**
 * Atlas constants — storage keys, small invariants, SDK re-exports.
 */

import { ELEMENT_ICONS as SDK_ELEMENT_ICONS } from '@onlyworlds/sdk';
import type { ElementType } from './types';

/** Material Symbol name per element type (re-exported from SDK with strict typing). */
export const ELEMENT_ICONS = SDK_ELEMENT_ICONS as Record<ElementType, string>;


// localStorage keys
export const REGISTRY_STORAGE_KEY = 'atlas_worlds_registry';
export const UI_PREFS_STORAGE_KEY = 'atlas_ui_prefs';
export const SHELL_RATIOS_STORAGE_KEY = 'atlas_shell_ratios_v2';

// IDB schema (handle-vault only — no world data in IDB)
export const HANDLE_VAULT_DB = 'atlas-handles';
export const HANDLE_VAULT_STORE = 'handles';

// Folder layout
export const ATLAS_INTERNAL_DIR = '.atlas';
export const SYNC_STATE_FILE = 'sync-state.json';
export const TOMBSTONES_FILE = 'tombstones.json';
export const LOCK_FILE = 'lock';
export const WORLD_META_FILE = 'world.json';
