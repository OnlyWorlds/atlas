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
import { getActiveStore } from '../../ui/create-world-modal';
import { requestPushIfLinked } from '../../sync/sync-attach';
import { storageToLeaflet, leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { markersForZoneOnMap, partitionZonesAndMarkers } from './zone-derived';
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
  toasts: ToastManager;
  // Saved Leaflet defaults to restore on exit.
  defaultDoubleClickZoom: boolean;
}

let active: EditSession | null = null;
let escListenerInstalled = false;

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
    toasts.error('cannot edit — map tab not open');
    return;
  }
  const lMap = entry.manager.getMap();
  if (!lMap) return;

  const state = getState();
  const { markers } = partitionZonesAndMarkers(state.data.elements);
  const zoneMarkers = markersForZoneOnMap(zoneId, mapId, markers);

  if (zoneMarkers.length === 0) {
    toasts.info('zone has no markers on this map');
    return;
  }

  // Snapshot for cancel restoration.
  const snapshot: MarkerSnapshot[] = zoneMarkers.map(m => ({
    id: m.id,
    x: m.x,
    y: m.y,
    order: m.order ?? 0,
  }));

  // Suppress ZoneOverlay's read-only vertex dots — our own draggable handles
  // render in their place at the same coords. Polygon outline + selection
  // glow remain unchanged (zone is still selected throughout edit).
  entry.zoneOverlay?.setVertexDotsSuppressed(zoneId, true);

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
  const isPolygon = zone?.supertype === 'polygon';
  const segmentCount = isPolygon ? zoneMarkers.length : zoneMarkers.length - 1;
  for (let i = 0; i < segmentCount; i++) {
    const a = zoneMarkers[i];
    const b = zoneMarkers[(i + 1) % zoneMarkers.length];
    const overlay = buildSegmentOverlay(a, b, i, height);
    overlay.addTo(active.layerGroup);
    active.segmentOverlays.push(overlay);
  }
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
  });
  handle.on('dragend', async () => {
    setTimeout(() => { suppressClick = false; }, 50);
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
      active?.toasts.error('failed to move marker');
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

function buildSegmentOverlay(
  a: Marker,
  b: Marker,
  segmentIndex: number,
  canvasHeight: number,
): L.Polyline {
  const aLatLng = storageToLeaflet({ x: a.x, y: a.y }, canvasHeight);
  const bLatLng = storageToLeaflet({ x: b.x, y: b.y }, canvasHeight);
  const segment = L.polyline([aLatLng, bLatLng], {
    color: '#22d3ee',
    weight: 20,
    opacity: 0,
    interactive: true,
    dashArray: '6, 6',
    className: 'atlas-zone-edit-segment',
  });

  segment.on('mouseover', () => {
    segment.setStyle({ opacity: 0.3 });
  });
  segment.on('mouseout', () => {
    segment.setStyle({ opacity: 0 });
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

  try {
    // First bump every marker whose current order >= newOrder up by one.
    // Work in REVERSE order so we don't collide with ourselves mid-loop.
    const bumps = zoneMarkers.filter(m => (m.order ?? 0) >= newOrder);
    bumps.sort((x, y) => (y.order ?? 0) - (x.order ?? 0));
    for (const m of bumps) {
      await store.updateMarker(m.id, { order: (m.order ?? 0) + 1 });
    }
    // Then create the new marker at the midpoint.
    await store.createMarker({
      name: '',
      map_id: active.mapId,
      zone_id: active.zoneId,
      x: midX,
      y: midY,
      order: newOrder,
    });
    const elements = await store.listElements();
    patchSlice('data', { elements });
    requestPushIfLinked();
    rebuildHandles();
  } catch (err) {
    console.error('[zone-edit] insert marker failed:', err);
    active.toasts.error('failed to insert marker');
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
  const isPolygon = zone?.supertype === 'polygon';
  const min = isPolygon ? 3 : 2;
  if (zoneMarkers.length <= min) {
    active.toasts.info(`${isPolygon ? 'polygon' : 'line'} needs at least ${min} markers`);
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
    active.toasts.error('failed to delete marker');
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
    }
  } catch (err) {
    console.warn('[zone-edit] teardown error:', err);
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
    session.toasts.info('edit cancelled');
  } catch (err) {
    console.error('[zone-edit] restore from snapshot failed:', err);
    session.toasts.error('failed to fully restore — manual cleanup may be needed');
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
