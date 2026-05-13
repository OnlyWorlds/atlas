/**
 * Sync attachment — opens a SyncEngine for an api-linked world and wires its
 * state changes into `state.sync.activeSync` (consumed by the sync pill).
 *
 * Module-level singleton: at most one engine is attached at a time, matching
 * the "one active world" UI model. World switches detach the previous engine.
 *
 * Used by:
 * - `activateWorld` (worlds-sidebar.ts) when the activated entry is `api-linked`.
 * - `attachApi`-flipping flows (Make-Online, Link-Existing-API) after the
 *   registry state transitions.
 *
 * The PIN comes from `state.registry.pin` — it's a global identity field, the
 * same for every api-linked world. If the PIN is missing when attach is called,
 * we log + skip engine creation; the UI surfaces this via the pill state.
 */

import { OnlyWorldsClient } from '@onlyworlds/sdk';
import { OwClientAdapter } from './ow-client-adapter';
import { SyncEngine } from './sync-engine';
import { patchSlice, getState } from '../core/state';
import type { FolderStore } from '../store/folder-store';
import type { WorldRegistryEntry, SyncEngineState } from '../core/types';

let currentEngine: SyncEngine | null = null;
let currentWorldId: string | null = null;

/**
 * Attach a fresh SyncEngine to the given (api-linked) world's folder. Returns
 * the engine for callers that want to invoke `pushOnce()` etc. immediately,
 * or null if attachment isn't possible (not api-linked, missing PIN).
 *
 * Detaches the previous engine first (if any). Engines are not preserved
 * across world switches; if the user switches back, a fresh engine is built.
 */
export function attachSyncEngine(entry: WorldRegistryEntry, folder: FolderStore): SyncEngine | null {
  // Always detach the previous engine first — at most one active at a time.
  detachSyncEngine();

  if (entry.state !== 'api-linked' || !entry.api) {
    return null;
  }

  const pin = getState().registry.pin;
  if (!pin) {
    console.warn('[sync-attach] PIN missing — engine not attached for', entry.name);
    return null;
  }

  const client = new OnlyWorldsClient({
    apiKey: entry.api.api_key,
    apiPin: pin,
  });
  const adapter = new OwClientAdapter(client);
  const engine = new SyncEngine({
    folder,
    client: adapter,
    onStateChange: (s) => publishSyncState(entry.id, s),
  });

  currentEngine = engine;
  currentWorldId = entry.id;
  // Seed the slice with the engine's initial state.
  publishSyncState(entry.id, engine.getState());
  return engine;
}

/**
 * Detach the current engine: pause it, clear the world's slice entry, and
 * reset `activeSync` to null. Safe to call when no engine is attached.
 */
export function detachSyncEngine(): void {
  if (currentWorldId !== null) {
    currentEngine?.stop();
    const sync = getState().sync;
    const byWorld = { ...sync.byWorld };
    delete byWorld[currentWorldId];
    patchSlice('sync', { byWorld, activeSync: null });
  }
  currentEngine = null;
  currentWorldId = null;
}

/**
 * Convenience helper for UI callers that just want to schedule a debounced
 * push after a folder write. No-ops if no engine is attached (local-only world
 * or engine startup failed). Used by element-detail.ts after every save.
 */
export function requestPushIfLinked(): void {
  currentEngine?.requestPush();
}

/** Currently-attached engine, or null. Used by element-edit autosave wiring. */
export function getCurrentSyncEngine(): SyncEngine | null {
  return currentEngine;
}

/** Currently-attached engine's world id, or null. */
export function getCurrentSyncWorldId(): string | null {
  return currentWorldId;
}

function publishSyncState(worldId: string, engineState: SyncEngineState): void {
  const sync = getState().sync;
  patchSlice('sync', {
    byWorld: { ...sync.byWorld, [worldId]: engineState },
    activeSync: engineState,
  });
}
