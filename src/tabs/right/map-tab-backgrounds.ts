/**
 * Map background source resolution + apply.
 *
 * Extracted from map-tab.ts. `applyMapBackground` is called once during
 * mount to install the image (or grid fallback). `refreshCachedBackgrounds`
 * is called from the subscribe hot path to re-apply when image fields
 * change in `data.elements`.
 *
 * `sourceKey` is the diff key — comparing it against `entry.lastBg` lets
 * the subscriber skip re-apply when nothing changed.
 */

import L from 'leaflet';
import { getState, patchSlice } from '../../core/state';
import { getActiveStore } from '../../core/active-store';
import type { WorldMap } from '../../core/types';
import { pickMapImageSource } from './map-image-source';
import { extractEdgeColor } from './edge-color';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';

/**
 * Serialize the picked image source to a comparable key. Used by the
 * subscriber to detect when a cached map's background needs re-applying
 * (e.g. user edits image_url in element-detail).
 */
export function sourceKey(map: WorldMap): string {
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
export async function applyMapBackground(
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
      // First-ever open of a URL-sourced map: the apply blocks on a full
      // decode of the (possibly large, remote) image to learn its dims.
      // Show an honest hint for that window — after this, width/height are
      // persisted on the Map element and the decode never runs again.
      const hint = showLoadingHint(container);
      const decoded = await decodeImageDims(source.url).finally(hint.remove);
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

/**
 * Walk every cached map entry; for any whose source key drifted from
 * `entry.lastBg` (e.g. user edited the map's image_url in element-detail),
 * re-apply the background. Called from map-tab.ts's subscribe hot path.
 */
export function refreshCachedBackgrounds(): void {
  const elements = getState().data.elements;
  for (const entry of mapTabCache.values()) {
    const map = elements.find((e): e is WorldMap => e.type === 'map' && e.id === entry.mapId);
    if (!map) continue;
    const currentKey = sourceKey(map);
    if (currentKey === entry.lastBg) continue;
    entry.ready.then(() =>
      applyMapBackground(entry, map, entry.manager.getConfig().canvasWidth, entry.manager.getConfig().canvasHeight)
    );
  }
}

/**
 * Small centered "loading map image…" chip over the map container while a
 * remote image decode is in flight. Self-removing; safe if the container
 * unmounts first (remove() on a detached node is a no-op).
 */
function showLoadingHint(container: HTMLElement): { remove: () => void } {
  const el = document.createElement('div');
  el.className = 'atlas-map-loading-hint';
  el.textContent = 'loading map image…';
  container.appendChild(el);
  return { remove: () => el.remove() };
}

async function decodeImageDims(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
