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
import { leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import type { Element, Pin, WorldMap } from '../../core/types';
import { pickMapImageSource } from './map-image-source';
// maybeAutoOpenMapFor — auto-open behavior is currently disabled; the helper
// is kept in the codebase for a future opt-in (DESIGN_MAPS.md §3.6).
import { pinVisualFor, onPinVisualsReady } from './pin-visuals';
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

    // Pin click → navigate to that element's detail.
    //
    // Auto-open of an associated map is REMOVED (session 209 revision per
    // Captain): map choice should stay stable when the user is exploring
    // pins, not surprise-switch the right pane. The map-tab cache and the
    // `maybeAutoOpenMapFor` helper remain in the codebase for a possible
    // future re-enable (e.g. as an opt-in setting), but no surface invokes
    // them right now. See DESIGN_MAPS.md §3.6.
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

      const modal = new ElementCreateModal(toasts, {
        // 'map' is hidden in this contextual flow — pins don't target maps
        // (DESIGN_MAPS.md §1.4). The user wants to drop a pin for an element
        // they're creating; that element must be content/loc/etc.
        excludeTypes: ['map'],
        onCreated: async (elementId, elementType) => {
          try {
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
            toasts.success('pin placed');
          } catch (err) {
            console.error('[map-tab] contextual pin create failed:', err);
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
  const minePins = elements.filter((e): e is Pin =>
    e.type === 'pin' && e.map_id === entry.mapId
  );
  const mineIds = new Set(minePins.map(p => p.id));

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
        const visual = pinVisualFor(el.type);
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y, name: el.name, icon: visual.iconUrl });
      } else {
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y });
      }
    } else {
      // New marker — fall back to a friendlier placeholder while element
      // data is still resolving (vs the raw '(element)' string).
      const name = el?.name ?? '(loading…)';
      const type = el?.type ?? 'object';
      const visual = pinVisualFor(type);
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

export function enablePinDrag(entry: MapTabCacheEntry, marker: any, pinId: string): void {
  try {
    if (marker.dragging) marker.dragging.enable();
    else marker.options.draggable = true;
  } catch { /* noop */ }
  const height = entry.manager.getConfig().canvasHeight;
  marker.on('dragend', async () => {
    const latlng = marker.getLatLng();
    const point = leafletToStorage(latlng, height);
    try {
      const store = getActiveStore();
      if (!store) return;
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

export function disposeMapTab(mapId: string): void {
  const entry = cache.get(mapId);
  if (!entry) return;
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
