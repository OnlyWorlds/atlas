/**
 * Minimal observable state store.
 *
 * Reads via `getState()`, writes via `patchSlice(key, partial)`. Subscribers
 * registered with `select()` re-fire only when the SELECTED value changes
 * (strict equality on the slice). This is the same idiom the legacy used —
 * its critical edge case is that patching a slice with the same content but
 * a new reference does NOT fire selectors that read a sub-property unchanged.
 *
 * Force-rerender pattern (documented in DESIGN convention #2): to nudge a
 * subscriber that depends on a stable object, patch with a fresh reference
 * for the value they're watching. For elements specifically: replace
 * `data.elements` with a new array reference after every mutation.
 */

import type { WorldsRegistry, WorldMeta, Element, ElementType, SyncEngineState, RightTabRef } from './types';
import { defaultRegistry } from './types';

// Re-export so existing imports (`import { RightTabRef } from '../core/state'`)
// continue to work after the type moved to types.ts to avoid a registry
// dependency cycle.
export type { RightTabRef };

/**
 * Middle pane mode = "room". See DESIGN.md "Rooms" section.
 * - welcome: pre-world first-launch CTA
 * - home: world home base (default for active worlds)
 * - element: schema-driven element detail
 * - writing: book/chapter/scene authorship (see DESIGN_WRITING.md)
 * - timeline: full timeline view
 * - search: cross-world search
 * - publish / publish-detail: showcase management (see DESIGN_PUBLISHING.md)
 * - import: data import (stub — mechanics in base-tool)
 * - templates: element creation templates (atlas-local)
 * - settings: settings room
 */
export type MiddleMode =
  | 'welcome'
  | 'home'
  | 'settings'
  | 'element'
  | 'timeline'
  | 'writing'
  | 'search'
  | 'publish'
  | 'publish-detail'
  | 'import'
  | 'templates';
export type SidebarMode = 'worlds' | 'elements';

export interface ActiveWorldRef {
  /** Registry entry id (NOT the OW api world id). */
  worldId: string;
  /** Snapshot of `world.json`. Refreshed on edits. */
  meta: WorldMeta;
  /** True if the folder is open read/write. False = registry-known but not yet granted. */
  opened: boolean;
}

/**
 * Runtime info about the configured atlas root.
 * Presence implies a usable root has been picked AND its handle is in the vault.
 * The handle itself lives in the vault; we don't keep it in state to avoid
 * stale references after permission revocation.
 */
export interface AtlasRootRef {
  folderName: string;
  pathHint?: string;
}

/**
 * Orphan-handle signal: the vault has an atlas-root handle but localStorage
 * doesn't (e.g. user cleared site data but the folder + IDB survived). UI
 * surfaces a one-click "recover" CTA that re-grants permission and restores
 * the registry from on-disk world.json files.
 */
export interface AtlasRootRecoverableRef {
  folderName: string;
}

/**
 * In-memory cache of the active world's elements. Refreshed from the
 * FolderStore on world activation and after every mutation. Always patched
 * with a new array reference so subscribers re-fire.
 */
export interface DataState {
  elements: Element[];
}

/**
 * SyncEngine state surfaced to the UI. One entry per api-linked world that has
 * been activated this session. `activeSync` is a convenience pointer to the
 * currently-active world's engine state.
 *
 * Updates flow: SyncEngine.onStateChange → `attachSyncEngine` → patchSlice('sync', ...).
 */
export interface SyncSummaryState {
  byWorld: Record<string, SyncEngineState>;
  activeSync: SyncEngineState | null;
  /** Pending conflicts count for the active world, surfaced as a badge. */
  activeConflictsCount: number;
}

export interface UiState {
  sidebarMode: SidebarMode;
  selectedElementId: string | null;
  /** Filter chips: empty = no filter (show all), populated = restrict to these. */
  elementFilters: Set<ElementType>;
  search: string;
  /** Right-pane tabs (always begins with implicit map-index; additional are maps). */
  rightTabs: RightTabRef[];
  rightActiveIndex: number;
  /** When set, next click on the active map drops a pin for this element. */
  pinPlacement: { elementId: string } | null;
  /**
   * When set, a zone is in edit mode on this map. Vertex dots become
   * draggable handles; segment hover overlays accept clicks for inserting
   * markers. ESC restores the snapshot taken on entry; Enter/Done commits
   * (no-op since autosave). See zone-edit-mode.ts.
   */
  zoneEditing: { zoneId: string; mapId: string } | null;
  /**
   * Transient flag: when in the writing room, the sidebar defaults to the
   * writing tree body instead of worlds/elements. Clicking Worlds or the
   * world-name toggle while in writing flips this to true so the sidebar
   * honors the explicit choice until the user leaves and re-enters writing
   * (which resets it). Never persisted — purely in-session.
   */
  sidebarWritingOverride: boolean;
}

export interface AppState {
  registry: WorldsRegistry;
  atlasRoot: AtlasRootRef | null;
  atlasRootRecoverable: AtlasRootRecoverableRef | null;
  active: ActiveWorldRef | null;
  middleMode: MiddleMode;
  data: DataState;
  ui: UiState;
  sync: SyncSummaryState;
  /** Toast surface state — currently unused; reserved for next bouts. */
  busy: boolean;
}

const listeners = new Set<() => void>();
let state: AppState = {
  registry: defaultRegistry(),
  atlasRoot: null,
  atlasRootRecoverable: null,
  active: null,
  middleMode: 'welcome',
  data: { elements: [] },
  ui: {
    sidebarMode: 'worlds',
    selectedElementId: null,
    elementFilters: new Set(),
    search: '',
    rightTabs: [{ kind: 'map-index' }],
    rightActiveIndex: 0,
    pinPlacement: null,
    zoneEditing: null,
    sidebarWritingOverride: false,
  },
  sync: {
    byWorld: {},
    activeSync: null,
    activeConflictsCount: 0,
  },
  busy: false,
};

export function getState(): AppState {
  return state;
}

export function setState(next: AppState): void {
  state = next;
  notify();
}

/**
 * Patch one top-level slice. Always allocates a new top-level state object
 * so identity comparisons in selectors work.
 */
export function patchSlice<K extends keyof AppState>(key: K, value: AppState[K]): void {
  state = { ...state, [key]: value };
  notify();
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.error('[state] listener error:', err); }
  }
}
