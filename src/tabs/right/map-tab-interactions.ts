/**
 * Map-tab interaction wiring — extracted from map-tab.ts (session 233 re-trim).
 *
 * Registers all the user-input handlers on a freshly-mounted map: leaflet
 * map/pin events (click, contextmenu, pin click/hover), the contextual
 * right-click create-pin flow, single-letter hotkeys, and drag-from-sidebar
 * drop. Construction + lifecycle (manager init, background, camera restore,
 * zone-overlay creation) stays in mountMapTab; this module is purely the
 * "wire the gestures" phase, called once after the overlay is mounted.
 *
 * Every handler closes over the deps object — the same variables it captured
 * inline before the extraction, so behavior is preserved by construction.
 */

import { getState, patchSlice } from '../../core/state';
import { getActiveStore } from '../../core/active-store';
import { completeWaypoint } from '../../core/waypoints';
import { navigate, elementHash } from '../../core/router';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import { leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import { Leaflet2DManager } from '../../visualization/leaflet-2d/Leaflet2DManager';
import type { Pin, WorldMap } from '../../core/types';
import { ToastManager } from '../../ui/toast-manager';
import { ElementCreateModal } from '../../ui/element-create-modal';
import { toggleGhostsAtSourcePin } from './ghost-pins';
import { buildPinTooltipHtml } from './map-tab-tooltip';
import { clampToCanvas } from './map-tab-pin-drag';
import type { MapTabCacheEntry } from './map-tab-cache';
import { startDrawing, placeMarkerAt, getActiveDraft, cancelDrawing } from './zone-drawing';
import { isEditing, getEditingMapId, isMidDragSuppression } from './zone-edit-mode';

export interface MapInteractionDeps {
  entry: MapTabCacheEntry;
  manager: Leaflet2DManager;
  container: HTMLElement;
  tooltip: HTMLElement;
  width: number;
  height: number;
  mapId: string;
  toasts: ToastManager;
}

export function wireMapInteractions(deps: MapInteractionDeps): void {
  const { entry, manager, container, tooltip, width, height, mapId, toasts } = deps;

  // Map click → if drawing mode is active, place a marker. Else if zone
  // edit mode is active on this map, insert a marker at the click point
  // (ZC8). Else if pin placement is active, drop a pin. Drawing wins first
  // (most recent gesture); edit insert comes next; pin placement last.
  manager.on('map-click', async (ev) => {
    const draft = getActiveDraft();
    if (draft && draft.mapId === mapId) {
      placeMarkerAt(ev.point, width, height);
      return;
    }
    // Edit-mode click on map background → deselect, which causes
    // syncEditMode (state subscriber) to commit + tear down the edit
    // session. Inserts on a segment now come exclusively from the segment
    // overlay's own click handler — clicking outside any segment means
    // "exit edit," matching the click-outside-to-deselect mental model.
    // (Pre-session-226: clicked anywhere → inserted near nearest segment.
    // That surprised users trying to deselect by clicking the canvas.)
    // Drag-suppression check still applies: the mouseup that ENDS a drag
    // can fire as a map-click; swallow it so dragging doesn't accidentally
    // deselect.
    if (isEditing() && getEditingMapId() === mapId) {
      if (isMidDragSuppression()) return;
      const ui = getState().ui;
      if (ui.selectedElementId) {
        patchSlice('ui', { ...ui, selectedElementId: null });
      }
      return;
    }
    const placement = getState().ui.pinPlacement;
    if (!placement) return;
    // Gate: pin placement requires a map image (DESIGN_MAPS.md §4.1).
    const currentMap = getState().data.elements.find(
      (e): e is WorldMap => e.type === 'map' && e.id === entry.mapId,
    );
    if (!currentMap || (!currentMap.image_url && !currentMap.image_media_id)) {
      toasts.info('Set a map image first — pins anchor to the image');
      return;
    }
    try {
      const store = getActiveStore();
      if (!store) return;
      // Resolve element_type from the pinned element. The OW server rejects
      // pin CREATE with 400 ("element_type must be provided when element_id
      // is specified") if this field is absent. Look it up from state cache;
      // fall back to a store read if not cached.
      const cached = getState().data.elements.find(e => e.id === placement.elementId);
      const pinned = cached ?? await store.getElement(placement.elementId);
      if (!pinned) {
        toasts.error('Cannot place pin — element not found');
        return;
      }
      await store.createPin({
        map_id: entry.mapId,
        element_id: placement.elementId,
        element_type: pinned.type,
        x: clampToCanvas(Math.round(ev.point.x), width),
        y: clampToCanvas(Math.round(ev.point.y), height),
      });
      const elements = await store.listElements();
      patchSlice('data', { elements });
      patchSlice('ui', { ...getState().ui, pinPlacement: null });
      requestPushIfLinked();
      toasts.success('Pin placed');
      completeWaypoint('maps');
    } catch (err) {
      console.error('[map-tab] create pin failed:', err);
      toasts.error('Failed to place pin');
    }
  });

  // Pin right-click → toggle ghost pins around it (DESIGN_MAPS.md §3.8).
  manager.on('pin-contextmenu', (ev) => {
    const pin = getState().data.elements.find(
      (e): e is Pin => e.type === 'pin' && e.id === ev.pin.id,
    );
    if (!pin) return;
    const lMap = manager.getMap();
    if (!lMap) return;
    toggleGhostsAtSourcePin({
      mapId: entry.mapId,
      sourcePinId: pin.id,
      sourcePinElementId: pin.element_id,
      sourcePinX: pin.x,
      sourcePinY: pin.y,
      canvasHeight: height,
      lMap,
      onToast: (msg, level) => {
        if (level === 'error') toasts.error(msg);
        else toasts.info(msg);
      },
    });
  });

  // Pin click → navigate to that element's detail. The active map tab
  // stays put — explicit map navigation lives in the element-detail top
  // bar (DESIGN_MAPS.md §3.5/§3.6).
  manager.on('pin-click', (ev) => {
    const pin = getState().data.elements.find((e): e is Pin => e.type === 'pin' && e.id === ev.pin.id);
    if (!pin) return;
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    patchSlice('ui', { ...getState().ui, selectedElementId: pin.element_id, sidebarMode: 'elements' });
    navigate(elementHash(worldId, pin.element_id));
  });

  // Pin hover → floating tooltip.
  manager.on('pin-hover', (ev) => {
    const pin = getState().data.elements.find((e): e is Pin => e.type === 'pin' && e.id === ev.pin.id);
    const el = pin ? getState().data.elements.find(e => e.id === pin.element_id) : null;
    if (!el) return;
    const oe = ev.originalEvent.originalEvent as MouseEvent;
    const rect = container.getBoundingClientRect();
    tooltip.innerHTML = buildPinTooltipHtml(el);
    tooltip.style.display = 'block';
    tooltip.style.left = `${oe.clientX - rect.left + 12}px`;
    tooltip.style.top = `${oe.clientY - rect.top + 12}px`;
  });
  manager.on('pin-hover-end', () => { tooltip.style.display = 'none'; });

  // Right-click empty map → contextual element-create + drop pin at click point.
  manager.getMap()?.on('contextmenu', async (e) => {
    (e.originalEvent as MouseEvent).preventDefault();
    const latlng = (e as any).latlng;
    if (!latlng) return;
    // Block during zone edit mode (Captain smoke session 219). Creating a
    // pin via right-click WHILE editing a zone tore down the edit overlay
    // without confirming changes (the modal-open path triggered a stray
    // exitEditMode-without-cancel). Refuse cleanly with a toast so the
    // user has to exit edit explicitly first.
    if (isEditing() && getEditingMapId() === entry.mapId) {
      toasts.info('Finish zone edit first (Done or Esc)');
      return;
    }
    // Same gate as the placement-banner map-click path.
    const currentMap = getState().data.elements.find(
      (em): em is WorldMap => em.type === 'map' && em.id === entry.mapId,
    );
    if (!currentMap || (!currentMap.image_url && !currentMap.image_media_id)) {
      toasts.info('Set a map image first — pins anchor to the image');
      return;
    }
    const point = leafletToStorage(latlng, height);

    // Shared pin-write closure used by both Create (new element + pin) and
    // Place (pin pointing at existing element).
    const writePin = async (elementId: string, elementType: string): Promise<void> => {
      const store = getActiveStore();
      if (!store) return;
      await store.createPin({
        map_id: entry.mapId,
        element_id: elementId,
        element_type: elementType,
        x: clampToCanvas(Math.round(point.x), width),
        y: clampToCanvas(Math.round(point.y), height),
      });
      await refreshElementsAfterWrite(store);
      completeWaypoint('maps'); // both callers are new-pin modal gestures
    };

    const modal = new ElementCreateModal(toasts, {
      // 'map' and 'zone' are hidden in this contextual flow — pins don't
      // target maps (DESIGN_MAPS.md §1.4), and zones are constructed via
      // markers, never pinned. Excluding from the type grid AND the place-
      // existing autocomplete (the matcher filters by selected category).
      excludeTypes: ['map', 'zone'],
      title: 'New pin',
      // NPM (DESIGN_MAPS.md §3.7) — TAB on a name prefix accepts an existing
      // element of the current category; Place drops a pin for that element
      // instead of creating a new one.
      enablePlaceExisting: true,
      onCreated: async (elementId, elementType) => {
        try {
          await writePin(elementId, elementType);
          toasts.success('Pin placed');
        } catch (err) {
          console.error('[map-tab] contextual pin create failed:', err);
          toasts.error('Failed to place pin');
        }
      },
      onPlaceExisting: async (elementId, elementType) => {
        try {
          await writePin(elementId, elementType);
          toasts.success('Pin placed');
        } catch (err) {
          console.error('[map-tab] place existing pin failed:', err);
          toasts.error('Failed to place pin');
        }
      },
    });
    modal.open();
  });

  // Map-tab single-letter hotkeys (only fire while focus is inside the map
  // canvas — container.tabIndex=0 makes it focusable; clicks on the canvas
  // grab focus). Bare letters here would otherwise hijack typing if dispatched
  // globally; scoping to the container keeps them safe.
  container.tabIndex = 0;
  container.addEventListener('keydown', (e) => {
    // No modifier and not typing into a child input (the toolbar has none,
    // but be defensive against future markup).
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const cacheEntry = entry;
    const active = getActiveDraft();

    switch (e.key.toLowerCase()) {
      case 'f':
        e.preventDefault();
        // Match the toolbar's fit-to-image button: fit the whole canvas, not
        // visible pins. fitBounds() fits pins → silent no-op with 0 pins,
        // max-zoom with 1 pin.
        manager.fitToCanvas();
        break;
      case 'z':
        e.preventDefault();
        if (active && active.mode === 'polygon' && active.mapId === mapId) cancelDrawing();
        else startDrawing(cacheEntry, 'polygon', toasts);
        break;
      case 'l':
        e.preventDefault();
        if (active && active.mode === 'line' && active.mapId === mapId) cancelDrawing();
        else startDrawing(cacheEntry, 'line', toasts);
        break;
    }
  });

  // Drag-from-sidebar → drop creates a pin (DESIGN_MAPS.md §8). The
  // sidebar's elements list marks rows as draggable and sets a custom
  // MIME payload `application/x-atlas-element` with `{id, type}`. Drop
  // fires on the map container; project the drop point into image coords
  // and write a pin.
  container.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('application/x-atlas-element')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    container.classList.add('atlas-map-drop-target');
  });
  container.addEventListener('dragleave', (e) => {
    const related = e.relatedTarget as Node | null;
    if (related && container.contains(related)) return;
    container.classList.remove('atlas-map-drop-target');
  });
  container.addEventListener('drop', async (e) => {
    container.classList.remove('atlas-map-drop-target');
    const raw = e.dataTransfer?.getData('application/x-atlas-element');
    if (!raw) return;
    e.preventDefault();
    let payload: { id?: string; type?: string };
    try {
      payload = JSON.parse(raw);
    } catch {
      return;
    }
    if (!payload.id || !payload.type) return;
    // Defensive: zones and maps can never be pin targets (sidebar dragstart
    // already refuses both, but a future drag source could bypass that —
    // gate at the drop site too so the rule lives where pins are created).
    if (payload.type === 'zone' || payload.type === 'map') {
      toasts.info(`${payload.type}s can't be pinned`);
      return;
    }
    const currentMap = getState().data.elements.find(
      (em): em is WorldMap => em.type === 'map' && em.id === entry.mapId,
    );
    if (!currentMap || (!currentMap.image_url && !currentMap.image_media_id)) {
      toasts.info('Set a map image first — pins anchor to the image');
      return;
    }
    const lMap = manager.getMap();
    if (!lMap) return;
    // DragEvent extends MouseEvent; Leaflet's mouseEventToLatLng accepts it.
    const latlng = lMap.mouseEventToLatLng(e);
    const point = leafletToStorage(latlng, height);
    try {
      const store = getActiveStore();
      if (!store) return;
      await store.createPin({
        map_id: entry.mapId,
        element_id: payload.id,
        element_type: payload.type,
        x: clampToCanvas(Math.round(point.x), width),
        y: clampToCanvas(Math.round(point.y), height),
      });
      await refreshElementsAfterWrite(store);
      toasts.success('Pin placed');
      completeWaypoint('maps');
    } catch (err) {
      console.error('[map-tab] drag-drop create pin failed:', err);
      toasts.error('Failed to place pin');
    }
  });
}
