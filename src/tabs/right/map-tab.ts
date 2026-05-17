/**
 * Map tab renderer — one Leaflet2DManager instance per open map.
 *
 * Public surface: mountMapTab / disposeMapTab / disposeAllMapTabs / panMapTabTo.
 *
 * Concerns split across sibling modules to keep this file focused on
 * lifecycle + interaction wiring:
 *   - map-tab-cache:       MapTabCacheEntry + the shared mapTabCache Map
 *   - map-tab-pins:        syncPins + chip strip + refreshActiveMapPins
 *   - map-tab-pin-drag:    enablePinDrag + clampToCanvas
 *   - map-tab-backgrounds: applyMapBackground + sourceKey + refreshCachedBackgrounds
 *   - map-tab-tooltip:     buildPinTooltipHtml + escapeHtml
 *
 * Lifecycle:
 *   - mountMapTab(target, mapId, toasts) attaches cached container or creates fresh.
 *   - disposeMapTab(mapId) destroys manager, revokes object URLs, drops cache entry.
 *   - disposeAllMapTabs() is called on world switch.
 */

import { getState, patchSlice, subscribe } from '../../core/state';
import { Leaflet2DManager } from '../../visualization/leaflet-2d/Leaflet2DManager';
import { leafletToStorage, storageToLeaflet } from '../../visualization/leaflet-2d/CoordinateUtils';
import type { Element, Pin, WorldMap } from '../../core/types';
import { pinVisualFor, onPinVisualsReady } from './pin-visuals';
import { getAssociatedMaps } from './auto-open-map';
import { toggleGhostsAtSourcePin, disposeGhostsForMap } from './ghost-pins';
import { ToastManager } from '../../ui/toast-manager';
import { ElementCreateModal } from '../../ui/element-create-modal';
import { getActiveStore } from '../../ui/create-world-modal';
import { navigate, elementHash } from '../../core/router';
import { requestPushIfLinked } from '../../sync/sync-attach';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { syncPins, refreshActiveMapPins } from './map-tab-pins';
import { enablePinDrag, clampToCanvas } from './map-tab-pin-drag';
import { applyMapBackground, refreshCachedBackgrounds } from './map-tab-backgrounds';
import { buildPinTooltipHtml, escapeHtml } from './map-tab-tooltip';
import { buildCanvasToolbar } from './map-tab-toolbar';
import { toggleVisualSettingsPopover, applyLivePrefs, closeVisualSettingsPopover } from './map-visual-settings-popover';
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import { startDrawing, placeMarkerAt, getActiveDraft, cancelDrawing, disposeDraftForMap } from './zone-drawing';
import { ZoneOverlay } from '../../visualization/leaflet-2d/ZoneOverlay';
import { syncZones, wireChipStrip, refreshActiveMapZones } from './map-tab-zones';
import { enterEditMode, isEditing, getEditingZoneId, getEditingMapId, abortEditModeForMap, syncEditMode, insertMarkerAtClick } from './zone-edit-mode';

let containerSeq = 0;

/**
 * Toggle behavior for the zones dropdown panel (ZC9). Click the button →
 * open the panel + add outside-click + Escape listeners. Click again or
 * outside → close. Defensive: clicks inside the panel don't close it.
 */
function wireZonesDropdown(btn: HTMLButtonElement, panel: HTMLElement): void {
  let outsideListener: ((e: MouseEvent) => void) | null = null;
  let escListener: ((e: KeyboardEvent) => void) | null = null;

  const close = (): void => {
    panel.classList.remove('is-open');
    btn.classList.remove('is-open');
    if (outsideListener) document.removeEventListener('mousedown', outsideListener);
    if (escListener) document.removeEventListener('keydown', escListener);
    outsideListener = null;
    escListener = null;
  };

  const open = (): void => {
    panel.classList.add('is-open');
    btn.classList.add('is-open');
    outsideListener = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.contains(t) || btn.contains(t)) return;
      close();
    };
    escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // Defer registration so the originating click doesn't immediately close.
    setTimeout(() => {
      if (outsideListener) document.addEventListener('mousedown', outsideListener);
      if (escListener) document.addEventListener('keydown', escListener);
    }, 0);
  };

  btn.addEventListener('click', () => {
    if (panel.classList.contains('is-open')) close();
    else open();
  });
}

export function mountMapTab(target: HTMLElement, mapId: string, toasts: ToastManager): void {
  target.innerHTML = '';
  const pane = document.createElement('div');
  pane.className = 'atlas-pane atlas-map-pane';
  target.appendChild(pane);

  const state = getState();
  const worldId = state.active?.worldId;
  if (!worldId) {
    pane.innerHTML = `<div class="atlas-empty-state">no active world.</div>`;
    return;
  }
  const map = state.data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === mapId);
  if (!map) {
    // Stale tab: this mapId isn't in the current world's elements. Resolve
    // the owning world's name via the tab's worldId stamp (openMapTab sets
    // this; legacy tabs without it fall back to a generic message).
    const tab = state.ui.rightTabs.find(t => t.kind === 'map' && t.mapId === mapId);
    const ownerWorldId = tab && tab.kind === 'map' ? tab.worldId : undefined;
    const ownerWorld = ownerWorldId ? state.registry.worlds.find(w => w.id === ownerWorldId) : undefined;
    const ownerLabel = ownerWorld?.name ?? null;
    const tabLabel = tab && tab.kind === 'map' ? tab.label : '';
    const subMsg = ownerLabel
      ? `this map belongs to <b>${escapeHtml(ownerLabel)}</b>${tabLabel ? ` ("${escapeHtml(tabLabel)}")` : ''} — switch to that world to view it.`
      : `it may have been deleted, or you switched worlds while it was open.`;
    pane.innerHTML = `
      <div class="atlas-empty-state atlas-map-stale-pane" data-role="map-stale-pane">
        <div class="material-symbols-outlined atlas-map-stale-icon">cloud_off</div>
        <div class="atlas-map-stale-title">${ownerLabel ? `Map from another world` : `this map isn't in the current world`}</div>
        <div class="atlas-map-stale-sub">${subMsg}</div>
        <button type="button" class="atlas-btn-ghost" data-action="close-stale">Close tab</button>
      </div>
    `;
    pane.querySelector<HTMLButtonElement>('[data-action="close-stale"]')?.addEventListener('click', () => {
      const ui = getState().ui;
      const tabIdx = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === mapId);
      if (tabIdx < 0) return;
      const next = [...ui.rightTabs];
      next.splice(tabIdx, 1);
      const active = ui.rightActiveIndex >= tabIdx ? Math.max(0, ui.rightActiveIndex - 1) : ui.rightActiveIndex;
      patchSlice('ui', { ...ui, rightTabs: next, rightActiveIndex: active });
    });
    return;
  }

  const cached = mapTabCache.get(mapId);
  if (cached) {
    pane.appendChild(cached.wrapper);
    cached.ready.then(() => {
      cached.manager.getMap()?.invalidateSize();
      syncPins(cached);
    });
    return;
  }

  // Fresh mount: wrapper is a vertical flex column with toolbar above the
  // leaflet container. Caching the wrapper preserves leaflet state across
  // tab re-mounts.
  const wrapper = document.createElement('div');
  wrapper.className = 'atlas-map-tab-wrapper';

  const toolbarRefs = buildCanvasToolbar();
  wrapper.appendChild(toolbarRefs.root);

  // Settings cog → toggle the visual settings popover.
  toolbarRefs.settingsBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (e) toggleVisualSettingsPopover(e, toolbarRefs.settingsBtn);
  });

  // Visibility toggles (transient, not persisted to prefs). State held in
  // the button's `is-active` class; default = visible (button not active).
  toolbarRefs.toggleZonesBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e?.zoneOverlay) return;
    const wasVisible = e.zoneOverlay.isLayerVisible();
    e.zoneOverlay.setLayerVisible(!wasVisible);
    toolbarRefs.toggleZonesBtn.classList.toggle('is-active', wasVisible);
    // Glyph swap: visibility ↔ visibility_off mirrors the state.
    const icon = toolbarRefs.toggleZonesBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = wasVisible ? 'visibility_off' : 'visibility';
  });

  toolbarRefs.togglePinsBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    const currentlyActive = toolbarRefs.togglePinsBtn.classList.contains('is-active');
    // Active class indicates "pins hidden" — flip.
    const nextHidden = !currentlyActive;
    e.manager.setPinsLayerVisible(!nextHidden);
    toolbarRefs.togglePinsBtn.classList.toggle('is-active', nextHidden);
    const icon = toolbarRefs.togglePinsBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = nextHidden ? 'visibility_off' : 'visibility';
  });

  toolbarRefs.fitToImageBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    e.manager.fitToCanvas();
  });

  // Draw buttons → toggle drawing mode for this map.
  toolbarRefs.drawPolygonBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    const active = getActiveDraft();
    if (active && active.mode === 'polygon' && active.mapId === mapId) {
      cancelDrawing();
    } else {
      startDrawing(e, 'polygon', toasts);
    }
  });
  toolbarRefs.drawLineBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    const active = getActiveDraft();
    if (active && active.mode === 'line' && active.mapId === mapId) {
      cancelDrawing();
    } else {
      startDrawing(e, 'line', toasts);
    }
  });

  const container = document.createElement('div');
  container.id = `atlas-map-${++containerSeq}`;
  container.className = 'atlas-map-canvas-container';
  wrapper.appendChild(container);

  // Floating zones dropdown panel (ZC9 — was the bottom-of-canvas chip strip
  // in sessions 213-216). Hidden until the toolbar's dropdown button opens
  // it; anchored top-right under that button via CSS. The DOM element is
  // still owned by entry.zoneStrip so renderChipStrip + wireChipStrip from
  // map-tab-zones.ts keep working without refactor.
  const zoneStrip = document.createElement('div');
  zoneStrip.className = 'atlas-zones-dropdown-panel';
  zoneStrip.setAttribute('data-role', 'zones-dropdown-panel');
  zoneStrip.style.display = 'none';
  wrapper.appendChild(zoneStrip);

  // Wire the toolbar dropdown button → toggle the panel. Outside-click +
  // Escape close it. Re-open by clicking the button again.
  wireZonesDropdown(toolbarRefs.zonesDropdownBtn, zoneStrip);

  pane.appendChild(wrapper);

  const tooltip = document.createElement('div');
  tooltip.className = 'atlas-pin-tooltip';
  tooltip.style.display = 'none';
  container.appendChild(tooltip);

  // Trash drop-zone — top-right of the map canvas, hidden until a pin drag
  // begins. Drop the pin on it → pin deletion. We check the marker's
  // released latlng against this div's screen rect inside enablePinDrag.
  const trashZone = document.createElement('div');
  trashZone.className = 'atlas-pin-trash-zone';
  trashZone.setAttribute('data-active', 'false');
  trashZone.innerHTML = '<span class="material-symbols-outlined">delete</span><span>drop to delete</span>';
  container.appendChild(trashZone);

  // Pin filter chip strip — top-left overlay showing element types present
  // in this map's pins. Click chip → toggle visibility for that type.
  // Per-tab in-memory only; cleared on dispose.
  const chipStrip = document.createElement('div');
  chipStrip.className = 'atlas-pin-filter-strip';
  container.appendChild(chipStrip);

  const width = map.width ?? 2000;
  const height = map.height ?? 2000;

  const manager = new Leaflet2DManager({
    containerId: container.id,
    canvasWidth: width,
    canvasHeight: height,
    minZoom: -4,
    maxZoom: 4,
    initialZoom: -1,
    showLabels: true,
    defaultIconSize: 32,
    defaultLabelOffset: 12,
    // Constrain pan/click to canvas bounds (DESIGN_MAPS.md §4.1 pin coord
    // discipline). Without this, Leaflet's CRS.Simple lets the user pan and
    // click anywhere in infinite 2D space — pin coords then end up outside
    // the canvas (e.g. y > image height → pin renders below the map).
    maxBounds: [[0, 0], [width, height]],
  });

  const entry: MapTabCacheEntry = {
    mapId,
    worldId,
    wrapper,
    toolbar: toolbarRefs.root,
    container,
    manager,
    objectUrls: [],
    ready: Promise.resolve(),
    tooltip,
    trashZone,
    chipStrip,
    hiddenPinTypes: new Set(),
    lastBg: '',
    zoneOverlay: null,
    zoneStrip,
  };
  wireChipStrip(entry, toasts);
  mapTabCache.set(mapId, entry);

  entry.ready = (async () => {
    await manager.init();

    // Background source precedence (DESIGN_MAPS.md §4): image_url > image_media_id > grid.
    await applyMapBackground(entry, map, width, height);

    // Apply per-map visual prefs once the manager + background are ready.
    // Idempotent — re-applying does no harm and lets the prefs system act as
    // the single integration point for live consumers.
    try { applyLivePrefs(entry, getEffectiveMapPrefs(mapId)); } catch { /* noop */ }

    // Mount the zone overlay (polygon/polyline rendering). Construct after
    // manager.init so the underlying L.Map handle is ready. Wire click to
    // select-zone navigation; right-click on a zone outline opens the same
    // chip context menu via shared select logic.
    const lMap = manager.getMap();
    if (lMap) {
      const overlay = new ZoneOverlay(lMap, height);
      // Single click → select zone AND navigate to its element-detail route
      // so the middle pane updates AND the sidebar/midpanel reflect the
      // selection (parity with pin-click flow). Without the nav step,
      // selectedElementId is patched but the route never changes, so the
      // middle pane stays on whatever was there before. Leaflet natively
      // suppresses the click preceding a dblclick, so the nav doesn't
      // race with edit-mode entry.
      overlay.onZoneClick((zoneId) => {
        const worldId = getState().active?.worldId;
        if (!worldId) return;
        patchSlice('ui', {
          ...getState().ui,
          selectedElementId: zoneId,
          sidebarMode: 'elements',
        });
        navigate(elementHash(worldId, zoneId));
      });
      // Double click → enter edit mode (DESIGN_ZONES.md §3.1, S4). Leaflet's
      // native dblclick already suppresses the preceding click; the single-
      // click select fired first but that's actually fine — selecting before
      // editing matches user intent.
      overlay.onZoneDoubleClick((zoneId) => {
        enterEditMode(zoneId, mapId, toasts);
      });
      entry.zoneOverlay = overlay;
      syncZones(entry);
    }

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
      // Edit-mode click-anywhere insert: only fires for clicks that didn't hit
      // a vertex handle (marker click doesn't bubble to map-click in Leaflet)
      // or a segment overlay (its handler calls L.DomEvent.stop). So a stray
      // canvas click while editing safely lands here without double-firing.
      if (isEditing() && getEditingMapId() === mapId) {
        await insertMarkerAtClick(ev.point);
        return;
      }
      const placement = getState().ui.pinPlacement;
      if (!placement) return;
      // Gate: pin placement requires a map image (DESIGN_MAPS.md §4.1).
      const currentMap = getState().data.elements.find(
        (e): e is WorldMap => e.type === 'map' && e.id === entry.mapId,
      );
      if (!currentMap || (!currentMap.image_url && !currentMap.image_media_id)) {
        toasts.info('set a map image first — pins anchor to the image');
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
          toasts.error('cannot place pin — element not found');
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
        toasts.success('pin placed');
      } catch (err) {
        console.error('[map-tab] create pin failed:', err);
        toasts.error('failed to place pin');
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
      // Same gate as the placement-banner map-click path.
      const currentMap = getState().data.elements.find(
        (em): em is WorldMap => em.type === 'map' && em.id === entry.mapId,
      );
      if (!currentMap || (!currentMap.image_url && !currentMap.image_media_id)) {
        toasts.info('set a map image first — pins anchor to the image');
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
        const elements = await store.listElements();
        patchSlice('data', { elements });
        requestPushIfLinked();
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
            toasts.success('pin placed');
          } catch (err) {
            console.error('[map-tab] contextual pin create failed:', err);
            toasts.error('failed to place pin');
          }
        },
        onPlaceExisting: async (elementId, elementType) => {
          try {
            await writePin(elementId, elementType);
            toasts.success('pin placed');
          } catch (err) {
            console.error('[map-tab] place existing pin failed:', err);
            toasts.error('failed to place pin');
          }
        },
      });
      modal.open();
    });

    // 'F' key → fit bounds
    container.tabIndex = 0;
    container.addEventListener('keydown', (e) => {
      if (e.key === 'f' || e.key === 'F') manager.fitBounds(40);
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
        toasts.info('set a map image first — pins anchor to the image');
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
        const elements = await store.listElements();
        patchSlice('data', { elements });
        requestPushIfLinked();
        toasts.success('pin placed');
      } catch (err) {
        console.error('[map-tab] drag-drop create pin failed:', err);
        toasts.error('failed to place pin');
      }
    });

    // Seed pins from state.
    syncPins(entry);

    // Always fit the canvas image bounds on mount so the image fills the
    // visible viewport. Previously: fit-to-pins only when ≥2 pins existed;
    // without pins users saw the default zoom which often left the image
    // at half-screen on page refresh (Captain smoke session 218→219).
    manager.getMap()?.invalidateSize();
    manager.fitToCanvas(20);
  })();

  entry.ready.catch(err => console.error('[map-tab] init failed:', err));
}

export function disposeMapTab(mapId: string): void {
  const entry = mapTabCache.get(mapId);
  if (!entry) return;
  // Close any open visual settings popover for this tab — its anchored DOM
  // lives inside entry.wrapper which is about to be torn down.
  closeVisualSettingsPopover();
  // Cancel any in-flight zone draft on this map.
  disposeDraftForMap(mapId);
  // Abort any in-flight zone edit on this map (skip snapshot restoration —
  // the tab is gone).
  abortEditModeForMap(mapId);
  // Ghost pins live on a Leaflet layer attached to entry.manager's L.Map. Tear
  // them down BEFORE the manager destroy so the layer detach goes cleanly;
  // after destroy the L.Map handle is gone.
  try {
    const lMap = entry.manager.getMap();
    disposeGhostsForMap(mapId, lMap ?? null);
  } catch { /* noop */ }
  // Dispose zone overlay BEFORE the manager destroy (its LayerGroup is
  // attached to the manager's L.Map).
  try { entry.zoneOverlay?.dispose(); } catch { /* noop */ }
  entry.zoneOverlay = null;
  try { entry.manager.destroy(); } catch { /* noop */ }
  for (const url of entry.objectUrls) {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
  // Remove the wrapper (and its toolbar + container) in one go.
  if (entry.wrapper.parentElement) entry.wrapper.parentElement.removeChild(entry.wrapper);
  mapTabCache.delete(mapId);
}

export function disposeAllMapTabs(): void {
  for (const id of [...mapTabCache.keys()]) disposeMapTab(id);
}

/**
 * Pan an open map tab to a given storage-coord pin position AND set a
 * comfortable zoom level. Used by the element-detail top bar's `[pin]`
 * cluster — click → openMapTab(map) and then center on the pin's stored
 * x/y at moderate zoom. Waits for the tab's `ready` promise so freshly-
 * opened tabs settle before the camera moves.
 */
export function panMapTabTo(mapId: string, x: number, y: number): void {
  const entry = mapTabCache.get(mapId);
  if (!entry) return;
  entry.ready.then(() => {
    try {
      const lMap = entry.manager.getMap();
      if (!lMap) return;
      const height = entry.manager.getConfig().canvasHeight;
      const latlng = storageToLeaflet({ x, y }, height);
      lMap.setView(latlng, 1, { animate: true, duration: 0.4 } as L.ZoomPanOptions);
    } catch (err) {
      console.error('[map-tab] panMapTabTo failed:', err);
    }
  });
}

// When pin visuals (canvas icons via Material Symbols font) become available
// later, swap icons on all existing rendered pins in place. Critical: pass
// the per-map prefs (tint + style) AND recompute map-badge state — without
// these, tint/style changes get silently reverted every time a new canvas-
// rendered icon arrives via the font-load callback (the original on-ready
// path used pinVisualFor with default args, which always meant 'type-color'
// + 'icon' + no-badge regardless of the user's settings).
onPinVisualsReady(() => {
  for (const entry of mapTabCache.values()) {
    entry.ready.then(() => {
      const elements = getState().data.elements;
      const prefs = getEffectiveMapPrefs(entry.mapId);
      for (const existing of entry.manager.getAllPins()) {
        const pin = elements.find((e): e is Pin => e.type === 'pin' && e.id === existing.id);
        if (!pin) continue;
        const pinnedEl = elements.find((e: Element) => e.id === pin.element_id);
        const type = pinnedEl?.type ?? 'object';
        const hasMapBadge = pinnedEl
          ? getAssociatedMaps(pinnedEl.id, elements).length > 0
          : false;
        const visual = pinVisualFor(type, hasMapBadge, prefs.pin_tint, prefs.pin_style);
        entry.manager.updatePin(existing.id, { icon: visual.iconUrl });
      }
    });
  }
});

// Subscribe to state so pin AND background changes flow into visible maps.
// HOT-PATH NARROWING (DESIGN_MAPS.md §10b MR): the subscribe fires on every
// notification — including unrelated ones. Track the last seen reference and
// short-circuit when data.elements hasn't changed.
let lastElementsRef: unknown = null;
let lastSelectedRef: unknown = null;
subscribe(() => {
  const state = getState();
  const elements = state.data.elements;
  const selected = state.ui.selectedElementId;
  if (elements === lastElementsRef && selected === lastSelectedRef) return;
  lastElementsRef = elements;
  lastSelectedRef = selected;
  refreshActiveMapPins();
  refreshCachedBackgrounds();
  refreshActiveMapZones();
  syncEditMode();
});

// Quiet unused-import warnings: these names are public via re-import paths.
void isEditing;
void getEditingZoneId;
