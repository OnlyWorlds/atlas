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

import { getState, patchSlice, subscribe } from '../../core/state';
import { Leaflet2DManager } from '../../visualization/leaflet-2d/Leaflet2DManager';
import { leafletToStorage } from '../../visualization/leaflet-2d/CoordinateUtils';
import type { Element, Pin, WorldMap } from '../../core/types';
import { pinVisualFor, onPinVisualsReady } from './pin-visuals';
import { ToastManager } from '../../ui/toast-manager';
import { ElementCreateModal } from '../../ui/element-create-modal';
import { getActiveStore } from '../../ui/create-world-modal';
import { extractEdgeColor } from './edge-color';
import { navigate, elementHash } from '../../core/router';

interface MapTabCacheEntry {
  mapId: string;
  worldId: string;
  container: HTMLDivElement;
  manager: Leaflet2DManager;
  objectUrls: string[];
  ready: Promise<void>;
  tooltip: HTMLDivElement;
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
    pane.innerHTML = `<div class="atlas-empty-state">map not found — it may have been deleted.</div>`;
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
  });

  const entry: MapTabCacheEntry = {
    mapId,
    worldId,
    container,
    manager,
    objectUrls: [],
    ready: Promise.resolve(),
    tooltip,
  };
  cache.set(mapId, entry);

  entry.ready = (async () => {
    await manager.init();

    // Background: prefer local media, fall back to image_url, then grid.
    let backgroundApplied = false;

    const applyImage = (url: string, dims: { w: number; h: number }) => {
      manager.setBackgroundImage(url, dims.w, dims.h);
      backgroundApplied = true;
      extractEdgeColor(url).then(color => {
        if (color) {
          container.style.backgroundColor = color;
          const leafEl = container.querySelector('.leaflet-container') as HTMLElement | null;
          if (leafEl) leafEl.style.backgroundColor = color;
        }
      });
    };

    if (map.image_media_id) {
      try {
        const store = getActiveStore();
        const blob = store ? await store.getMediaBlob(map.image_media_id) : null;
        if (blob) {
          const url = URL.createObjectURL(blob);
          entry.objectUrls.push(url);
          const dims = (typeof map.width === 'number' && typeof map.height === 'number' && map.width > 0)
            ? { w: map.width, h: map.height }
            : (await decodeImageDims(url)) ?? { w: width, h: height };
          applyImage(url, dims);
        }
      } catch (err) {
        console.warn('[map-tab] failed to load local media for map:', err);
      }
    }

    if (!backgroundApplied && map.image_url) {
      let dims: { w: number; h: number };
      if (typeof map.width === 'number' && typeof map.height === 'number' && map.width > 0 && map.height > 0) {
        dims = { w: map.width, h: map.height };
      } else {
        const decoded = await decodeImageDims(map.image_url);
        dims = decoded ?? { w: width, h: height };
        if (decoded) {
          const store = getActiveStore();
          if (store) {
            store.updateMap(mapId, { width: decoded.w, height: decoded.h })
              .then(async () => {
                const elements = await store.listElements();
                patchSlice('data', { elements });
              })
              .catch(err => console.warn('[map-tab] dim persist failed:', err));
          }
        }
      }
      applyImage(map.image_url, dims);
    }

    if (!backgroundApplied) {
      manager.setBackgroundGrid(100);
    }

    // Map click → if pin placement is active, drop a pin at this point.
    manager.on('map-click', async (ev) => {
      const placement = getState().ui.pinPlacement;
      if (!placement) return;
      try {
        const store = getActiveStore();
        if (!store) return;
        await store.createPin({
          map_id: entry.mapId,
          element_id: placement.elementId,
          x: ev.point.x,
          y: ev.point.y,
        });
        const elements = await store.listElements();
        patchSlice('data', { elements });
        patchSlice('ui', { ...getState().ui, pinPlacement: null });
        toasts.success('pin placed');
      } catch (err) {
        console.error('[map-tab] create pin failed:', err);
        toasts.error('failed to place pin');
      }
    });

    // Pin click → navigate to that element's detail.
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
      const point = leafletToStorage(latlng, height);

      const modal = new ElementCreateModal(toasts, {
        onCreated: async (elementId) => {
          try {
            const store = getActiveStore();
            if (!store) return;
            await store.createPin({
              map_id: entry.mapId,
              element_id: elementId,
              x: point.x,
              y: point.y,
            });
            const elements = await store.listElements();
            patchSlice('data', { elements });
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
    const name = el?.name ?? '(element)';
    const type = el?.type ?? 'object';
    const visual = pinVisualFor(type);

    if (entry.manager.getPin(pin.id)) {
      entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y, name, icon: visual.iconUrl });
    } else {
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

function enablePinDrag(entry: MapTabCacheEntry, marker: any, pinId: string): void {
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
      await store.updatePin(pinId, { x: point.x, y: point.y });
      const elements = await store.listElements();
      patchSlice('data', { elements });
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

// Subscribe to state so pin changes flow into the visible map.
subscribe(() => { refreshActiveMapPins(); });
