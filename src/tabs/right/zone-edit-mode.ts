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
import { requestPushIfLinked } from '../../sync/sync-attach';
import { storageToLeaflet, leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import { findClosestSegment, polygonCentroid, polylineLabelAnchor, type Point } from '../../visualization/leaflet-2d/ZoneGeometry';
import { getZoneSvgRendererForMap } from '../../visualization/leaflet-2d/ZoneOverlay';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { markersForZoneOnMap, partitionZonesAndMarkers, getZoneShape } from './zone-derived';
import type { Marker, Zone } from '../../core/types';
import type { ToastManager } from '../../ui/toast-manager';

interface MarkerSnapshot {
  id: string;
  x: number;
  y: number;
  order: number;
}

interface EditSession {
  zoneId: string;
  mapId: string;
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

function clearPersistedSnapshot(worldId: string): void {
  const all = readSnapshotsByWorld();
  if (!(worldId in all)) return;
  delete all[worldId];
  writeSnapshotsByWorld(all);
}

/**
 * Module-level "just-dragged" guard. Vertex / centroid drag handlers set this
 * to `Date.now()` on dragstart and clear-by-timeout on dragend. The map-click
 * handler in map-tab.ts (via insertMarkerAtClick) checks `isMidDragSuppression()`
 * before inserting — without this, the mouseup that ENDS a drag can also fire
 * a map-click event (Leaflet's marker drag doesn't always swallow click
 * propagation), spawning a stray marker right under the drag-released handle.
 *
 * Captain smoke session 219: "sometimes ANOTHER marker gets created when I
 * move one. hard to recreate. but happens sometimes." The race window is
 * tiny but real.
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

/**
 * Click-anywhere-on-canvas insertion (ZC8). Called from map-tab.ts's map-click
 * handler when an edit session is active on this map AND the click did NOT
 * hit a segment overlay or vertex handle (those have their own listeners).
 *
 * Finds the nearest segment (polygon includes wrap segment; line does not),
 * inserts a marker AT the click point (not the projection foot — Captain
 * wants "places the marker exactly there"), and renumbers subsequent markers.
 */
export async function insertMarkerAtClick(clickPoint: Point): Promise<void> {
  if (!active) return;
  const store = getActiveStore();
  if (!store) return;
  const state = getState();
  const { markers } = partitionZonesAndMarkers(state.data.elements);
  const zoneMarkers = markersForZoneOnMap(active.zoneId, active.mapId, markers);
  if (zoneMarkers.length < 2) return;

  const zone = state.data.elements.find(
    (e): e is Zone => e.type === 'zone' && e.id === active!.zoneId,
  );
  const isPolygon = getZoneShape(zone) === 'polygon';

  const closest = findClosestSegment(
    clickPoint,
    zoneMarkers.map(m => ({ x: m.x, y: m.y })),
    isPolygon,
  );
  if (!closest) return;

  // Insert AT click point (rounded + clamped to canvas), with order =
  // segmentIndex + 1. Renumber bumps every existing marker with order ≥ that
  // by one. Same flow as segment-click midpoint insert, just with the click
  // point as the position.
  const entry = mapTabCache.get(active.mapId);
  const cfg = entry?.manager.getConfig();
  const w = cfg?.canvasWidth ?? 2000;
  const h = cfg?.canvasHeight ?? 2000;
  const x = clamp(Math.round(clickPoint.x), 0, w);
  const y = clamp(Math.round(clickPoint.y), 0, h);
  const newOrder = closest.index + 1;
  await optimisticInsertMarker({ x, y, order: newOrder, zoneMarkers });
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
    toasts.error('Cannot edit — map tab not open');
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
  const displayOrder = (marker.order ?? 0) + 1;
  const icon = L.divIcon({
    className: 'atlas-zone-edit-handle',
    html: `<span class="atlas-zone-edit-handle-num">${displayOrder}</span>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
  const handle = L.marker(latlng, {
    icon,
    draggable: true,
    keyboard: false,
  });

  // Drag handlers — dragstart blocks map clicks; drag is visual; dragend commits.
  let suppressClick = false;
  handle.on('dragstart', () => {
    suppressClick = true;
    markDragInProgress();
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
  });
  handle.on('dragend', async () => {
    setTimeout(() => { suppressClick = false; }, 50);
    markDragEnded();
    // Flush any pending rAF live-point update so the final position is the
    // committed one, not a stale-frame snapshot.
    cancelPendingLivePoints();
    const newLatLng = handle.getLatLng();
    const pt = leafletToStorage(newLatLng, canvasHeight);
    const x = Math.round(pt.x);
    const y = Math.round(pt.y);
    const store = getActiveStore();
    if (!store) return;
    try {
      await store.updateMarker(marker.id, { x, y });
      const elements = await store.listElements();
      patchSlice('data', { elements });
      requestPushIfLinked();
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
      const elements = await store.listElements();
      patchSlice('data', { elements });
      requestPushIfLinked();
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

  // segmentIndex i goes from marker[i] to marker[(i+1) % len]. The new
  // marker lands at order = i+1; every subsequent marker bumps up by 1.
  const insertAfterIndex = segmentIndex;
  const a = zoneMarkers[insertAfterIndex];
  const b = zoneMarkers[(insertAfterIndex + 1) % zoneMarkers.length];
  if (!a || !b) return;

  const midX = Math.round((a.x + b.x) / 2);
  const midY = Math.round((a.y + b.y) / 2);
  const newOrder = insertAfterIndex + 1;
  await optimisticInsertMarker({ x: midX, y: midY, order: newOrder, zoneMarkers });
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
  zoneMarkers: Marker[];
}): Promise<void> {
  if (!active) return;
  const store = getActiveStore();
  if (!store) return;
  const { x, y, order: newOrder, zoneMarkers } = args;

  const newId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  // Build the optimistic next element set.
  // - Every marker with current order >= newOrder gets bumped by 1
  // - The new marker is inserted with the chosen order
  // Use a Set lookup so other-zone markers + non-marker elements are passed
  // through untouched.
  const bumpIds = new Set(
    zoneMarkers.filter(m => (m.order ?? 0) >= newOrder).map(m => m.id),
  );
  const state = getState();
  const nextElements = state.data.elements.map(e => {
    if (bumpIds.has(e.id)) {
      const m = e as Marker;
      return { ...m, order: (m.order ?? 0) + 1, local_updated_at: nowIso } as Marker;
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
    const bumps = zoneMarkers.filter(m => bumpIds.has(m.id));
    // Work in reverse so we don't collide with ourselves on disk.
    bumps.sort((p, q) => (q.order ?? 0) - (p.order ?? 0));
    for (const m of bumps) {
      await store.updateMarker(m.id, { order: (m.order ?? 0) + 1 });
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
    active?.toasts.error('Failed to insert marker — reverting');
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
    const elements = await store.listElements();
    patchSlice('data', { elements });
    requestPushIfLinked();
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

  // Cancel: restore from snapshot (3-way diff).
  if (mode === 'cancel') {
    void restoreFromSnapshot(session);
  }

  // Persisted snapshot is no longer needed — both commit and cancel
  // resolve the in-flight edit. Clear under the world this session belonged
  // to (snapshots are now keyed per-world; multi-world edits don't clobber).
  const finishingWorldId = getState().active?.worldId;
  if (finishingWorldId) clearPersistedSnapshot(finishingWorldId);

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
export async function recoverFromOrphanSnapshot(activatedWorldId: string, toasts?: ToastManager): Promise<void> {
  const persisted = readPersistedSnapshot(activatedWorldId);
  if (!persisted) return;
  // Build a temporary session shape just enough for restoreFromSnapshot.
  const fakeSession: EditSession = {
    zoneId: persisted.zoneId,
    mapId: persisted.mapId,
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
    const elements = await store.listElements();
    patchSlice('data', { elements });
    requestPushIfLinked();
    session.toasts.info('Edit cancelled');
  } catch (err) {
    console.error('[zone-edit] restore from snapshot failed:', err);
    session.toasts.error('Failed to fully restore — manual cleanup may be needed');
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

/** Hook for disposeMapTab — cancel without restore (map's gone anyway). */
export function abortEditModeForMap(mapId: string): void {
  if (!active || active.mapId !== mapId) return;
  // Skip restoreFromSnapshot since the map tab is being torn down.
  active = null;
}

export function cancelEdit(): void {
  exitEditMode('cancel');
}

export function doneEdit(): void {
  exitEditMode('commit');
}
