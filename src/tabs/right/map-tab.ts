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
import { storageToLeaflet } from '../../visualization/leaflet-2d/CoordinateUtils';
import type { Element, Pin, WorldMap } from '../../core/types';
import { pinVisualFor, onPinVisualsReady } from './pin-visuals';
import { hasLinkedSubMap } from './auto-open-map';
import { disposeGhostsForMap } from './ghost-pins';
import { ToastManager } from '../../ui/toast-manager';
import { IMAGELESS_MAP_SIZE } from '../../ui/image-dims';
import { navigate, elementHash } from '../../core/router';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { syncPins, refreshActiveMapPins, applyPinScale } from './map-tab-pins';
import { refreshLabelDensity } from './map-label-density';
import { enablePinDrag } from './map-tab-pin-drag';
import { applyMapBackground, refreshCachedBackgrounds } from './map-tab-backgrounds';
import { buildCanvasToolbar, wireCanvasToolbar } from './map-tab-toolbar';
import { wireMapInteractions } from './map-tab-interactions';
import { renderStaleMapPane } from './map-tab-stale';
import { applyLivePrefs, closeVisualSettingsPopover } from './map-visual-settings-popover';
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import { saveCameraState, getCameraState } from '../../core/map-camera-persist';
import { disposeDraftForMap } from './zone-drawing';
import { ZoneOverlay } from '../../visualization/leaflet-2d/ZoneOverlay';
import { syncZones, wireChipStrip, refreshActiveMapZones } from './map-tab-zones';
import { enterEditMode, abortEditModeForMap, syncEditMode } from './zone-edit-mode';

let containerSeq = 0;

export function mountMapTab(target: HTMLElement, mapId: string, toasts: ToastManager): void {
  target.innerHTML = '';
  const pane = document.createElement('div');
  pane.className = 'atlas-pane atlas-map-pane';
  target.appendChild(pane);

  const state = getState();
  const worldId = state.active?.worldId;
  if (!worldId) {
    pane.innerHTML = `<div class="atlas-empty-state">No active world.</div>`;
    return;
  }
  const map = state.data.elements.find((e): e is WorldMap => e.type === 'map' && e.id === mapId);
  if (!map) {
    // Stale tab: this mapId isn't in the current world's elements (map deleted,
    // or world switched while open). map-tab-stale renders the explainer pane.
    renderStaleMapPane(pane, mapId);
    return;
  }

  const cached = mapTabCache.get(mapId);
  if (cached) {
    pane.appendChild(cached.wrapper);
    cached.ready.then(() => {
      cached.manager.getMap()?.invalidateSize();
      syncPins(cached);
      // Zones too (resilience gate, S299): elements-slice changes while the
      // tab was cached (zone deleted + tour-healed, edited elsewhere) never
      // reached the overlay — pins re-synced on re-entry, zones didn't.
      syncZones(cached);
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

  // Wire all toolbar buttons + the zones dropdown. Handlers resolve the live
  // cache entry by mapId at click time, so wiring before `entry` exists below
  // is safe. (Extracted to map-tab-toolbar.ts in the session-233 re-trim.)
  wireCanvasToolbar(toolbarRefs, zoneStrip, mapId, toasts);

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
  trashZone.innerHTML = '<span class="material-symbols-outlined">delete</span><span>Drop to delete</span>';
  container.appendChild(trashZone);

  // Pin filter chip strip — top-left overlay showing element types present
  // in this map's pins. Click chip → toggle visibility for that type.
  // Per-tab in-memory only; cleared on dispose.
  const chipStrip = document.createElement('div');
  chipStrip.className = 'atlas-pin-filter-strip';
  container.appendChild(chipStrip);

  // Legacy imageless maps may lack stored dims — the flat-canvas default is
  // the shared IMAGELESS_MAP_SIZE square (applyMapBackground persists it on
  // first open so the space becomes durable; DESIGN_MAPS.md §4.2).
  const width = map.width ?? IMAGELESS_MAP_SIZE;
  const height = map.height ?? IMAGELESS_MAP_SIZE;

  const manager = new Leaflet2DManager({
    containerId: container.id,
    canvasWidth: width,
    canvasHeight: height,
    minZoom: -4,
    maxZoom: 4,
    initialZoom: -1,
    showLabels: true,
    defaultIconSize: 32,
    defaultLabelOffset: 7,
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
    hiddenZoneKinds: new Set(),
    lastBg: '',
    zoneOverlay: null,
    zoneStrip,
  };
  wireChipStrip(entry, toasts);
  mapTabCache.set(mapId, entry);

  entry.ready = (async () => {
    await manager.init();

    // Snapshot any previously-saved camera state BEFORE running the rest of
    // the mount chain. applyMapBackground will fitBounds, which would
    // overwrite the in-memory view, and we want the PRIOR session's saved
    // state as our restore target. Reading from localStorage here is safe;
    // no in-session moveend has fired yet.
    const savedAtMount = getCameraState(mapId);

    // Background source precedence (DESIGN_MAPS.md §4): image_url > image_media_id > grid.
    await applyMapBackground(entry, map, width, height);

    // Apply per-map visual prefs once the manager + background are ready.
    // Idempotent — re-applying does no harm and lets the prefs system act as
    // the single integration point for live consumers.
    try { applyLivePrefs(entry, getEffectiveMapPrefs(mapId)); } catch { /* noop */ }

    const lMapForRestore = manager.getMap();
    if (lMapForRestore) {
      // Restore the saved camera state — overrides applyMapBackground's
      // fit-to-image landing. First-time visits with no saved state fall
      // through to the fit-to-image view.
      if (savedAtMount) {
        try {
          lMapForRestore.setView(savedAtMount.center, savedAtMount.zoom, { animate: false });
          console.info('[atlas:map] camera restored', { mapId, savedAtMount });
        } catch (err) {
          console.warn('[atlas:map] camera restore failed:', err);
        }
      } else {
        console.info('[atlas:map] no saved camera for', mapId, '— using fit-to-image');
      }
      // Persist on every settled pan/zoom. moveend covers both pan AND zoom
      // (Leaflet fires it after zoomend). Cheap to write — localStorage and
      // the read+merge happens at human time scales.
      //
      // Debounced via a microtask flag so a single user gesture that fires
      // multiple moveends (zoom + slide-stop) only writes once. Throttling
      // also prevents the setView-during-restore from triggering an extra
      // save with the just-restored values (idempotent but noisy in logs).
      let savePending = false;
      lMapForRestore.on('moveend', () => {
        if (savePending) return;
        savePending = true;
        queueMicrotask(() => {
          savePending = false;
          const center = lMapForRestore.getCenter();
          const zoom = lMapForRestore.getZoom();
          saveCameraState(mapId, { center: [center.lat, center.lng], zoom });
        });
      });
      // The density layer (S356): icons re-scale to the gap between them at
      // the new zoom, then labels re-contest their space. moveend follows
      // zoomend, so one settled gesture runs the label pass once.
      lMapForRestore.on('zoomend', () => applyPinScale(entry));
      lMapForRestore.on('moveend', () => refreshLabelDensity(entry));
    }

    // Mount the zone overlay (polygon/polyline rendering). Construct after
    // manager.init so the underlying L.Map handle is ready. Wire click to
    // select-zone navigation; right-click on a zone outline opens the same
    // chip context menu via shared select logic.
    const lMap = manager.getMap();
    if (lMap) {
      const overlay = new ZoneOverlay(lMap, height);
      // While a pin is being placed, a click on a zone should place the pin
      // there, not select the zone (the zone otherwise stops the click before
      // the map's placement handler sees it). Correct app-wide; the tour's
      // pin-over-swamps beat is where it first mattered.
      //
      // Also fall through during the tour's pin beat BEFORE placement is armed
      // (`atlas-tour-pinstep` = place-pin step, pin not yet placed): the beat
      // tells the user to click the swamps, and a zone click before they hit
      // the pulsing +pin button would otherwise SELECT the zone and route away
      // from the Consul, hiding that button. Falling through makes it a harmless
      // no-op (the map's click handler no-ops with nothing armed) and the pulse
      // keeps guiding them to +pin.
      overlay.setClickFallsThrough(() =>
        !!getState().ui.pinPlacement
        || document.body.classList.contains('atlas-tour-pinstep'));
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
        // While a pin is being placed, a double-click on a zone must NOT enter
        // edit mode (mirrors clickFallsThrough for the single click): the
        // tour's pin-over-swamps beat asks the user to click the zone, and a
        // double-click there would trap placement behind edit-mode's map-click
        // handling AND expose vertex handles that reshape the polygon pinInZone
        // tests against. Placing wins; edit the zone after the pin is set.
        if (getState().ui.pinPlacement) return;
        enterEditMode(zoneId, mapId, toasts);
      });
      entry.zoneOverlay = overlay;
      syncZones(entry);
    }

    // Wire all user-input handlers (map/pin events, contextual create,
    // hotkeys, drag-drop). Extracted to map-tab-interactions.ts in the
    // session-233 re-trim — see that module for the handler bodies.
    wireMapInteractions({ entry, manager, container, tooltip, width, height, mapId, toasts });

    // Seed pins from state.
    syncPins(entry);

    // Final size sync — Leaflet might have measured the container before it
    // settled at flex size. invalidateSize forces a re-measure without
    // changing the view (preserves whatever setView resolved to).
    //
    // fit-to-canvas runs only when NO saved camera state existed at mount
    // (session 218→219 added the always-fit to fix the half-screen-on-refresh
    // case; session 221 W6 added camera restore — if a user has a saved view,
    // restoring it MUST win over fit-to-canvas, otherwise the restore flashes
    // briefly then gets overwritten by the fit call here).
    const lMapFinal = manager.getMap();
    if (lMapFinal) {
      lMapFinal.invalidateSize();
      if (!savedAtMount) {
        manager.fitToCanvas(20);
      }
    }
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
        const hasMapBadge = pinnedEl ? hasLinkedSubMap(pinnedEl.id, elements) : false;
        const visual = pinVisualFor(type, hasMapBadge, prefs.pin_tint, prefs.pin_style);
        const anchor: 'center' | 'bottom-tip' = prefs.pin_style === 'pin-shape' ? 'bottom-tip' : 'center';
        entry.manager.updatePin(existing.id, { icon: visual.iconUrl, anchor });
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
let lastStylesRef: unknown = null;
let lastUiRef: unknown = null;
subscribe(() => {
  const state = getState();
  const elements = state.data.elements;
  const selected = state.ui.selectedElementId;
  // World styles (S356) restyle every zone; a ui tick carries the zone
  // panel's hide-a-kind toggle (it has no slice of its own).
  const styles = state.styles;
  const ui = state.ui;
  if (elements === lastElementsRef && selected === lastSelectedRef && styles === lastStylesRef && ui === lastUiRef) return;
  const zonesOnly = elements === lastElementsRef && selected === lastSelectedRef;
  lastElementsRef = elements;
  lastSelectedRef = selected;
  lastStylesRef = styles;
  lastUiRef = ui;
  if (zonesOnly) { refreshActiveMapZones(); return; }
  refreshActiveMapPins();
  // Dims drifted under a BACKGROUND tab (image attached / dims corrected
  // while the tab wasn't active): evict its cache so the next activation
  // mounts a fresh manager in the new coordinate space. The ACTIVE tab's
  // dims-flip is handled by right-pane's dispose+remount machinery (its
  // lastActiveMapDimsKey block) — refreshCachedBackgrounds excludes it, and
  // a second dispose here would race that remount into an empty pane
  // (S300 close-gate follow-up; found by the regression e2e).
  for (const id of refreshCachedBackgrounds()) disposeMapTab(id);
  refreshActiveMapZones();
  syncEditMode();
});
