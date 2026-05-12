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
 * for the value they're watching.
 */

import type { WorldsRegistry, WorldMeta } from './types';
import { defaultRegistry } from './types';

export type MiddleMode = 'welcome' | 'settings';

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

export interface AppState {
  registry: WorldsRegistry;
  atlasRoot: AtlasRootRef | null;
  active: ActiveWorldRef | null;
  middleMode: MiddleMode;
  /** Toast surface state — currently unused; reserved for next bouts. */
  busy: boolean;
}

const listeners = new Set<() => void>();
let state: AppState = {
  registry: defaultRegistry(),
  atlasRoot: null,
  active: null,
  middleMode: 'welcome',
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
