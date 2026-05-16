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
import { getActiveStore } from '../../ui/create-world-modal';
import { requestPushIfLinked } from '../../sync/sync-attach';
import { storageToLeaflet } from '../../visualization/leaflet-2d/CoordinateUtils';
import { snapToAxis, type Point } from '../../visualization/leaflet-2d/ZoneGeometry';
import { clampToCanvas } from './map-tab-pin-drag';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { buildDrawingOverlay, type DrawingOverlayRefs } from './zone-drawing-overlay';
import type { Zone } from '../../core/types';
import type { ToastManager } from '../../ui/toast-manager';

export type DrawMode = 'polygon' | 'line';

interface ActiveDraft {
  mode: DrawMode;
  mapId: string;
  worldId: string;
  points: Point[];
  previewLayer: L.LayerGroup;
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
    if (e.key === 'Escape') cancelDrawing();
    if (e.key === 'Shift') shiftHeld = true;
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Shift') shiftHeld = false;
  });
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
 * Map must have an image (pins/markers anchor to image coords — same gate
 * as pin placement per DESIGN_MAPS.md §4.1).
 */
export function startDrawing(entry: MapTabCacheEntry, mode: DrawMode, toasts: ToastManager): void {
  ensureKeyListeners();
  cancelDrawing(); // clear any stale draft

  const state = getState();
  const map = state.data.elements.find(e => e.type === 'map' && e.id === entry.mapId);
  if (!map || (!(map as { image_url?: string }).image_url && !(map as { image_media_id?: string }).image_media_id)) {
    toasts.info('set a map image first — zones anchor to the image');
    return;
  }

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

/** Called from map-tab.ts on every map click while drafting. */
export function placeMarkerAt(rawPoint: Point, canvasWidth: number, canvasHeight: number): void {
  if (!active) return;

  let point: Point = {
    x: clampToCanvas(Math.round(rawPoint.x), canvasWidth),
    y: clampToCanvas(Math.round(rawPoint.y), canvasHeight),
  };

  // Shift-snap: when shift is held and we have a prior marker, snap to the
  // nearest 45° axis from the last point (DESIGN_ZONES.md §2.4).
  if (shiftHeld && active.points.length >= 1) {
    const anchor = active.points[active.points.length - 1];
    point = snapToAxis(anchor, point);
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
    draft.toasts.info(`${draft.mode} needs at least ${min} markers`);
    return;
  }

  const store = getActiveStore();
  if (!store) {
    draft.toasts.error('no active world store — cannot save zone');
    return;
  }

  try {
    // Auto-numbered name: "new zone" / "new line" with numbering if taken.
    const zones = (getState().data.elements.filter(e => e.type === 'zone') as Zone[]);
    const baseName = draft.mode === 'polygon' ? 'new zone' : 'new line';
    const name = findUniqueZoneName(baseName, zones);

    // 1. Create the zone (pure metadata, no map_id).
    const zone = await store.createZone({
      name,
      supertype: draft.mode,
    });

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
    const elements = await store.listElements();
    patchSlice('data', { elements });
    requestPushIfLinked();

    draft.toasts.success(`${draft.mode} created: ${name}`);

    // 4. Select the new zone so the user lands in element-detail.
    patchSlice('ui', { ...getState().ui, selectedElementId: zone.id });
  } catch (err) {
    console.error('[zone-drawing] finish failed:', err);
    draft.toasts.error(`failed to save ${draft.mode}`);
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

  // Render numbered marker DivIcons at each point.
  active.points.forEach((p, idx) => {
    const latlng = storageToLeaflet(p, canvasHeight);
    const icon = L.divIcon({
      className: 'atlas-zone-draft-marker',
      html: `<span class="atlas-zone-draft-marker-num">${idx + 1}</span>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });
    L.marker(latlng, { icon, interactive: false, keyboard: false }).addTo(active!.previewLayer);
  });

  // Render preview path (dashed cyan).
  if (active.points.length >= 2) {
    const latLngs = active.points.map(p => storageToLeaflet(p, canvasHeight));
    if (active.mode === 'polygon' && active.points.length >= 3) {
      L.polygon(latLngs, {
        color: '#22d3ee',
        weight: 2,
        opacity: 0.9,
        dashArray: '5, 5',
        fillColor: '#22d3ee',
        fillOpacity: 0.12,
      }).addTo(active.previewLayer);
    } else {
      L.polyline(latLngs, {
        color: '#22d3ee',
        weight: 2,
        opacity: 0.9,
        dashArray: '5, 5',
      }).addTo(active.previewLayer);
    }
  }
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
