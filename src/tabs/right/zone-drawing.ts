/**
 * Zone drawing — transient draft state, canvas preview, and finish/cancel
 * lifecycle (DESIGN_ZONES.md §2).
 *
 * Module-level singleton state — only one zone can be in-draft across the
 * whole atlas at a time. Switching maps or worlds cancels the draft.
 *
 * Public surface:
 *   - startDrawing(entry, mode) — enter draft mode for this map
 *   - placeMarkerAt(point, opts) — append a marker (called by map-click)
 *   - undoLastMarker() — pop the latest marker
 *   - finishDrawing(toasts) — persist a Zone + N Markers, exit draft
 *   - cancelDrawing() — discard, exit draft
 *   - isDrawing() / getActiveDraft() — accessors
 *   - disposeDraftForMap(mapId) — clean up if a tab is being torn down
 *
 * Canvas rendering: a dedicated L.LayerGroup for the preview polyline +
 * numbered marker DivIcons. Pure-styled via CSS class names.
 */

import L from 'leaflet';
import { getState, patchSlice } from '../../core/state';
import { getActiveStore } from '../../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import { storageToLeaflet, leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import { snapToAxis, findClosestSegment, type Point } from '../../visualization/leaflet-2d/ZoneGeometry';
import { clampToCanvas } from './map-tab-pin-drag';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { buildDrawingOverlay, type DrawingOverlayRefs } from './zone-drawing-overlay';
import { navigate, elementHash } from '../../core/router';
import { openZoneCreateModal } from '../../ui/zone-create-modal';
import type { Zone } from '../../core/types';
import type { ToastManager } from '../../ui/toast-manager';

export type DrawMode = 'polygon' | 'line';

interface ActiveDraft {
  mode: DrawMode;
  mapId: string;
  worldId: string;
  points: Point[];
  previewLayer: L.LayerGroup;
  /**
   * The polyline/polygon path layer, tracked separately from markers so
   * `rebuildPreviewPath()` can swap just the path without disturbing the
   * marker DOM (critical during a live drag — re-adding markers would
   * abort the in-progress drag). Typed as L.Layer because @types/leaflet
   * parameterizes Polyline/Polygon with incompatible GeoJSON geometry
   * generics — the common ancestor is L.Layer.
   */
  pathLayer: L.Layer | null;
  overlay: DrawingOverlayRefs;
  toasts: ToastManager;
  // For cleanup on cancel/finish.
  containerListeners: Array<{ el: HTMLElement; type: string; handler: EventListener }>;
}

let active: ActiveDraft | null = null;
let shiftHeld = false;

// Global keyboard listeners — installed lazily on first draft.
let keyListenersInstalled = false;

function ensureKeyListeners(): void {
  if (keyListenersInstalled) return;
  keyListenersInstalled = true;
  document.addEventListener('keydown', e => {
    if (!active) return;
    // Shift is a modifier — always track its state, regardless of focus target.
    // Enter/Escape are commands and should NOT hijack input typing.
    if (e.key === 'Shift') {
      shiftHeld = true;
      updateShiftIndicator(true);
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelDrawing();
      return;
    }
    if (e.key === 'Enter') {
      // Enter finishes the draft when it has ≥min markers; below the
      // threshold the draft overlay's finish-disabled state already telegraphs
      // why nothing happens. finishDrawing internally re-checks the minimum
      // and toasts, so this is safe to call unconditionally.
      e.preventDefault();
      if (active.toasts) void finishDrawing(active.toasts);
      return;
    }
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Shift') {
      shiftHeld = false;
      updateShiftIndicator(false);
    }
  });
}

/**
 * Live indicator in the draft overlay so the user can SEE that shift is
 * registered (ZC3 — Captain couldn't tell shift-snap was active). Toggles a
 * class on the overlay's hint span; CSS turns it cyan + bold when held.
 */
function updateShiftIndicator(held: boolean): void {
  if (!active) return;
  active.overlay.root.classList.toggle('shift-held', held);
}

export function isDrawing(): boolean {
  return active !== null;
}

export function getActiveDraft(): { mode: DrawMode; mapId: string; markerCount: number } | null {
  if (!active) return null;
  return { mode: active.mode, mapId: active.mapId, markerCount: active.points.length };
}

/**
 * Enter draft mode. Cancels any in-progress draft first (one global slot).
 * Works on imageless maps too — the flat canvas has stored width/height, so
 * marker coords anchor to a stable space (DESIGN_MAPS.md §4.2, S300).
 */
export function startDrawing(entry: MapTabCacheEntry, mode: DrawMode, toasts: ToastManager): void {
  ensureKeyListeners();
  cancelDrawing(); // clear any stale draft

  const lMap = entry.manager.getMap();
  if (!lMap) return;

  const previewLayer = L.layerGroup().addTo(lMap);

  const overlay = buildDrawingOverlay(mode, {
    onUndo: undoLastMarker,
    onFinish: () => finishDrawing(toasts),
    onCancel: cancelDrawing,
  });
  entry.wrapper.appendChild(overlay.root);

  active = {
    mode,
    mapId: entry.mapId,
    worldId: entry.worldId,
    points: [],
    previewLayer,
    pathLayer: null,
    overlay,
    toasts,
    containerListeners: [],
  };

  // Cursor cue: crosshair while drawing.
  entry.container.style.cursor = 'crosshair';

  // Toolbar active-state cue: paint the active draw button.
  const btnSelector = mode === 'polygon' ? 'draw-polygon' : 'draw-line';
  entry.toolbar.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(b => {
    const isMine = b.getAttribute('data-action') === btnSelector;
    b.classList.toggle('is-active', isMine);
  });

  refreshOverlay();
}

/**
 * Distance threshold (storage-space units) within which a create-mode click
 * is treated as an INSERT-BETWEEN-EXISTING-MARKERS instead of an append-to-
 * end. Picked roughly to match a comfortable click target for a 2px polygon
 * outline at typical zoom levels. ZD5: ports edit-mode's segment-insert
 * shape preservation into create mode.
 */
const CREATE_INSERT_THRESHOLD = 20;

/** Called from map-tab.ts on every map click while drafting. */
export function placeMarkerAt(rawPoint: Point, canvasWidth: number, canvasHeight: number): void {
  if (!active) return;

  let point: Point = {
    x: clampToCanvas(Math.round(rawPoint.x), canvasWidth),
    y: clampToCanvas(Math.round(rawPoint.y), canvasHeight),
  };

  // Shift-snap: when shift is held and we have a prior marker, snap to the
  // nearest 45° axis from the last point (DESIGN_ZONES.md §2.4). Snap is
  // computed BEFORE the insert-vs-append decision so snapped points still
  // get the shape-preserving treatment.
  if (shiftHeld && active.points.length >= 1) {
    const anchor = active.points[active.points.length - 1];
    point = snapToAxis(anchor, point);
  }

  // ZD5: shape-preserving insertion. If we already have ≥2 markers AND the
  // click lands near an existing segment, splice the new marker between the
  // segment's endpoints instead of appending to the end. Mirrors edit-mode's
  // segment-click behavior so create-mode polygons stay tidy when the user
  // realizes mid-draw that they need a marker between earlier ones.
  //
  // Polygon includes the wrap segment (last→first) for the threshold check
  // ONCE a polygon outline exists (3+ markers). Lines never wrap.
  if (active.points.length >= 2) {
    const isPolygon = active.mode === 'polygon' && active.points.length >= 3;
    const closest = findClosestSegment(point, active.points, isPolygon);
    if (closest && closest.distance <= CREATE_INSERT_THRESHOLD) {
      // Insert at segmentIndex + 1 — splice into the array, no need for
      // explicit `order` writes since create-mode order is just the array
      // index (zone+markers are written in one batch on Finish, indexed 0..N).
      active.points.splice(closest.index + 1, 0, point);
      rerenderPreview();
      refreshOverlay();
      return;
    }
  }

  active.points.push(point);
  rerenderPreview();
  refreshOverlay();
}

export function undoLastMarker(): void {
  if (!active || active.points.length === 0) return;
  active.points.pop();
  rerenderPreview();
  refreshOverlay();
}

export async function finishDrawing(_toasts: ToastManager): Promise<void> {
  if (!active) return;
  const draft = active;
  const min = draft.mode === 'polygon' ? 3 : 2;
  if (draft.points.length < min) {
    draft.toasts.info(`${draft.mode.charAt(0).toUpperCase()}${draft.mode.slice(1)} needs at least ${min} markers`);
    return;
  }

  // ZC10 + ZD6: open the zone-create modal. Captures name + supertype text +
  // subtype text up front. Shape (polygon/line) is locked from draft mode —
  // not user-pickable in the modal — and stored in the local-only
  // `atlas_shape` extension field (ZD6). OW's `supertype` is now free
  // user-meaningful taxonomy text instead of being misused for shape.
  const zones = (getState().data.elements.filter(e => e.type === 'zone') as Zone[]);
  const baseName = draft.mode === 'polygon' ? 'New zone' : 'New line';
  const defaultName = findUniqueZoneName(baseName, zones);
  const values = await openZoneCreateModal({
    shape: draft.mode,
    defaultName,
  });
  if (!values) return; // user cancelled the modal — keep draft active

  // Guard: the draft might have been disposed while the modal was open
  // (world switch, map close, etc). Re-check active.
  if (!active || active !== draft) return;

  const store = getActiveStore();
  if (!store) {
    draft.toasts.error('No active world store; cannot save zone');
    return;
  }

  try {
    // Create the zone. atlas_shape locks the geometry kind; supertype +
    // subtype are user-meaningful taxonomy fields (free text).
    const zone = await store.createZone({
      name: values.name,
      supertype: values.supertype,
      subtype: values.subtype,
      atlas_shape: draft.mode,
    } as Partial<Zone>);

    // 2. Create N markers in order, all pointing at this zone + this map.
    for (let i = 0; i < draft.points.length; i++) {
      const p = draft.points[i];
      await store.createMarker({
        name: '',
        map_id: draft.mapId,
        zone_id: zone.id,
        x: p.x,
        y: p.y,
        order: i,
      });
    }

    // 3. Refresh element cache + sync.
    const elements = await refreshElementsAfterWrite(store);

    draft.toasts.success(`${draft.mode.charAt(0).toUpperCase()}${draft.mode.slice(1)} created: ${values.name}`);

    // 4. Select the new zone + navigate to its element-detail. No inline
    // rename prompt — modal already captured the name.
    patchSlice('ui', { ...getState().ui, selectedElementId: zone.id });
    const worldId = getState().active?.worldId;
    if (worldId) {
      navigate(elementHash(worldId, zone.id));
    }
  } catch (err) {
    console.error('[zone-drawing] finish failed:', err);
    draft.toasts.error(`Failed to save ${draft.mode}`);
    return; // keep draft active so user can retry
  }

  teardown(draft);
  active = null;
}

export function cancelDrawing(): void {
  if (!active) return;
  teardown(active);
  active = null;
}

/**
 * Called when a map tab is being disposed. If the active draft is on this
 * map, cancel cleanly.
 */
export function disposeDraftForMap(mapId: string): void {
  if (active && active.mapId === mapId) cancelDrawing();
}

// ----- internals -----

function teardown(draft: ActiveDraft): void {
  try { draft.previewLayer.clearLayers(); } catch { /* noop */ }
  try {
    const entry = mapTabCache.get(draft.mapId);
    const lMap = entry?.manager.getMap();
    if (lMap) lMap.removeLayer(draft.previewLayer);
    if (entry) {
      entry.container.style.cursor = '';
      entry.toolbar.querySelectorAll<HTMLButtonElement>('button[data-action]').forEach(b => {
        b.classList.remove('is-active');
      });
    }
  } catch { /* noop */ }
  if (draft.overlay.root.parentElement) {
    draft.overlay.root.parentElement.removeChild(draft.overlay.root);
  }
}

function rerenderPreview(): void {
  if (!active) return;
  const entry = mapTabCache.get(active.mapId);
  if (!entry) return;
  const canvasHeight = entry.manager.getConfig().canvasHeight;

  active.previewLayer.clearLayers();
  active.pathLayer = null;

  // Render numbered marker DivIcons at each point. Draggable so the user can
  // reposition a placed marker before finishing (smoke fix 2026-05-16 session
  // 216 — Captain expected to be able to nudge a draft marker, not have to
  // undo + re-click). Drag-end writes back to `active.points[idx]`; the next
  // re-render keeps numbering and preview path in sync. Dragging is
  // intentionally NOT shift-snapped — shift-snap is a placement-time
  // affordance; for a drag-correction the user wants pixel control.
  const canvasWidth = entry.manager.getConfig().canvasWidth;
  active.points.forEach((p, idx) => {
    const latlng = storageToLeaflet(p, canvasHeight);
    const icon = L.divIcon({
      className: 'atlas-zone-draft-marker',
      html: `<span class="atlas-zone-draft-marker-num">${idx + 1}</span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    const marker = L.marker(latlng, {
      icon,
      draggable: true,
      keyboard: false,
    });
    marker.addTo(active!.previewLayer);
    // LIVE preview during drag (ZC2): rebuild the preview polyline/polygon on
    // every `drag` event so the outline follows the marker in real time. Drag
    // mutates `active.points[idx]` directly (cheap — same memory). On `dragend`
    // we clamp + round the final value (the live drag intentionally skips
    // clamping for fluidity; the canvas-wide bounds already constrain motion).
    // Placement-pipe map-click is naturally suppressed during a marker drag.
    marker.on('drag', () => {
      if (!active) return;
      const newLatLng = marker.getLatLng();
      const newPt = leafletToStorage(newLatLng, canvasHeight);
      active.points[idx] = { x: newPt.x, y: newPt.y };
      rebuildPreviewPath();
    });
    marker.on('dragend', () => {
      if (!active) return;
      const newLatLng = marker.getLatLng();
      const newPt = leafletToStorage(newLatLng, canvasHeight);
      active.points[idx] = {
        x: clampToCanvas(Math.round(newPt.x), canvasWidth),
        y: clampToCanvas(Math.round(newPt.y), canvasHeight),
      };
      // Full re-render snaps the marker to the rounded/clamped final position
      // and rebuilds the path against it.
      rerenderPreview();
    });
  });

  buildPreviewPath(canvasHeight);
}

/**
 * Rebuild ONLY the preview path layer (polygon/polyline) without touching the
 * marker DOM. Called from the live drag handler so the path follows the
 * dragging marker without aborting Leaflet's in-progress drag (which would
 * happen if we re-added the marker layers).
 */
function rebuildPreviewPath(): void {
  if (!active) return;
  const entry = mapTabCache.get(active.mapId);
  if (!entry) return;
  const canvasHeight = entry.manager.getConfig().canvasHeight;
  buildPreviewPath(canvasHeight);
}

// Lazy-init shared SVG renderer for draft paths. Leaflet's L.canvas() renderer
// (set as default in Leaflet2DManager init) has unreliable dashArray support
// for polygons — works for polyline strokes but not for polygon outlines.
// SVG renderer guarantees the dashed preview line stays dashed across all
// rebuilds (Captain smoke session 219: "after first moving a marker, the
// dotted lines turn whole"). One renderer instance is fine — Leaflet shares
// it across all layers added with this `renderer` option.
let draftSvgRenderer: L.Renderer | null = null;
function getDraftSvgRenderer(): L.Renderer {
  if (!draftSvgRenderer) draftSvgRenderer = L.svg({ pane: 'overlayPane' });
  return draftSvgRenderer;
}

function buildPreviewPath(canvasHeight: number): void {
  if (!active) return;
  // Remove the prior path layer if any. Markers are untouched.
  if (active.pathLayer) {
    try { active.previewLayer.removeLayer(active.pathLayer); } catch { /* noop */ }
    active.pathLayer = null;
  }
  if (active.points.length < 2) return;
  const latLngs = active.points.map(p => storageToLeaflet(p, canvasHeight));
  const renderer = getDraftSvgRenderer();
  if (active.mode === 'polygon' && active.points.length >= 3) {
    active.pathLayer = L.polygon(latLngs, {
      color: '#22d3ee',
      weight: 2,
      opacity: 0.9,
      dashArray: '5, 5',
      fillColor: '#22d3ee',
      fillOpacity: 0.12,
      renderer,
    });
  } else {
    active.pathLayer = L.polyline(latLngs, {
      color: '#22d3ee',
      weight: 2,
      opacity: 0.9,
      dashArray: '5, 5',
      renderer,
    });
  }
  active.pathLayer.addTo(active.previewLayer);
}

function refreshOverlay(): void {
  if (!active) return;
  const min = active.mode === 'polygon' ? 3 : 2;
  active.overlay.update(active.points.length, min);
}

/**
 * Find the first unused zone name in the "<base>" / "<base> (2)" / "<base> (3)"
 * series. Mirrors zoner's auto-numbering (DESIGN_ZONES.md §2.6).
 */
export function findUniqueZoneName(base: string, zones: Zone[]): string {
  const taken = new Set(zones.map(z => z.name));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`; // ridiculous fallback
}
