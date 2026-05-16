/**
 * Map tab renderer — one Leaflet2DManager instance per open map.
 *
 * Lifecycle:
 *   - module-level `cache` keyed by mapId holds (container, manager, objectUrls).
 *   - `mountMapTab(target, mapId, toasts)` attaches cached container or creates fresh.
 *   - `disposeMapTab(mapId)` destroys manager, revokes object URLs, drops cache entry.
 *   - `disposeAllMapTabs()` is called on world switch.
 *
 * Pin sync: every time the elements cache changes, find pins for this map
 * (data.elements filtered by type==='pin' && map_id===mapId) and reconcile
 * Leaflet markers (add missing, remove stale, update existing).
 */

import L from 'leaflet';
import { getState, patchSlice, subscribe } from '../../core/state';
import { Leaflet2DManager } from '../../visualization/leaflet-2d/Leaflet2DManager';
import { leafletToStorage, storageToLeaflet } from '../../visualization/leaflet-2d/CoordinateUtils';
import type { Element, Pin, WorldMap } from '../../core/types';
import { pickMapImageSource } from './map-image-source';
import { pinVisualFor, onPinVisualsReady } from './pin-visuals';
import { toggleGhostsAtSourcePin, disposeGhostsForMap } from './ghost-pins';
import { getAssociatedMaps } from './auto-open-map';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../../core/constants';
import { ToastManager } from '../../ui/toast-manager';
import { ElementCreateModal } from '../../ui/element-create-modal';
import { getActiveStore } from '../../ui/create-world-modal';
import { extractEdgeColor } from './edge-color';
import { navigate, elementHash } from '../../core/router';
import { requestPushIfLinked } from '../../sync/sync-attach';

interface MapTabCacheEntry {
  mapId: string;
  worldId: string;
  container: HTMLDivElement;
  manager: Leaflet2DManager;
  objectUrls: string[];
  ready: Promise<void>;
  tooltip: HTMLDivElement;
  /**
   * Trash drop-zone overlay used by pin drag-to-delete (DESIGN_MAPS.md §3.5
   * smoke note session 211). Hidden by default; shown only while a pin is
   * being dragged. Drop a pin on top → pin is deleted.
   */
  trashZone: HTMLDivElement;
  /**
   * Pin filter chip strip — top-left overlay. One chip per element type
   * present in this map's pins. Click chip toggles `hiddenPinTypes`.
   */
  chipStrip: HTMLDivElement;
  /**
   * Per-tab in-memory set of element types whose pins are hidden on this
   * map. Default empty (all visible). Reset on tab dispose. Pure UX pref —
   * never persisted.
   */
  hiddenPinTypes: Set<string>;
  /**
   * Snapshot of the image source last used to render the background. When the
   * map element's image fields change (URL edited, local file added/removed),
   * the subscriber compares and re-applies. Stored as the same shape as
   * pickMapImageSource so we don't recompute on every notification.
   */
  lastBg: string;
}

const cache = new Map<string, MapTabCacheEntry>();
let containerSeq = 0;

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

  const cached = cache.get(mapId);
  if (cached) {
    pane.appendChild(cached.container);
    cached.ready.then(() => {
      cached.manager.getMap()?.invalidateSize();
      syncPins(cached);
    });
    return;
  }

  // Fresh mount
  const container = document.createElement('div');
  container.id = `atlas-map-${++containerSeq}`;
  container.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  pane.appendChild(container);

  const tooltip = document.createElement('div');
  tooltip.className = 'atlas-pin-tooltip';
  tooltip.style.display = 'none';
  container.appendChild(tooltip);

  // Trash drop-zone — top-right of the map canvas, hidden until a pin drag
  // begins. Drop the pin on it → pin deletion. Pointer-events: none keeps it
  // from intercepting other clicks; it doesn't need to BE a drop target in
  // the HTML5 sense — we check the marker's released latlng against this
  // div's screen rect.
  const trashZone = document.createElement('div');
  trashZone.className = 'atlas-pin-trash-zone';
  trashZone.setAttribute('data-active', 'false');
  trashZone.innerHTML = '<span class="material-symbols-outlined">delete</span><span>drop to delete</span>';
  container.appendChild(trashZone);

  // Pin filter chip strip — top-left overlay showing element types present
  // in this map's pins. Click chip → toggle visibility for that type. Per-
  // tab in-memory only; cleared on dispose. Populated on every render of
  // refreshChipStrip (driven by syncPins notifications).
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
    // maxBounds is in storage-coord form [[minX, minY], [maxX, maxY]].
    maxBounds: [[0, 0], [width, height]],
  });

  const entry: MapTabCacheEntry = {
    mapId,
    worldId,
    container,
    manager,
    objectUrls: [],
    ready: Promise.resolve(),
    tooltip,
    trashZone,
    chipStrip,
    hiddenPinTypes: new Set(),
    lastBg: '',
  };
  cache.set(mapId, entry);

  entry.ready = (async () => {
    await manager.init();

    // Background source precedence (DESIGN_MAPS.md §4): image_url > image_media_id > grid.
    // pickMapImageSource encodes the rule (unit-tested in tests/unit/map-image-source.test.ts).
    await applyMapBackground(entry, map, width, height);

    // Map click → if pin placement is active, drop a pin at this point.
    manager.on('map-click', async (ev) => {
      const placement = getState().ui.pinPlacement;
      if (!placement) return;
      // Gate: pin placement requires a map image (DESIGN_MAPS.md §pin-coords
      // strict rule, session 209). The 2000-default grid canvas exists for
      // visual fallback only — pin coords placed there would diverge from
      // the canvas the user actually intended (the image), producing pins
      // that render outside image bounds once the image arrives.
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
          // OW API requires integer pin coordinates. Clamp to canvas bounds
          // as defense in depth — Leaflet maxBounds restricts panning but
          // doesn't guarantee click events stay within bounds at every zoom.
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
    // Look up the pin's data from state to get the real pin coords + element
    // ref. Leaflet2DManager already stops propagation in its marker
    // contextmenu handler so the map-level "new pin" modal doesn't also fire.
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
      // Same gate as the placement-banner map-click path: no image, no pins.
      const currentMap = getState().data.elements.find(
        (em): em is WorldMap => em.type === 'map' && em.id === entry.mapId,
      );
      if (!currentMap || (!currentMap.image_url && !currentMap.image_media_id)) {
        toasts.info('set a map image first — pins anchor to the image');
        return;
      }
      const point = leafletToStorage(latlng, height);

      // Shared pin-write closure used by both Create (new element + pin) and
      // Place (pin pointing at existing element). Coords are captured from the
      // click point — they don't change between the two paths.
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
        // 'map' is hidden in this contextual flow — pins don't target maps
        // (DESIGN_MAPS.md §1.4). The user wants to drop a pin for an element
        // they're creating or placing; the target must be content/loc/etc.
        excludeTypes: ['map'],
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

    // Drag-from-sidebar → drop creates a pin (DESIGN_MAPS.md §8 — was
    // deferred from legacy). The sidebar's elements list marks rows as
    // draggable and sets a custom MIME payload `application/x-atlas-element`
    // with `{id, type}`. Drop fires on the map container; we project the
    // drop point into image coords and write a pin via the same path as
    // contextual right-click create.
    container.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('application/x-atlas-element')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      container.classList.add('atlas-map-drop-target');
    });
    container.addEventListener('dragleave', (e) => {
      // dragleave fires for child elements too; only clear when leaving the
      // container itself (relatedTarget outside container).
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
      // Same image-presence gate as the click + contextmenu paths
      // (DESIGN_MAPS.md §4.1). Image-less maps cannot accept pins.
      const currentMap = getState().data.elements.find(
        (em): em is WorldMap => em.type === 'map' && em.id === entry.mapId,
      );
      if (!currentMap || (!currentMap.image_url && !currentMap.image_media_id)) {
        toasts.info('set a map image first — pins anchor to the image');
        return;
      }
      const lMap = manager.getMap();
      if (!lMap) return;
      // DragEvent extends MouseEvent in the DOM spec; Leaflet's
      // mouseEventToLatLng accepts the drop event directly.
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

    // Auto-fit only when 2+ pins exist.
    const pinsHere = getState().data.elements.filter((e): e is Pin =>
      e.type === 'pin' && e.map_id === entry.mapId
    );
    if (pinsHere.length >= 2) manager.fitBounds(40, -1);
    manager.getMap()?.invalidateSize();
  })();

  entry.ready.catch(err => console.error('[map-tab] init failed:', err));
}

function syncPins(entry: MapTabCacheEntry): void {
  const elements = getState().data.elements;
  const allMinePins = elements.filter((e): e is Pin =>
    e.type === 'pin' && e.map_id === entry.mapId
  );
  // Pin filter chip strip (DESIGN_MAPS.md §3 polish, session 211 bout PF):
  // pins whose element_type is in hiddenPinTypes are treated as removed —
  // syncPins removes their markers from the manager. Toggling a chip on the
  // strip is a syncPins re-call, so add/remove flips naturally.
  const minePins = allMinePins.filter(p => !entry.hiddenPinTypes.has(p.element_type ?? ''));
  const mineIds = new Set(minePins.map(p => p.id));

  // Refresh the chip strip on every sync — type set may have changed if a
  // pin was added/removed/element type changed.
  refreshChipStrip(entry, allMinePins);

  for (const existing of entry.manager.getAllPins()) {
    if (!mineIds.has(existing.id)) entry.manager.removePin(existing.id);
  }

  for (const pin of minePins) {
    const el = elements.find(e => e.id === pin.element_id);
    const existing = entry.manager.getPin(pin.id);

    if (existing) {
      // Update only the fields whose source data is reliable. Element lookup
      // can briefly fail during sync transitions (an in-flight id-swap on a
      // referenced element races the pin's element_id update). Overwriting
      // the label to '(element)' in that window produces a visible flicker
      // on reload. Keep the prior label and icon when lookup misses; the
      // next subscriber tick after sync settles will re-resolve cleanly.
      if (el) {
        const hasMapBadge = getAssociatedMaps(el.id, elements).length > 0;
        const visual = pinVisualFor(el.type, hasMapBadge);
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y, name: el.name, icon: visual.iconUrl });
      } else {
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y });
      }
    } else {
      // New marker — fall back to a friendlier placeholder while element
      // data is still resolving (vs the raw '(element)' string).
      const name = el?.name ?? '(loading…)';
      const type = el?.type ?? 'object';
      const hasMapBadge = el ? getAssociatedMaps(el.id, elements).length > 0 : false;
      const visual = pinVisualFor(type, hasMapBadge);
      const added = entry.manager.addPin({
        id: pin.id,
        name,
        type,
        x: pin.x,
        y: pin.y,
        icon: visual.iconUrl,
        scale: 1,
      });
      enablePinDrag(entry, added.marker, pin.id);
    }
  }
}

/**
 * Re-render the pin-filter chip strip from the current pin set. One chip per
 * distinct element_type, in canonical ELEMENT_LABELS order. Each chip shows
 * the category icon + count. Active = type is visible (default); muted +
 * `data-hidden="true"` = type is hidden. Click toggles `hiddenPinTypes` and
 * re-syncs pins.
 *
 * Hidden when 0 distinct types (nothing to filter) or 1 type (toggling all
 * off would empty the map — not useful as a chip strip).
 */
function refreshChipStrip(entry: MapTabCacheEntry, allMinePins: Pin[]): void {
  const elements = getState().data.elements;
  const countByType = new Map<string, number>();
  for (const pin of allMinePins) {
    let type = pin.element_type;
    if (!type) {
      // Defensive: legacy pins missing element_type — resolve from the
      // referenced element. The engine self-heal writes it back on push,
      // but the local cache may not reflect that until next refresh.
      const el = elements.find(e => e.id === pin.element_id);
      type = el?.type ?? '';
    }
    if (!type) continue;
    countByType.set(type, (countByType.get(type) ?? 0) + 1);
  }

  if (countByType.size < 2) {
    entry.chipStrip.innerHTML = '';
    entry.chipStrip.setAttribute('data-active', 'false');
    return;
  }

  entry.chipStrip.setAttribute('data-active', 'true');
  entry.chipStrip.innerHTML = '';
  // Render in alpha order by singular label (stable per render).
  const types = [...countByType.keys()].sort((a, b) => {
    const aL = ELEMENT_LABELS[a as keyof typeof ELEMENT_LABELS]?.singular ?? a;
    const bL = ELEMENT_LABELS[b as keyof typeof ELEMENT_LABELS]?.singular ?? b;
    return aL.localeCompare(bL);
  });
  for (const type of types) {
    const count = countByType.get(type)!;
    const hidden = entry.hiddenPinTypes.has(type);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'atlas-pin-filter-chip';
    chip.setAttribute('data-type', type);
    chip.setAttribute('data-hidden', String(hidden));
    const label = ELEMENT_LABELS[type as keyof typeof ELEMENT_LABELS]?.singular ?? type;
    chip.title = hidden
      ? `${count} ${label}${count === 1 ? '' : 's'} hidden — click to show`
      : `${count} ${label}${count === 1 ? '' : 's'} shown — click to hide`;
    const iconName = ELEMENT_ICONS[type as keyof typeof ELEMENT_ICONS] ?? 'category';
    chip.innerHTML = `<span class="material-symbols-outlined">${iconName}</span><span class="atlas-pin-filter-chip-count">${count}</span>`;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (entry.hiddenPinTypes.has(type)) entry.hiddenPinTypes.delete(type);
      else entry.hiddenPinTypes.add(type);
      syncPins(entry);
    });
    entry.chipStrip.appendChild(chip);
  }
}

export function enablePinDrag(entry: MapTabCacheEntry, marker: any, pinId: string): void {
  try {
    if (marker.dragging) marker.dragging.enable();
    else marker.options.draggable = true;
  } catch { /* noop */ }
  const height = entry.manager.getConfig().canvasHeight;

  // Reveal the trash drop-zone when drag starts; live-track hover so it
  // highlights as the user passes over it; on drop, decide between delete
  // (over zone) or move (anywhere else). Also hide the hover tooltip — if
  // the user starts a drag with the tooltip showing, no mouseout fires
  // during the drag and the tooltip would hang after delete (session 211
  // smoke note from Captain).
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
        const elements = await store.listElements();
        patchSlice('data', { elements });
        requestPushIfLinked();
        // No toast — the visual zone + the disappearance of the marker are
        // the feedback. Could surface "pin deleted" via toastManager if
        // Captain wants extra confirmation, but the action is its own UX.
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
  // markerScreen is container-point; convert to client coords.
  const mx = containerRect.left + markerScreen.x;
  const my = containerRect.top + markerScreen.y;
  return (
    mx >= zoneRect.left &&
    mx <= zoneRect.right &&
    my >= zoneRect.top &&
    my <= zoneRect.bottom
  );
}

export function disposeMapTab(mapId: string): void {
  const entry = cache.get(mapId);
  if (!entry) return;
  // Ghost pins live on a Leaflet layer attached to entry.manager's L.Map. Tear
  // them down BEFORE the manager destroy so the layer detach goes cleanly;
  // after destroy the L.Map handle is gone.
  try {
    const lMap = entry.manager.getMap();
    disposeGhostsForMap(mapId, lMap ?? null);
  } catch { /* noop */ }
  try { entry.manager.destroy(); } catch { /* noop */ }
  for (const url of entry.objectUrls) {
    try { URL.revokeObjectURL(url); } catch { /* noop */ }
  }
  if (entry.container.parentElement) entry.container.parentElement.removeChild(entry.container);
  cache.delete(mapId);
}

export function disposeAllMapTabs(): void {
  for (const id of [...cache.keys()]) disposeMapTab(id);
}

/**
 * Pan an open map tab to a given storage-coord pin position AND set a
 * comfortable zoom level. Used by the element-detail top bar's `[pin]`
 * cluster — click → openMapTab(map) and then center on the pin's stored
 * x/y at moderate zoom. Waits for the tab's `ready` promise so freshly-
 * opened tabs settle before the camera moves.
 *
 * The chosen zoom is `1` (positive ≈ zoomed in vs the default `initialZoom: -1`
 * full-canvas view). Avoids the previous behavior where panTo retained the
 * fresh tab's zoom-far-out level, leaving the pin lost in a wide view.
 *
 * No-op if the map tab isn't in the cache (caller should openMapTab first).
 */
export function panMapTabTo(mapId: string, x: number, y: number): void {
  const entry = cache.get(mapId);
  if (!entry) return;
  entry.ready.then(() => {
    try {
      const lMap = entry.manager.getMap();
      if (!lMap) return;
      // Storage → leaflet coord. Leaflet's CRS.Simple uses LatLng [y, x] with
      // y inverted relative to storage Y-down. Use the manager's coord
      // transform helper indirectly via storageToLeaflet — accessed via the
      // map's canvasHeight (config).
      const height = entry.manager.getConfig().canvasHeight;
      const latlng = storageToLeaflet({ x, y }, height);
      lMap.setView(latlng, 1, { animate: true, duration: 0.4 } as L.ZoomPanOptions);
    } catch (err) {
      console.error('[map-tab] panMapTabTo failed:', err);
    }
  });
}

/** Re-sync pins for whichever map is currently visible. Subscribe to state and call this. */
export function refreshActiveMapPins(): void {
  const ui = getState().ui;
  const active = ui.rightTabs[ui.rightActiveIndex];
  if (!active || active.kind !== 'map') return;
  const entry = cache.get(active.mapId);
  if (!entry) return;
  entry.ready.then(() => syncPins(entry));
}

/**
 * Clamp a pin coord to [0, max]. Defense-in-depth alongside Leaflet's
 * maxBounds (DESIGN_MAPS.md §4.1) — guarantees no stored pin coord is
 * outside the map's canvas, regardless of where the click event actually
 * fired (Leaflet maxBounds restricts panning but isn't 100% reliable at
 * every zoom level and on all input devices).
 */
function clampToCanvas(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > max) return max;
  return value;
}

/**
 * Serialize the picked image source to a comparable key. Used by the
 * subscriber to detect when a cached map's background needs re-applying
 * (e.g. user edits image_url in element-detail).
 */
function sourceKey(map: WorldMap): string {
  const s = pickMapImageSource(map);
  if (s.kind === 'url') return `url:${s.url}`;
  if (s.kind === 'local') return `local:${s.mediaId}`;
  return 'grid';
}

/**
 * Apply the map's current image source to its rendered background. Idempotent
 * given a stable `map` — calling repeatedly with the same source is fine
 * (Leaflet2DManager handles re-set). Stamps `entry.lastBg` with the key so
 * subscribers can compare against subsequent renders.
 */
async function applyMapBackground(
  entry: MapTabCacheEntry,
  map: WorldMap,
  defaultWidth: number,
  defaultHeight: number,
): Promise<void> {
  const source = pickMapImageSource(map);
  const manager = entry.manager;
  const container = entry.container;
  let backgroundApplied = false;

  const applyImage = (url: string, dims: { w: number; h: number }) => {
    manager.setBackgroundImage(url, dims.w, dims.h);
    backgroundApplied = true;
    // Recenter camera + reset maxBounds to the new image bounds whenever
    // the background is applied. Important when the image's dims differ
    // from the manager's construction-time canvas (e.g. user adds image_url
    // to a map that initially had no image — the manager was built with
    // 2000×2000 default but the image is much smaller; without this the
    // camera lands outside the image, "too far top right," and the next
    // click via the placement banner produces out-of-bounds storage coords).
    const lMap = manager.getMap();
    if (lMap) {
      const bounds = L.latLngBounds(L.latLng(0, 0), L.latLng(dims.h, dims.w));
      lMap.setMaxBounds(bounds);
      lMap.fitBounds(bounds, { padding: [20, 20], animate: false });
    }
    extractEdgeColor(url).then(color => {
      if (color) {
        container.style.backgroundColor = color;
        const leafEl = container.querySelector('.leaflet-container') as HTMLElement | null;
        if (leafEl) leafEl.style.backgroundColor = color;
      }
    });
  };

  if (source.kind === 'url') {
    let dims: { w: number; h: number };
    if (typeof map.width === 'number' && typeof map.height === 'number' && map.width > 0 && map.height > 0) {
      dims = { w: map.width, h: map.height };
    } else {
      const decoded = await decodeImageDims(source.url);
      dims = decoded ?? { w: defaultWidth, h: defaultHeight };
      if (decoded) {
        const store = getActiveStore();
        if (store) {
          store.updateMap(map.id, { width: decoded.w, height: decoded.h })
            .then(async () => {
              const elements = await store.listElements();
              patchSlice('data', { elements });
            })
            .catch(err => console.warn('[map-tab] dim persist failed:', err));
        }
      }
    }
    applyImage(source.url, dims);
  } else if (source.kind === 'local') {
    try {
      const store = getActiveStore();
      const blob = store ? await store.getMediaBlob(source.mediaId) : null;
      if (blob) {
        const url = URL.createObjectURL(blob);
        entry.objectUrls.push(url);
        const dims = (typeof map.width === 'number' && typeof map.height === 'number' && map.width > 0)
          ? { w: map.width, h: map.height }
          : (await decodeImageDims(url)) ?? { w: defaultWidth, h: defaultHeight };
        applyImage(url, dims);
      }
    } catch (err) {
      console.warn('[map-tab] failed to load local media for map:', err);
    }
  }

  if (!backgroundApplied) {
    manager.setBackgroundGrid(100);
  }

  entry.lastBg = sourceKey(map);
}

async function decodeImageDims(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ));
}

function buildPinTooltipHtml(el: Element): string {
  const parts: string[] = [];
  parts.push(`<div class="atlas-pin-tooltip-name">${escapeHtml(el.name || '(unnamed)')}</div>`);
  const subBits: string[] = [];
  const supertype = (el as any).supertype;
  const subtype = (el as any).subtype;
  if (supertype) subBits.push(String(supertype));
  if (subtype) subBits.push(String(subtype));
  const typeLine = subBits.length > 0 ? subBits.join(' · ') : String(el.type);
  parts.push(`<div class="atlas-pin-tooltip-type">${escapeHtml(typeLine)}</div>`);
  const desc = typeof (el as any).description === 'string' ? (el as any).description.trim() : '';
  if (desc) {
    const clipped = desc.length > 140 ? desc.slice(0, 140) + '…' : desc;
    parts.push(`<div class="atlas-pin-tooltip-desc">${escapeHtml(clipped)}</div>`);
  }
  return parts.join('');
}

// When pin visuals (canvas icons via Material Symbols font) become available
// later, swap icons on all existing rendered pins in place.
onPinVisualsReady(() => {
  for (const entry of cache.values()) {
    entry.ready.then(() => {
      const elements = getState().data.elements;
      for (const existing of entry.manager.getAllPins()) {
        const pin = elements.find((e): e is Pin => e.type === 'pin' && e.id === existing.id);
        if (!pin) continue;
        const type = elements.find(e => e.id === pin.element_id)?.type ?? 'object';
        const visual = pinVisualFor(type);
        entry.manager.updatePin(existing.id, { icon: visual.iconUrl });
      }
    });
  }
});

// Subscribe to state so pin AND background changes flow into visible maps.
// HOT-PATH NARROWING (DESIGN_MAPS.md §10b MR): the subscribe fires on every
// notification — including unrelated ones like sidebar mode toggles, filter
// chip clicks, every keystroke in element-detail edits. Pin sync and
// background re-apply are cheap (early-returns when no diff) but they walk
// the elements array. Track the last seen reference and short-circuit when
// data.elements hasn't changed since last render.
let lastElementsRef: unknown = null;
subscribe(() => {
  const elements = getState().data.elements;
  if (elements === lastElementsRef) return;
  lastElementsRef = elements;
  refreshActiveMapPins();
  refreshCachedBackgrounds();
});

function refreshCachedBackgrounds(): void {
  const elements = getState().data.elements;
  for (const entry of cache.values()) {
    const map = elements.find((e): e is WorldMap => e.type === 'map' && e.id === entry.mapId);
    if (!map) continue;
    const currentKey = sourceKey(map);
    if (currentKey === entry.lastBg) continue;
    entry.ready.then(() =>
      applyMapBackground(entry, map, entry.manager.getConfig().canvasWidth, entry.manager.getConfig().canvasHeight)
    );
  }
}
