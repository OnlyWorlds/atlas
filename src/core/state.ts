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

export type MiddleMode = 'welcome' | 'settings' | 'element' | 'timeline';
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
}

export interface AppState {
  registry: WorldsRegistry;
  atlasRoot: AtlasRootRef | null;
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
