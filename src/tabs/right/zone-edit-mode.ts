/**
 * Zone shape edit mode (DESIGN_ZONES.md §3, S4).
 *
 * One zone may be in edit mode at a time, on one map. Entry: dblclick the
 * zone on canvas OR "Edit shape" button in element-detail. Vertex dots
 * become draggable handles; segments accept clicks to insert markers; right-
 * click a handle to delete a marker.
 *
 * Lifecycle:
 *   - enterEditMode: snapshot markers + render draggable handles + segment overlays
 *   - drag/insert/delete: each action autosaves to folder-store + requestPushIfLinked
 *   - ESC → cancelEdit: restore snapshot (3-way diff: revert moved, recreate deleted, delete added)
 *   - Done (Enter or button): commit (no-op since autosaved) + exit
 *   - exitEditMode: tear down overlays, restore ZoneOverlay's read-only vertex dots
 *
 * Ported patterns from zoner (audit 2026-05-17):
 *   - DivIcon markers with draggable: true (zoner ZoneCanvas.ts:397-450)
 *   - Invisible 20px-weight polyline segment overlays with opacity hover toggle
 *     (zoner ZoneCanvas.ts:862-896)
 *   - Splice insertion at segment midpoint + renumber-all order (zoner pattern;
 *     atlas uses explicit `order` field since markers are separate entities)
 *
 * Improvements over zoner:
 *   - Leaflet native dblclick suppression (no 200ms clickTimeout dance)
 *   - Explicit `ui.zoneEditing` state slice (not implicit via activeMarkers/editingZoneId pair)
 *   - 3-way diff cancel (vs zoner's points-array overwrite) since atlas stores
 *     markers as separate entities with stable ids.
 */

import L from 'leaflet';
import { getState, patchSlice } from '../../core/state';
import { getActiveStore } from '../../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import { storageToLeaflet, leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import { polygonCentroid, polylineLabelAnchor, type Point } from '../../visualization/leaflet-2d/ZoneGeometry';
import { getZoneSvgRendererForMap } from '../../visualization/leaflet-2d/ZoneOverlay';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { markersForZoneOnMap, partitionZonesAndMarkers, getZoneShape } from './zone-derived';
import { computeInsertion, commitVertexPosition } from './zone-edit-kernels';
import type { Marker, Zone } from '../../core/types';
import type { ToastManager } from '../../ui/toast-manager';
import { finiteOr } from '../../core/dom-utils';

interface MarkerSnapshot {
  id: string;
  x: number;
  y: number;
  order: number;
}

interface EditSession {
  zoneId: string;
  mapId: string;
  /**
   * The world this session BELONGS to (S307).
   *
   * Without it, `exitEditMode` cleared the persisted snapshot under whatever
   * world happened to be active at exit — and the world switch sets
   * `active.worldId` BEFORE patching elements, so the elements patch drove
   * `syncEditMode` → `exitEditMode('commit')` while the NEW world was
   * already active. That cleared the new world's (empty) slot and left the
   * old world's snapshot behind, to be replayed as a "revert" later. The
   * comment at the clear site claimed it was keyed to the session's world;
   * the field it needed to do that did not exist.
   */
  worldId: string;
  snapshot: MarkerSnapshot[];  // markers as they were on entry
  // Live Leaflet primitives — rebuilt when underlying marker set changes.
  layerGroup: L.LayerGroup;
  vertexMarkers: Map<string, L.Marker>;  // markerId → leaflet marker
  segmentOverlays: L.Polyline[];
  /**
   * Centroid drag handle (ZC7 — zoner-style bulk-move). Single draggable
   * marker at the polygon centroid (or polyline label anchor). Drag start
   * snapshots all marker positions; drag delta is applied to every marker
   * live; dragend commits via batched updateMarker calls.
   */
  centroidHandle: L.Marker | null;
  centroidDragStart: { x: number; y: number; markerPositions: Map<string, { x: number; y: number }> } | null;
  toasts: ToastManager;
  // Saved Leaflet defaults to restore on exit.
  defaultDoubleClickZoom: boolean;
}

let active: EditSession | null = null;
let escListenerInstalled = false;

/**
 * Is this event coming from somewhere the user is typing? Exported so the
 * unit test drives the same predicate the listener does, rather than a copy
 * of it (a test that reasons about a rule it cannot see guards nothing).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  // `isContentEditable` is not implemented everywhere (undefined in jsdom on
  // a plain element), so coerce — the signature promises a boolean and a
  // caller doing `=== false` would otherwise be silently wrong.
  return tag === 'INPUT'
    || tag === 'TEXTAREA'
    || tag === 'SELECT'
    || Boolean(target.isContentEditable);
}

/**
 * localStorage key for in-flight edit snapshots. One slot PER WORLD so multi-
 * world edit attempts don't clobber each other.
 *
 * Captain smoke session 219: "if i refresh page in edit mode; it seems to
 * store the changes, instead of reverting them, after reload." Root cause:
 * autosave-during-edit + in-memory-only snapshot = refresh loses the snapshot
 * before the user can Cancel. Fix: persist the snapshot to localStorage on
 * enter, clear on exit; on world activation, replay revert if found.
 *
 * Captain session 221: keying by world means switching mid-edit doesn't
 * destroy world A's snapshot when world B starts an edit. Each world's
 * activation picks up its own pending snapshot independently.
 *
 * Schema: `Record<worldId, { zoneId, mapId, snapshot: MarkerSnapshot[] }>`.
 */
const EDIT_SNAPSHOT_KEY = 'atlas_zone_edit_snapshot_v2';
/** Legacy single-slot key from session 219. Migrated to per-world on read. */
const EDIT_SNAPSHOT_KEY_V1 = 'atlas_zone_edit_snapshot_v1';

interface PersistedSnapshot {
  worldId: string;
  zoneId: string;
  mapId: string;
  snapshot: MarkerSnapshot[];
}

type SnapshotsByWorld = Record<string, Omit<PersistedSnapshot, 'worldId'>>;

function readSnapshotsByWorld(): SnapshotsByWorld {
  // Read v2 first.
  try {
    const raw = localStorage.getItem(EDIT_SNAPSHOT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as SnapshotsByWorld;
      }
    }
  } catch { /* fall through to v1 migration */ }
  // Legacy migration: read v1 (single-slot), seed the v2 map under its worldId.
  try {
    const legacyRaw = localStorage.getItem(EDIT_SNAPSHOT_KEY_V1);
    if (!legacyRaw) return {};
    const legacy = JSON.parse(legacyRaw) as PersistedSnapshot;
    if (!legacy.worldId || !legacy.zoneId || !legacy.mapId || !Array.isArray(legacy.snapshot)) return {};
    const migrated: SnapshotsByWorld = {
      [legacy.worldId]: { zoneId: legacy.zoneId, mapId: legacy.mapId, snapshot: legacy.snapshot },
    };
    try {
      localStorage.setItem(EDIT_SNAPSHOT_KEY, JSON.stringify(migrated));
      localStorage.removeItem(EDIT_SNAPSHOT_KEY_V1);
    } catch { /* quota — keep legacy in place, return migrated for this session */ }
    return migrated;
  } catch { return {}; }
}

function writeSnapshotsByWorld(map: SnapshotsByWorld): void {
  try {
    if (Object.keys(map).length === 0) {
      localStorage.removeItem(EDIT_SNAPSHOT_KEY);
    } else {
      localStorage.setItem(EDIT_SNAPSHOT_KEY, JSON.stringify(map));
    }
  } catch { /* quota — non-fatal; recovery just won't work this session */ }
}

function writePersistedSnapshot(p: PersistedSnapshot): void {
  const all = readSnapshotsByWorld();
  all[p.worldId] = { zoneId: p.zoneId, mapId: p.mapId, snapshot: p.snapshot };
  writeSnapshotsByWorld(all);
}

function readPersistedSnapshot(worldId: string): PersistedSnapshot | null {
  const all = readSnapshotsByWorld();
  const entry = all[worldId];
  if (!entry || !entry.zoneId || !entry.mapId || !Array.isArray(entry.snapshot)) return null;
  return { worldId, ...entry };
}

/** A zone edit this world left open (replayed at activation). The re-key
 *  (S363) refuses while one exists: the snapshot names zone and marker ids. */
export function hasPendingZoneEdit(worldId: string): boolean {
  return readPersistedSnapshot(worldId) !== null;
}

function clearPersistedSnapshot(worldId: string): void {
  const all = readSnapshotsByWorld();
  if (!(worldId in all)) return;
  delete all[worldId];
  writeSnapshotsByWorld(all);
}

/**
 * Module-level "just-dragged" guard. Vertex / centroid drag handlers set this
 * to `Date.now()` on dragstart and clear-by-timeout on dragend. The map-click
 * handler in map-tab.ts checks `isMidDragSuppression()` before treating a
 * canvas click as a deselect — without this, the mouseup that ENDS a drag
 * can also fire a map-click event (Leaflet's marker drag doesn't always
 * swallow click propagation), which would deselect the zone right after the
 * user finished moving a vertex.
 *
 * Captain smoke session 219 originally surfaced this for an old
 * click-anywhere-to-insert flow; session 226 removed that flow but the
 * suppression remains relevant for the deselect-on-background-click path.
 */
let dragSuppressUntil = 0;
const DRAG_SUPPRESS_MS = 150;

/**
 * rAF-throttled live-outline scheduler. The drag handler used to call
 * collectLivePointsFromHandles + setZonePointsLive SYNCHRONOUSLY on every
 * drag event — Leaflet's L.Draggable sets the marker's CSS transform on
 * mousemove, then synchronously fires `drag`. Our work in the drag handler
 * runs BEFORE the browser commits the next paint, so any non-trivial cost
 * delays the marker's visible position. Result: marker trails cursor.
 *
 * Wave 3 (Captain "marker still lags"): move ALL work — including
 * collectLivePointsFromHandles itself — into requestAnimationFrame. The
 * drag handler is now O(1): just sets a dirty flag and (idempotently)
 * schedules rAF. The marker's transform commits to paint immediately;
 * the outline catches up on the next frame, which is invisible at 60Hz.
 *
 * Earlier session 219 baseline ("snappier than every-event") batched
 * setZonePointsLive but still ran collectLivePointsFromHandles per event.
 */
let liveDirty = false;
let liveRafHandle: number | null = null;
let liveRafCanvasHeight = 0;

function scheduleLiveOutlineRefresh(canvasHeight: number): void {
  liveDirty = true;
  liveRafCanvasHeight = canvasHeight;
  if (liveRafHandle !== null) return;
  liveRafHandle = requestAnimationFrame(() => {
    liveRafHandle = null;
    if (!liveDirty || !active) return;
    liveDirty = false;
    const entry = mapTabCache.get(active.mapId);
    if (!entry?.zoneOverlay) return;
    // Read handle positions INSIDE rAF so the drag event handler stays O(1).
    const points = collectLivePointsFromHandles(liveRafCanvasHeight);
    if (points.length >= 2) entry.zoneOverlay.setZonePointsLive(active.zoneId, points);
  });
}

function cancelPendingLivePoints(): void {
  if (liveRafHandle !== null) {
    cancelAnimationFrame(liveRafHandle);
    liveRafHandle = null;
  }
  liveDirty = false;
}

export function markDragInProgress(): void {
  dragSuppressUntil = Number.MAX_SAFE_INTEGER;
}

export function markDragEnded(): void {
  // Keep suppression active briefly past dragend so the trailing click event
  // from the mouseup still gets blocked.
  dragSuppressUntil = Date.now() + DRAG_SUPPRESS_MS;
}

export function isMidDragSuppression(): boolean {
  return Date.now() < dragSuppressUntil;
}

function ensureEscListener(): void {
  if (escListenerInstalled) return;
  escListenerInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (!active) return;
    // NOT WHILE TYPING (S307). The zone's element-detail panel stays mounted
    // during edit mode (name, description, custom fields), so these were
    // captured from inside text inputs: retyping the zone name and pressing
    // Enter committed and exited the shape edit, and pressing Escape to
    // dismiss a field CANCELLED it — reverting every vertex drag, with no
    // undo. IME composition counts as typing too.
    if (isTypingTarget(e.target) || e.isComposing) return;
    if (e.key === 'Escape') {
      // ESC cancels — restore snapshot.
      cancelEdit();
    } else if (e.key === 'Enter') {
      // Enter commits + exits (autosave already persisted everything).
      exitEditMode('commit');
    }
  });
}

export function isEditing(): boolean {
  return active !== null;
}

export function getEditingZoneId(): string | null {
  return active?.zoneId ?? null;
}

export function getEditingMapId(): string | null {
  return active?.mapId ?? null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Enter edit mode for the given zone on the given map.
 *
 * If a different zone is already in edit, commits-and-exits first.
 * If the same zone is already in edit, no-op.
 */
export function enterEditMode(
  zoneId: string,
  mapId: string,
  toasts: ToastManager,
): void {
  ensureEscListener();
  if (active && active.zoneId === zoneId && active.mapId === mapId) return;
  if (active) exitEditMode('commit');

  const entry = mapTabCache.get(mapId);
  if (!entry) {
    toasts.error('Cannot edit: map tab not open');
    return;
  }
  const lMap = entry.manager.getMap();
  if (!lMap) return;

  const state = getState();
  const { markers } = partitionZonesAndMarkers(state.data.elements);
  const zoneMarkers = markersForZoneOnMap(zoneId, mapId, markers);

  if (zoneMarkers.length === 0) {
    toasts.info('Zone has no markers on this map');
    return;
  }

  // Snapshot for cancel restoration.
  const snapshot: MarkerSnapshot[] = zoneMarkers.map(m => ({
    id: m.id,
    x: m.x,
    y: m.y,
    order: m.order ?? 0,
  }));

  // Persist snapshot to localStorage so a mid-edit page refresh can still
  // revert. Cleared by exitEditMode (commit OR cancel) and by the recovery
  // path after a successful auto-revert.
  const worldId = getState().active?.worldId;
  if (worldId) {
    writePersistedSnapshot({ worldId, zoneId, mapId, snapshot });
  }

  // Suppress ZoneOverlay's read-only vertex dots — our own draggable handles
  // render in their place at the same coords. Polygon outline + selection
  // glow remain unchanged (zone is still selected throughout edit).
  entry.zoneOverlay?.setVertexDotsSuppressed(zoneId, true);
  // Flip the polygon outline to dashed for the duration of edit (ZC6 —
  // visual parity with create-mode preview, signals mutability).
  entry.zoneOverlay?.setZoneEditing(zoneId, true);

  const layerGroup = L.layerGroup().addTo(lMap);

  // Disable map dblclick zoom while editing (a stray dblclick during edit
  // shouldn't zoom the canvas — it should be a no-op or potentially a
  // re-enter-edit on a different element).
  const defaultDoubleClickZoom = lMap.doubleClickZoom.enabled();
  lMap.doubleClickZoom.disable();

  active = {
    zoneId,
    mapId,
    // Stamped from the world active at ENTRY, never re-read at exit.
    worldId: worldId ?? '',
    snapshot,
    layerGroup,
    vertexMarkers: new Map(),
    segmentOverlays: [],
    centroidHandle: null,
    centroidDragStart: null,
    toasts,
    defaultDoubleClickZoom,
  };

  // Cursor cue on the canvas container.
  entry.container.classList.add('atlas-zone-editing');

  rebuildHandles();
}

/**
 * Re-render vertex handles + segment overlays from current state. Called
 * after every mutation (drag commit, insert, delete) so handles reflect
 * the new marker set.
 */
function rebuildHandles(): void {
  if (!active) return;
  const entry = mapTabCache.get(active.mapId);
  if (!entry) return;
  const lMap = entry.manager.getMap();
  if (!lMap) return;
  const height = entry.manager.getConfig().canvasHeight;

  // Tear down existing primitives.
  for (const m of active.vertexMarkers.values()) active.layerGroup.removeLayer(m);
  active.vertexMarkers.clear();
  for (const s of active.segmentOverlays) active.layerGroup.removeLayer(s);
  active.segmentOverlays = [];
  if (active.centroidHandle) {
    active.layerGroup.removeLayer(active.centroidHandle);
    active.centroidHandle = null;
  }

  const state = getState();
  const { markers } = partitionZonesAndMarkers(state.data.elements);
  const zoneMarkers = markersForZoneOnMap(active.zoneId, active.mapId, markers);

  // Vertex handles — draggable Leaflet markers with cyan-dot DivIcon.
  for (const m of zoneMarkers) {
    const handle = buildVertexHandle(m, height);
    handle.addTo(active.layerGroup);
    active.vertexMarkers.set(m.id, handle);
  }

  // Segment overlays — invisible polylines between consecutive markers.
  // For polygon zones, also include the wrap segment (last → first).
  const zone = state.data.elements.find(
    (e): e is Zone => e.type === 'zone' && e.id === active!.zoneId,
  );
  const isPolygon = getZoneShape(zone) === 'polygon';
  const segmentCount = isPolygon ? zoneMarkers.length : zoneMarkers.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const a = zoneMarkers[i];
    const b = zoneMarkers[(i + 1) % zoneMarkers.length];
    const overlay = buildSegmentOverlay(a, b, i, height);
    overlay.addTo(active.layerGroup);
    // Hover INSIDE the polygon edge (Captain wave 5): raise the segment
    // overlay above the zone polygon in SVG render order so the polygon's
    // interactive fill doesn't intercept hover events on the inner side of
    // the edge. bringToFront() reorders within the shared SVG context in
    // overlayPane regardless of which L.LayerGroup the path belongs to.
    overlay.bringToFront();
    active.segmentOverlays.push(overlay);
  }

  // Centroid drag handle (ZC7 — bulk-move via single handle, ported from
  // zoner). Polygons → vertex-averaged centroid; lines → midpoint of longest
  // segment (visual room). Drag delta is applied to every marker live; batch
  // commit on dragend.
  const pts = zoneMarkers.map(m => ({ x: m.x, y: m.y }));
  const centerPt = isPolygon ? polygonCentroid(pts) : polylineLabelAnchor(pts);
  if (centerPt) {
    active.centroidHandle = buildCentroidHandle(centerPt, height);
    active.centroidHandle.addTo(active.layerGroup);
  }
}

/**
 * Read each vertex handle's CURRENT latlng (including any handle being
 * actively dragged) and convert to storage-space points in iteration order.
 * The Map<id, L.Marker> preserves insertion order which matches the
 * zoneMarkers sort by `order` from rebuildHandles — so output points are in
 * canonical zone-vertex order without extra sort.
 */
function collectLivePointsFromHandles(canvasHeight: number): Point[] {
  if (!active) return [];
  const out: Point[] = [];
  for (const handle of active.vertexMarkers.values()) {
    const ll = handle.getLatLng();
    out.push(leafletToStorage(ll, canvasHeight));
  }
  return out;
}

function buildVertexHandle(marker: Marker, canvasHeight: number): L.Marker {
  const latlng = storageToLeaflet({ x: marker.x, y: marker.y }, canvasHeight);
  // 1-indexed display; matches zoner muscle memory ("marker 1, 2, 3...").
  // `order` comes from a world file: a string here was concatenated into the
  // handle's HTML below (S360). Numbers only.
  const displayOrder = finiteOr(marker.order, 0) + 1;
  // Tooltip via native title — surfaces the two affordances (drag-to-move /
  // drag-to-trash / right-click-delete) on hover. No layout cost, no
  // dependency on a popover lib.
  const tooltip = 'drag to move · drop on trash to delete · right-click to delete';
  const icon = L.divIcon({
    className: 'atlas-zone-edit-handle',
    html: `<span class="atlas-zone-edit-handle-num" title="${tooltip}">${displayOrder}</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  const handle = L.marker(latlng, {
    icon,
    draggable: true,
    keyboard: false,
  });

  // Drag handlers — dragstart blocks map clicks; drag is visual; dragend
  // commits. The trash-zone affordance mirrors pins (map-tab-pin-drag.ts):
  // reveal on dragstart, live-track hover during drag, on drop test against
  // the trash-zone rect and either delete or persist position. Reuses
  // entry.trashZone — same DOM element pins use.
  //
  // Floor guard: zones have a minimum vertex count (3 polygon / 2 line). If
  // we're already AT that floor, the trash drop would be refused by
  // `deleteMarkerInEdit` with a toast — visually that's a "drop succeeds
  // then snaps back" jank. Compute the floor at dragstart and suppress
  // trash-zone arming + the delete path while at floor. The user can still
  // move the marker; they just can't delete it via drag-to-trash.
  let suppressClick = false;
  let canDeleteThisDrag = false;
  handle.on('dragstart', () => {
    suppressClick = true;
    markDragInProgress();
    if (!active) return;
    const entry = mapTabCache.get(active.mapId);
    if (!entry) return;
    const state = getState();
    const { markers } = partitionZonesAndMarkers(state.data.elements);
    const zoneMarkers = markersForZoneOnMap(active.zoneId, active.mapId, markers);
    const zone = state.data.elements.find(
      (e): e is Zone => e.type === 'zone' && e.id === active!.zoneId,
    );
    const isPolygon = getZoneShape(zone) === 'polygon';
    const minVertices = isPolygon ? 3 : 2;
    canDeleteThisDrag = zoneMarkers.length > minVertices;
    if (canDeleteThisDrag) {
      entry.trashZone.setAttribute('data-active', 'true');
      entry.trashZone.setAttribute('data-hover', 'false');
    }
    // At-floor: trash zone stays hidden; drag is pure move.
  });
  // Live outline update (ZD4): on every drag frame, update the ZoneOverlay
  // polygon/polyline via setZonePointsLive. We rebuild the points list from
  // each vertex handle's CURRENT latlng (this includes the one being
  // dragged), so the outline tracks live. Cheap — setLatLngs mutates the
  // SVG path in place. No store write here; dragend handles persistence.
  handle.on('drag', () => {
    if (!active) return;
    // O(1): just mark dirty. Reading handle positions + applying setLatLngs
    // happens in rAF, OUT of the paint-blocking path. The marker's CSS
    // transform commits immediately; the polygon catches up one frame later.
    scheduleLiveOutlineRefresh(canvasHeight);
    if (!canDeleteThisDrag) return;
    // Update trash-zone hover state (cheap — just reads two bounding rects).
    const entry = mapTabCache.get(active.mapId);
    if (entry && entry.trashZone.getAttribute('data-active') === 'true') {
      const lMap = entry.manager.getMap();
      if (lMap) {
        const markerScreen = lMap.latLngToContainerPoint(handle.getLatLng());
        entry.trashZone.setAttribute(
          'data-hover',
          String(isInsideTrashZone(entry, markerScreen)),
        );
      }
    }
  });
  handle.on('dragend', async () => {
    setTimeout(() => { suppressClick = false; }, 50);
    markDragEnded();
    // Flush any pending rAF live-point update so the final position is the
    // committed one, not a stale-frame snapshot.
    cancelPendingLivePoints();
    // Determine drop target: trash zone (delete) vs anywhere else (move).
    let droppedOnTrash = false;
    const entry = active ? mapTabCache.get(active.mapId) : null;
    if (entry) {
      if (canDeleteThisDrag) {
        const lMap = entry.manager.getMap();
        if (lMap) {
          const markerScreen = lMap.latLngToContainerPoint(handle.getLatLng());
          droppedOnTrash = isInsideTrashZone(entry, markerScreen);
        }
      }
      entry.trashZone.setAttribute('data-active', 'false');
      entry.trashZone.setAttribute('data-hover', 'false');
    }
    if (droppedOnTrash) {
      await deleteMarkerInEdit(marker.id);
      // deleteMarkerInEdit calls rebuildHandles internally on success; on
      // any unexpected refusal (shouldn't happen since canDeleteThisDrag
      // was guarded) we rebuild to snap the marker visual back.
      rebuildHandles();
      return;
    }
    const newLatLng = handle.getLatLng();
    const pt = leafletToStorage(newLatLng, canvasHeight);
    // Clamp to the canvas, matching the sketch-rescale transform. CRS.Simple
    // lets a vertex be dragged well past the edge; an out-of-bounds value
    // survives until an image attach rescales+clamps it and deforms the
    // polygon (S307, the S300 corruption class).
    const cfg = active ? mapTabCache.get(active.mapId)?.manager.getConfig() : null;
    const dims = { w: cfg?.canvasWidth ?? Number.MAX_SAFE_INTEGER, h: cfg?.canvasHeight ?? Number.MAX_SAFE_INTEGER };
    const { x, y } = commitVertexPosition(pt, dims);
    const store = getActiveStore();
    if (!store) return;
    try {
      await store.updateMarker(marker.id, { x, y });
      const elements = await refreshElementsAfterWrite(store);
      rebuildHandles(); // re-render so segment overlays follow the new position
    } catch (err) {
      console.error('[zone-edit] update marker failed:', err);
      active?.toasts.error('Failed to move marker');
      // Snap visual back by rebuilding from current (unchanged) state.
      rebuildHandles();
    }
  });

  // Right-click → delete this marker.
  handle.on('contextmenu', async (e) => {
    L.DomEvent.stop(e);
    if (suppressClick) return;
    await deleteMarkerInEdit(marker.id);
  });

  return handle;
}

/**
 * Check whether a marker's container-point lies inside the map tab's trash
 * zone rect. Mirrors `isInsideZone` in map-tab-pin-drag.ts; kept local to
 * avoid coupling the two drag flows through a shared helper.
 */
function isInsideTrashZone(
  entry: MapTabCacheEntry,
  markerScreen: { x: number; y: number },
): boolean {
  const containerRect = entry.container.getBoundingClientRect();
  const zoneRect = entry.trashZone.getBoundingClientRect();
  const mx = containerRect.left + markerScreen.x;
  const my = containerRect.top + markerScreen.y;
  return (
    mx >= zoneRect.left &&
    mx <= zoneRect.right &&
    my >= zoneRect.top &&
    my <= zoneRect.bottom
  );
}

/**
 * Centroid drag handle (ZC7). Renders as a slightly larger ring than vertex
 * handles, in the polygon center (or polyline midpoint). Drag mutates every
 * marker's position by the same delta; dragend commits via batched
 * `updateMarker` calls.
 *
 * Live drag updates the vertex handles' positions visually but does NOT write
 * to store per frame (would thrash). Each vertex handle's underlying Leaflet
 * latlng is set in-place so the polygon outline (rendered by ZoneOverlay
 * subscribing to state.data.elements — which DOESN'T change mid-drag) won't
 * update. That's the tradeoff: outline stays in original position until
 * dragend commits and triggers a re-render. Acceptable for v1; future polish
 * could re-render the outline via ZoneOverlay.updateZone during drag.
 */
function buildCentroidHandle(center: Point, canvasHeight: number): L.Marker {
  const latlng = storageToLeaflet(center, canvasHeight);
  const icon = L.divIcon({
    className: 'atlas-zone-centroid-handle',
    html: '<span class="material-symbols-outlined">open_with</span>',
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
  const handle = L.marker(latlng, {
    icon,
    draggable: true,
    keyboard: false,
    // Visually above vertex handles so the user can grab it even when it
    // overlaps a vertex.
    zIndexOffset: 100,
  });

  handle.on('dragstart', () => {
    if (!active) return;
    markDragInProgress();
    const startLatLng = handle.getLatLng();
    const startPt = leafletToStorage(startLatLng, canvasHeight);
    const state = getState();
    const { markers } = partitionZonesAndMarkers(state.data.elements);
    const zoneMarkers = markersForZoneOnMap(active.zoneId, active.mapId, markers);
    const positions = new Map<string, { x: number; y: number }>();
    for (const m of zoneMarkers) positions.set(m.id, { x: m.x, y: m.y });
    active.centroidDragStart = {
      x: startPt.x,
      y: startPt.y,
      markerPositions: positions,
    };
  });

  handle.on('drag', () => {
    if (!active?.centroidDragStart) return;
    const curLatLng = handle.getLatLng();
    const curPt = leafletToStorage(curLatLng, canvasHeight);
    const dx = curPt.x - active.centroidDragStart.x;
    const dy = curPt.y - active.centroidDragStart.y;
    // Move every vertex handle's Leaflet latlng in-place — visual feedback
    // for the user. State writes happen on dragend.
    for (const [markerId, origPos] of active.centroidDragStart.markerPositions) {
      const vh = active.vertexMarkers.get(markerId);
      if (!vh) continue;
      vh.setLatLng(storageToLeaflet({ x: origPos.x + dx, y: origPos.y + dy }, canvasHeight));
    }
    // Live outline (ZD4) — rAF-throttled. We don't even read handle positions
    // here; the rAF callback reads them. The bulk-move loop above sets each
    // handle's latlng synchronously so the rAF reads see the new positions.
    scheduleLiveOutlineRefresh(canvasHeight);
  });

  handle.on('dragend', async () => {
    markDragEnded();
    if (!active?.centroidDragStart) return;
    const session = active;
    const startSnap = session.centroidDragStart!;
    session.centroidDragStart = null;
    const curLatLng = handle.getLatLng();
    const curPt = leafletToStorage(curLatLng, canvasHeight);
    const dx = Math.round(curPt.x - startSnap.x);
    const dy = Math.round(curPt.y - startSnap.y);
    if (dx === 0 && dy === 0) {
      rebuildHandles();
      return;
    }
    const store = getActiveStore();
    if (!store) return;
    const entry = mapTabCache.get(session.mapId);
    const w = entry?.manager.getConfig().canvasWidth ?? 2000;
    const h = entry?.manager.getConfig().canvasHeight ?? 2000;
    try {
      for (const [markerId, origPos] of startSnap.markerPositions) {
        const nx = clamp(origPos.x + dx, 0, w);
        const ny = clamp(origPos.y + dy, 0, h);
        await store.updateMarker(markerId, { x: nx, y: ny });
      }
      const elements = await refreshElementsAfterWrite(store);
      rebuildHandles();
    } catch (err) {
      console.error('[zone-edit] centroid drag commit failed:', err);
      session.toasts.error('Failed to move zone');
      rebuildHandles();
    }
  });

  return handle;
}

function buildSegmentOverlay(
  a: Marker,
  b: Marker,
  segmentIndex: number,
  canvasHeight: number,
): L.Polyline {
  const aLatLng = storageToLeaflet({ x: a.x, y: a.y }, canvasHeight);
  const bLatLng = storageToLeaflet({ x: b.x, y: b.y }, canvasHeight);
  // 18px stroke gives a ~9px hit zone on EACH SIDE of the segment centerline.
  // That covers "just inside" the polygon edge as well as just outside —
  // Captain smoke session 219 wave 5/6.
  //
  // Root cause of the original bug: polygon's interactive fill (fillOpacity
  // 0.4) intercepted hovers on the interior side. bringToFront alone wasn't
  // enough — the segments were in the CANVAS renderer (Leaflet2DManager
  // default) while the polygon uses a forced SVG renderer; canvas and svg
  // are different DOM elements, so bringToFront couldn't promote segments
  // above the polygon. Fix: force segments into SVG via `renderer:`
  // explicitly. Now bringToFront moves segments above the polygon in the
  // shared SVG context where it actually matters for hit-testing.
  //
  // Visible weight smaller (was 32, Captain "highlight visuals slightly
  // smaller"). Hover opacity bumped 0.3 → 0.4 since the stripe is thinner.
  // Share the EXACT renderer that ZoneOverlay uses for the polygon. Same SVG
  // element = bringToFront() can move segments above the polygon at the
  // per-path level. Different renderers (even both SVG) would land in
  // separate <svg> elements in overlayPane, and bringToFront would only
  // reorder within each.
  const map = active ? mapTabCache.get(active.mapId)?.manager.getMap() ?? null : null;
  const renderer = map ? getZoneSvgRendererForMap(map) : undefined;
  const segment = L.polyline([aLatLng, bLatLng], {
    color: '#22d3ee',
    weight: 18,
    opacity: 0.01,
    interactive: true,
    dashArray: '6, 6',
    className: 'atlas-zone-edit-segment',
    renderer,
  });

  segment.on('mouseover', () => {
    segment.setStyle({ opacity: 0.4 });
  });
  segment.on('mouseout', () => {
    segment.setStyle({ opacity: 0.01 });
  });

  // Click → insert marker at the midpoint of a→b. Renumber-all
  // subsequent orders so the new marker slots in between a and b.
  segment.on('click', async (e) => {
    L.DomEvent.stop(e);
    await insertMarkerOnSegment(segmentIndex);
  });

  void segmentIndex; // referenced via closure
  return segment;
}

async function insertMarkerOnSegment(segmentIndex: number): Promise<void> {
  if (!active) return;
  const store = getActiveStore();
  if (!store) return;
  const state = getState();
  const { markers } = partitionZonesAndMarkers(state.data.elements);
  const zoneMarkers = markersForZoneOnMap(active.zoneId, active.mapId, markers);

  // segmentIndex i goes from marker[i] to marker[(i+1) % len]. Order values
  // are planned by the kernel, which renumbers by POSITION — the old
  // index-as-order arithmetic put the vertex on the wrong segment whenever
  // orders were non-contiguous, and always appended on imported zones where
  // every order is absent (S307).
  const a = zoneMarkers[segmentIndex];
  const b = zoneMarkers[(segmentIndex + 1) % zoneMarkers.length];
  if (!a || !b) return;
  const plan = computeInsertion(zoneMarkers, segmentIndex);
  if (!plan) return;

  const midX = Math.round((a.x + b.x) / 2);
  const midY = Math.round((a.y + b.y) / 2);
  await optimisticInsertMarker({ x: midX, y: midY, order: plan.newOrder, plan, zoneMarkers });
}

/**
 * Optimistic marker insertion (session 219). Updates `state.data.elements`
 * synchronously so the UI shows the new marker + bumped neighbors
 * immediately, then fires the FS Access store writes in the background. With
 * 5+ siblings to renumber, the N sequential FS writes used to take ~1s of
 * visible lag — Captain: "if i place a marker for existing zone during edit,
 * it takes a second to appear." This path makes the UI feel instant.
 *
 * Mints a client UUID for the new marker so the optimistic state and the
 * subsequent createMarker call agree on id. On store failure, re-prime from
 * disk + rebuildHandles to roll back.
 */
async function optimisticInsertMarker(args: {
  x: number;
  y: number;
  order: number;
  /** Order plan from `computeInsertion` — position-based, not index-as-order. */
  plan: { newOrder: number; updates: Array<{ id: string; order: number }> };
  zoneMarkers: Marker[];
}): Promise<void> {
  if (!active) return;
  const store = getActiveStore();
  if (!store) return;
  const { x, y, order: newOrder, plan } = args;

  const newId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  // Build the optimistic next element set from the PLAN. Each affected
  // marker gets its planned absolute order — not a blanket +1 on everything
  // at or after a number, which is what put vertices on the wrong segment
  // when orders were non-contiguous (S307).
  const plannedOrder = new Map(plan.updates.map(u => [u.id, u.order]));
  const state = getState();
  const nextElements = state.data.elements.map(e => {
    if (plannedOrder.has(e.id)) {
      const m = e as Marker;
      return { ...m, order: plannedOrder.get(m.id)!, local_updated_at: nowIso } as Marker;
    }
    return e;
  });
  const newMarker: Marker = {
    id: newId,
    type: 'marker',
    name: '',
    map_id: active.mapId,
    zone_id: active.zoneId,
    x,
    y,
    order: newOrder,
    local_updated_at: nowIso,
  } as Marker;
  nextElements.push(newMarker);

  // FLIP UI now. State subscribers fire → ZoneOverlay.updateZone re-renders
  // the polygon with the new vertex; rebuildHandles below puts a draggable
  // handle at the new spot. From the user's perspective: instant.
  patchSlice('data', { elements: nextElements });
  rebuildHandles();

  // Background: persist to FolderStore. Failures revert by re-priming from disk.
  try {
    // Descending by TARGET order so a renumber never transiently collides
    // with a slot it is about to vacate.
    const writes = [...plan.updates].sort((p, q) => q.order - p.order);
    for (const u of writes) {
      await store.updateMarker(u.id, { order: u.order });
    }
    await store.createMarker({
      id: newId,
      name: '',
      map_id: active.mapId,
      zone_id: active.zoneId,
      x,
      y,
      order: newOrder,
    });
    // Reconcile state with disk for the canonical timestamps + any drift.
    const fresh = await store.listElements();
    patchSlice('data', { elements: fresh });
    requestPushIfLinked();
    rebuildHandles();
  } catch (err) {
    console.error('[zone-edit] optimistic insert background-write failed:', err);
    active?.toasts.error('Failed to insert marker; reverting');
    // Re-prime from disk (truth) and re-render handles.
    try {
      const fresh = await store.listElements();
      patchSlice('data', { elements: fresh });
      rebuildHandles();
    } catch {
      /* if even the re-prime fails, leave the UI as-is; reload will recover */
    }
  }
}

async function deleteMarkerInEdit(markerId: string): Promise<void> {
  if (!active) return;
  const store = getActiveStore();
  if (!store) return;
  // Don't allow deleting below shape minimum (3 polygon, 2 line). Refuse
  // and toast — user must cancel-edit + delete-zone if they want zero markers.
  const state = getState();
  const { markers } = partitionZonesAndMarkers(state.data.elements);
  const zoneMarkers = markersForZoneOnMap(active.zoneId, active.mapId, markers);
  const zone = state.data.elements.find(
    (e): e is Zone => e.type === 'zone' && e.id === active!.zoneId,
  );
  const isPolygon = getZoneShape(zone) === 'polygon';
  const min = isPolygon ? 3 : 2;
  if (zoneMarkers.length <= min) {
    active.toasts.info(`${isPolygon ? 'Polygon' : 'Line'} needs at least ${min} markers`);
    return;
  }
  try {
    await store.deleteMarker(markerId);
    // Renumber remaining markers to close the gap.
    const remaining = zoneMarkers.filter(m => m.id !== markerId);
    for (let i = 0; i < remaining.length; i++) {
      if ((remaining[i].order ?? 0) !== i) {
        await store.updateMarker(remaining[i].id, { order: i });
      }
    }
    const elements = await refreshElementsAfterWrite(store);
    rebuildHandles();
  } catch (err) {
    console.error('[zone-edit] delete marker failed:', err);
    active.toasts.error('Failed to delete marker');
  }
}

export function exitEditMode(mode: 'commit' | 'cancel'): void {
  if (!active) return;
  const session = active;
  active = null;

  // Cancel: restore from snapshot (3-way diff), THEN drop the safety net.
  // Until S307 the clear ran immediately while `restoreFromSnapshot` was
  // still awaiting its per-marker writes, so a refresh or crash mid-restore
  // left the zone half-reverted with NO recovery record — precisely the
  // failure the persisted snapshot exists to prevent.
  if (mode === 'cancel') {
    void restoreFromSnapshot(session).finally(() => {
      clearPersistedSnapshot(session.worldId);
    });
  } else if (session.worldId) {
    clearPersistedSnapshot(session.worldId);
  }

  // Tear down primitives.
  try {
    const entry = mapTabCache.get(session.mapId);
    if (entry) {
      entry.container.classList.remove('atlas-zone-editing');
      const lMap = entry.manager.getMap();
      if (lMap) {
        lMap.removeLayer(session.layerGroup);
        // Restore default dblclick zoom if it was on before.
        if (session.defaultDoubleClickZoom) lMap.doubleClickZoom.enable();
      }
      // Unsuppress the ZoneOverlay's read-only vertex dots — they reappear
      // since the zone is still selected.
      entry.zoneOverlay?.setVertexDotsSuppressed(session.zoneId, false);
      // Flip outline back from dashed → solid (ZC6 reset on exit).
      entry.zoneOverlay?.setZoneEditing(session.zoneId, false);
    }
  } catch (err) {
    console.warn('[zone-edit] teardown error:', err);
  }
}

/**
 * Recovery sweep called on world activation. If a persisted snapshot exists
 * for the just-activated world, replay the revert via the same 3-way diff
 * path used by Cancel. Cleared after either success or failure (failure
 * surface: console warn; refusal to retry forever).
 *
 * Captain smoke session 219: "if I refresh page in edit mode; it seems to
 * store the changes, instead of reverting them, after reload."
 */
export async function recoverFromOrphanSnapshot(activatedWorldId: string, toasts?: ToastManager): Promise<boolean> {
  const persisted = readPersistedSnapshot(activatedWorldId);
  // Returns whether a recovery was ATTEMPTED — the caller re-primes the
  // elements cache only then (speed bout 2026-07-19: the unconditional
  // re-prime cost a full disk walk on every normal activation).
  if (!persisted) return false;
  // Build a temporary session shape just enough for restoreFromSnapshot.
  const fakeSession: EditSession = {
    zoneId: persisted.zoneId,
    mapId: persisted.mapId,
    // The world being ACTIVATED is the one this snapshot belongs to — that is
    // how it was looked up.
    worldId: activatedWorldId,
    snapshot: persisted.snapshot,
    layerGroup: L.layerGroup(), // unused in restore path
    vertexMarkers: new Map(),
    segmentOverlays: [],
    centroidHandle: null,
    centroidDragStart: null,
    toasts: toasts ?? ({ info: () => {}, success: () => {}, error: () => {}, warn: () => {} } as unknown as ToastManager),
    defaultDoubleClickZoom: false,
  };
  try {
    await restoreFromSnapshot(fakeSession);
    toasts?.info('Reverted unsaved zone edits from previous session');
  } catch (err) {
    console.warn('[zone-edit] orphan-snapshot recovery failed:', err);
  } finally {
    clearPersistedSnapshot(activatedWorldId);
  }
  return true;
}

async function restoreFromSnapshot(session: EditSession): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  const state = getState();
  const { markers } = partitionZonesAndMarkers(state.data.elements);
  const currentForZone = markersForZoneOnMap(session.zoneId, session.mapId, markers);

  const snapById = new Map(session.snapshot.map(s => [s.id, s]));
  const currentById = new Map(currentForZone.map(m => [m.id, m]));

  try {
    // 1) Markers in current but NOT in snapshot — were added during edit; delete.
    for (const [id, _m] of currentById) {
      if (!snapById.has(id)) {
        await store.deleteMarker(id);
      }
    }
    // 2) Markers in snapshot but NOT in current — were deleted during edit; recreate.
    for (const [id, snap] of snapById) {
      if (!currentById.has(id)) {
        await store.createMarker({
          id,
          name: '',
          map_id: session.mapId,
          zone_id: session.zoneId,
          x: snap.x,
          y: snap.y,
          order: snap.order,
        });
      }
    }
    // 3) Markers in both — revert position/order if changed.
    for (const [id, snap] of snapById) {
      const cur = currentById.get(id);
      if (!cur) continue;
      const patch: Partial<Marker> = {};
      if (cur.x !== snap.x) patch.x = snap.x;
      if (cur.y !== snap.y) patch.y = snap.y;
      if ((cur.order ?? 0) !== snap.order) patch.order = snap.order;
      if (Object.keys(patch).length > 0) {
        await store.updateMarker(id, patch);
      }
    }
    const elements = await refreshElementsAfterWrite(store);
    session.toasts.info('Edit cancelled');
  } catch (err) {
    console.error('[zone-edit] restore from snapshot failed:', err);
    session.toasts.error('Failed to fully restore; manual cleanup may be needed');
  }
}

/**
 * Called by the global subscribe loop when elements OR selection change.
 *
 * Two exit triggers handled here:
 *   1. The edited zone was deleted from elsewhere → exit silently.
 *   2. Selection moved to a different element (any element type, anywhere —
 *      chip strip, sidebar, canvas, midpanel) → exit current edit cleanly.
 *      Edit state is a layer ON TOP of selection — when selection changes,
 *      edit dissolves. Re-entering edit on another zone requires an
 *      explicit gesture (dblclick or "Edit shape" button).
 */
export function syncEditMode(): void {
  if (!active) return;
  const state = getState();
  const zone = state.data.elements.find(e => e.id === active!.zoneId);
  if (!zone || zone.type !== 'zone') {
    exitEditMode('commit');
    return;
  }
  if (state.ui.selectedElementId !== active.zoneId) {
    // Selection moved away — commit cleanly (autosave persisted everything
    // already; cancel-via-restore is reserved for explicit ESC/Cancel).
    exitEditMode('commit');
  }
}

/**
 * Hook for disposeMapTab — end the session without restoring (the map tab is
 * going away).
 *
 * S307, DATA LOSS: this used to null `active` and nothing else, orphaning the
 * persisted snapshot. Its caller runs on WORLD SWITCH (disposeAllMapTabs), so
 * the everyday sequence was: edit a zone, drag two vertices (each autosaved to
 * disk), switch worlds. Nothing here was a cancel — the edits were committed
 * and the user believed they were done. On returning to that world,
 * `recoverFromOrphanSnapshot` replayed the 3-way diff and REVERTED both drags,
 * calling them "unsaved". There is no undo anywhere in atlas.
 *
 * A teardown is not a cancel: the work on disk stands, so the recovery record
 * must go with the session.
 */
export function abortEditModeForMap(mapId: string): void {
  if (!active || active.mapId !== mapId) return;
  if (active.worldId) clearPersistedSnapshot(active.worldId);
  active = null;
}

export function cancelEdit(): void {
  exitEditMode('cancel');
}

export function doneEdit(): void {
  exitEditMode('commit');
}
