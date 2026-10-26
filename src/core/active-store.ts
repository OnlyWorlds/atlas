/**
 * Active-FolderStore accessor.
 *
 * Previously lived in `ui/create-world-modal.ts` for historical reasons (that
 * was the first module that needed it). Moved to `core/` so consumers can
 * import it without pulling a modal class transitively.
 *
 * Lifecycle: set when a world is activated (`worlds-sidebar.activateWorld`,
 * `atlas-root-flow.createWorldInRoot`, `link-world-modal`), cleared when no
 * world is active.
 */

import type { FsFolderStore } from '../store/folder-store-fs';

let activeStore: FsFolderStore | null = null;

export function setActiveStore(store: FsFolderStore | null): void {
  activeStore = store;
}

export function getActiveStore(): FsFolderStore | null {
  return activeStore;
}

// ---- Parked stores (2026-07-19) ----
//
// On world switch the prior store is PARKED (heartbeat stopped, caches +
// lock retained) instead of closed, so switching back revives it without
// re-walking the folder. Small LRU: Map preserves insertion order; re-park
// re-inserts, evictions close the oldest for real. unpark validity (the
// lock still ours) is the STORE's job — this registry only holds instances.

const PARK_CAP = 3;
const parkedStores = new Map<string, FsFolderStore>();
/** In-flight eviction closes, worldId → promise. A fresh open of the same
 *  world must WAIT for these — an eviction's async close deleting the lock
 *  could otherwise race the new store's just-claimed lock. */
const pendingEvictions = new Map<string, Promise<unknown>>();

function closeEvicted(worldId: string, store: FsFolderStore): void {
  const p = store.close().catch(() => {}).finally(() => {
    if (pendingEvictions.get(worldId) === p) pendingEvictions.delete(worldId);
  });
  pendingEvictions.set(worldId, p);
}

/** Await any in-flight eviction close for this world (no-op when none). */
export function awaitEviction(worldId: string): Promise<unknown> {
  return pendingEvictions.get(worldId) ?? Promise.resolve();
}

/** Park a store under its worldId; evicts (closes) the oldest past the cap. */
export function parkStore(worldId: string, store: FsFolderStore): void {
  const displaced = parkedStores.get(worldId);
  if (displaced && displaced !== store) closeEvicted(worldId, displaced);
  parkedStores.delete(worldId);
  parkedStores.set(worldId, store);
  store.park();
  while (parkedStores.size > PARK_CAP) {
    const [oldestId, oldest] = parkedStores.entries().next().value as [string, FsFolderStore];
    parkedStores.delete(oldestId);
    closeEvicted(oldestId, oldest);
  }
}

/** Take a parked store back out (caller must unpark() + verify, or close()). */
export function takeParkedStore(worldId: string): FsFolderStore | null {
  const store = parkedStores.get(worldId);
  if (!store) return null;
  parkedStores.delete(worldId);
  return store;
}

/** Close + drop every parked store (tests, full resets). */
export function clearParkedStores(): void {
  for (const [worldId, store] of parkedStores) closeEvicted(worldId, store);
  parkedStores.clear();
}

/** Drop + close a parked store (world deleted/unlinked from atlas). */
export function evictParkedStore(worldId: string): void {
  const store = parkedStores.get(worldId);
  if (!store) return;
  parkedStores.delete(worldId);
  closeEvicted(worldId, store);
}
