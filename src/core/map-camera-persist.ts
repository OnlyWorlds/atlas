/**
 * Per-map camera state persistence (zoom + pan center).
 *
 * Saves to localStorage so a reload or tab-switch lands the user back at the
 * view they were last at on each map. Falls back to fitToCanvas when no entry
 * exists for a given map (first-open, after a manual reset, etc.).
 *
 * Storage shape:
 *
 *   {
 *     "<mapId>": { center: [lat, lng], zoom: number, savedAt: <iso> },
 *     ...
 *   }
 *
 * `savedAt` is informational — atlas doesn't expire entries, but old map ids
 * that no longer exist locally accrete harmlessly. A future cleanup could
 * prune entries not present in `data.elements` on world activation.
 */

import { MAP_CAMERA_STATE_KEY } from './constants';

export interface CameraState {
  center: [number, number];
  zoom: number;
  savedAt?: string;
}

type CameraStore = Record<string, CameraState>;

function read(): CameraStore {
  try {
    const raw = localStorage.getItem(MAP_CAMERA_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CameraStore;
    }
    return {};
  } catch {
    return {};
  }
}

function write(store: CameraStore): void {
  try {
    localStorage.setItem(MAP_CAMERA_STATE_KEY, JSON.stringify(store));
  } catch {
    // Quota / private-mode failure — silent. View state is advisory; falling
    // back to fitToCanvas on the next open is fine.
  }
}

/**
 * Save the current camera state for a map. Called from moveend/zoomend
 * handlers in map-tab.ts. Idempotent.
 */
export function saveCameraState(mapId: string, state: CameraState): void {
  if (!mapId) return;
  // Sanity-check the values — Leaflet sometimes fires moveend with NaN during
  // init; persisting that would corrupt the slot. Skip silently.
  const [lat, lng] = state.center;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(state.zoom)) return;
  const store = read();
  store[mapId] = {
    center: [lat, lng],
    zoom: state.zoom,
    savedAt: new Date().toISOString(),
  };
  write(store);
}

/**
 * Read the saved camera state for a map. Returns null if no entry exists.
 */
export function getCameraState(mapId: string): CameraState | null {
  if (!mapId) return null;
  const store = read();
  const entry = store[mapId];
  if (!entry) return null;
  // Validate shape — corrupted entries should fall back to fitToCanvas, not
  // crash the mount path.
  if (
    !Array.isArray(entry.center) ||
    entry.center.length !== 2 ||
    !Number.isFinite(entry.center[0]) ||
    !Number.isFinite(entry.center[1]) ||
    !Number.isFinite(entry.zoom)
  ) {
    return null;
  }
  return entry;
}

/**
 * The re-key moves ids; stored state follows. Moves each old map id's
 * entry to its new id (the new id is brand new, so the old entry wins).
 * The store is not world-scoped, so no world parameter. No-op when nothing matches.
 */
export function remapCameraStates(map: ReadonlyMap<string, string>): void {
  const store = read();
  let changed = false;
  for (const [oldId, newId] of map) {
    if (!(oldId in store) || oldId === newId) continue;
    store[newId] = store[oldId];
    delete store[oldId];
    changed = true;
  }
  if (changed) write(store);
}

/**
 * Drop a map's saved camera state (e.g., when the map is deleted). Idempotent.
 */
export function clearCameraState(mapId: string): void {
  const store = read();
  if (!(mapId in store)) return;
  delete store[mapId];
  write(store);
}
