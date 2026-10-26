/**
 * Pin drag + drag-to-delete trash zone behavior.
 *
 * Extracted from map-tab.ts. `enablePinDrag(entry, marker, pinId)` wires the
 * three Leaflet marker events (dragstart / drag / dragend) onto a pin marker:
 * - dragstart: reveal trash zone, hide hover tooltip (tooltip's mouseout
 *   never fires during a drag, so it would hang after delete otherwise)
 * - drag: live-update `data-hover` on trash zone as the marker passes over it
 * - dragend: drop on trash → deletePin; drop elsewhere → updatePin coords
 *
 * Also exports `clampToCanvas` — used by every pin-write path (placement-
 * banner click, contextual right-click, drag-drop from sidebar, drag-move).
 */

import { getState, patchSlice } from '../../core/state';
import { leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import { getActiveStore } from '../../core/active-store';
import { worldIsViewOnly } from '../../core/view-only';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import type { MapTabCacheEntry } from './map-tab-cache';
import { showProblem } from '../../ui/problem-fixes';

/**
 * Clamp a pin coord to [0, max]. Defense-in-depth alongside Leaflet's
 * maxBounds (DESIGN_MAPS.md §4.1) — guarantees no stored pin coord is
 * outside the map's canvas, regardless of where the click event actually
 * fired (Leaflet maxBounds restricts panning but isn't 100% reliable at
 * every zoom level and on all input devices).
 */
export function clampToCanvas(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

export function enablePinDrag(entry: MapTabCacheEntry, marker: any, pinId: string): void {
  // A view-only world's pins stay put: no move, no trash (conv. 149).
  if (worldIsViewOnly()) return;
  try {
    if (marker.dragging) marker.dragging.enable();
    else marker.options.draggable = true;
  } catch { /* noop */ }
  const height = entry.manager.getConfig().canvasHeight;

  // Reveal the trash drop-zone when drag starts; live-track hover so it
  // highlights as the user passes over it; on drop, decide between delete
  // (over zone) or move (anywhere else). Also hide the hover tooltip — if
  // the user starts a drag with the tooltip showing, no mouseout fires
  // during the drag and the tooltip would hang after delete (a smoke
  // note from Titus).
  marker.on('dragstart', () => {
    entry.trashZone.setAttribute('data-active', 'true');
    entry.trashZone.setAttribute('data-hover', 'false');
    entry.tooltip.style.display = 'none';
  });

  marker.on('drag', () => {
    if (entry.trashZone.getAttribute('data-active') !== 'true') return;
    const lMap = entry.manager.getMap();
    if (!lMap) return;
    const latlng = marker.getLatLng();
    const markerScreen = lMap.latLngToContainerPoint(latlng);
    entry.trashZone.setAttribute('data-hover', String(isInsideZone(entry, markerScreen)));
  });

  marker.on('dragend', async () => {
    const lMap = entry.manager.getMap();
    const latlng = marker.getLatLng();
    let droppedOnTrash = false;
    if (lMap) {
      const markerScreen = lMap.latLngToContainerPoint(latlng);
      droppedOnTrash = isInsideZone(entry, markerScreen);
    }
    // Always hide the zone — drag is over either way. Tooltip stays hidden
    // (the dragstart already cleared it); we keep it down here defensively
    // in case some marker variant skipped dragstart.
    entry.trashZone.setAttribute('data-active', 'false');
    entry.trashZone.setAttribute('data-hover', 'false');
    entry.tooltip.style.display = 'none';

    try {
      const store = getActiveStore();
      if (!store) return;

      if (droppedOnTrash) {
        await store.deletePin(pinId);
        const elements = await refreshElementsAfterWrite(store);
        // No toast — the visual zone + the disappearance of the marker are
        // the feedback. Could surface "pin deleted" via toastManager if
        // Titus wants extra confirmation, but the action is its own UX.
        return;
      }

      const point = leafletToStorage(latlng, height);
      const dragCanvasH = entry.manager.getConfig().canvasHeight;
      const dragCanvasW = entry.manager.getConfig().canvasWidth;
      await store.updatePin(pinId, {
        x: clampToCanvas(Math.round(point.x), dragCanvasW),
        y: clampToCanvas(Math.round(point.y), dragCanvasH),
      });
      const elements = await store.listElements();
      patchSlice('data', { elements });
      // Local write succeeded — schedule autosave. Without this, dragged pins
      // never propagate server-side until another folder edit triggers a push
      // (or the user manually clicks sync). Parity with map-click + contextual-
      // create handlers above.
      requestPushIfLinked();
    } catch (err) {
      console.error('[map-tab] pin drag persist failed:', err);
      // Was silent: the pin stayed where it was dropped though nothing was
      // saved.
      showProblem(err, { doing: droppedOnTrash ? 'deleting the pin' : 'moving the pin' });
    }
  });
}

/**
 * Check whether a marker's container-point lies inside the trash zone's
 * bounding rect. Both rects are relative to the map container (offsetParent),
 * so we read getBoundingClientRect on both and compare client coords.
 */
function isInsideZone(entry: MapTabCacheEntry, markerScreen: { x: number; y: number }): boolean {
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
