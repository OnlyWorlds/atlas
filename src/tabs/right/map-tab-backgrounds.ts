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
import { findWorld } from '../../registry/registry';
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
  // Dims are part of the image-render contract (they set the overlay bounds),
  // so a dims write must drift the key. Without this, adding image_url to a
  // dims-stamped imageless map painted the image stretched into the old
  // square and the later autoUpdateMapDims persist never re-applied (S300
  // close-gate MED).
  const dims = `${typeof map.width === 'number' ? map.width : ''}x${typeof map.height === 'number' ? map.height : ''}`;
  if (s.kind === 'url') return `url:${s.url}:${dims}`;
  if (s.kind === 'local') return `local:${s.mediaId}:${dims}`;
  // Flat canvas: background_color is part of the render, so an edit to it
  // must drift the key (the subscriber re-applies live).
  return `flat:${typeof map.background_color === 'string' ? map.background_color : ''}`;
}

/**
 * Guarded fire-and-forget elements refresh after a background-path dims
 * persist: only patch state when the SAME world is still active (a fast
 * world switch parks the old store, whose listElements would otherwise
 * stomp the new world's elements — the S295 superseded-activation class,
 * re-found by the S300 close gate).
 */
async function refreshElementsIfStillActive(store: NonNullable<ReturnType<typeof getActiveStore>>, worldId: string): Promise<void> {
  const elements = await store.listElements();
  if (getState().active?.worldId !== worldId) return;
  patchSlice('data', { elements });
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

  // A prior apply's failure chip is stale the moment we re-apply.
  container.querySelector('.atlas-map-imgfail-hint')?.remove();

  // The flat-canvas paint (imageless maps AND the broken-image fallback):
  // background_color when set, quiet default otherwise, app-dark surround —
  // Leaflet's default container background is near-white (#ddd) and image
  // maps always mask it via edge-color, so every non-image path must set
  // the surround itself (own-eyes, S300).
  const applyFlat = () => {
    const bg = typeof map.background_color === 'string' && map.background_color.trim()
      ? map.background_color.trim()
      : undefined;
    container.style.backgroundColor = '#0a0a0a';
    const leafEl = container.querySelector('.leaflet-container') as HTMLElement | null;
    if (leafEl) leafEl.style.backgroundColor = '#0a0a0a';
    manager.setBackgroundFlat(bg);
  };

  const applyImage = (url: string, dims: { w: number; h: number }) => {
    manager.setBackgroundImage(url, dims.w, dims.h, () => {
      // Load failed (404, CORS, dead host): fall back to the flat canvas
      // with an honest chip instead of Leaflet's broken-image void (S300b).
      // The stored dims keep the coordinate space; pins stay where they are.
      applyFlat();
      const hint = document.createElement('div');
      hint.className = 'atlas-map-loading-hint atlas-map-imgfail-hint';
      hint.textContent = 'map image failed to load; showing the blank canvas';
      container.appendChild(hint);
    });
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
      // Padded like the construction-time bounds (S316): exact-rect bounds +
      // solid viscosity would pin a small image immovably; the pad restores
      // breathing room while the edge stays firm. Fit still targets the
      // UNPADDED image rect so the landing view is the image, not the margin.
      lMap.setMaxBounds(bounds.pad(0.15));
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
        const worldId = getState().active?.worldId;
        if (store && worldId) {
          store.updateMap(map.id, { width: decoded.w, height: decoded.h })
            .then(() => refreshElementsIfStillActive(store, worldId))
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
    // Flat canvas (DESIGN_MAPS.md §4.2): imageless maps are first-class — a
    // sized flat backdrop; the ⚙ grid overlay composes on top for users who
    // want scaffolding.
    applyFlat();
    // Durable coordinate space: legacy imageless maps predate the stored-dims
    // contract — persist the runtime default ONCE so future renders can't
    // drift (new imageless maps get dims stamped at create). LOCAL-ONLY
    // worlds only (S300 close gate): on api-linked worlds a mere tab open
    // would dirty the element (phantom push to other devices) and on
    // view-only worlds the write throws — there, the deterministic
    // IMAGELESS_MAP_SIZE runtime fallback carries the space instead, which
    // is why that constant is frozen for legacy dimless maps.
    if (!(typeof map.width === 'number' && map.width > 0 && typeof map.height === 'number' && map.height > 0)) {
      const store = getActiveStore();
      const worldId = getState().active?.worldId;
      // Memory, not storage: `loadRegistry` re-bases the two-tab merge and is
      // boot-only (S365 gate lens A L1).
      const entryReg = worldId ? findWorld(getState().registry, worldId) : undefined;
      if (store && worldId && entryReg && !entryReg.api) {
        store.updateMap(map.id, { width: defaultWidth, height: defaultHeight })
          .then(() => refreshElementsIfStillActive(store, worldId))
          .catch(err => console.warn('[map-tab] imageless dim persist failed:', err));
      }
    }
  }

  entry.lastBg = sourceKey(map);
}

/**
 * Walk every cached map entry; for any whose source key drifted from
 * `entry.lastBg` (e.g. user edited the map's image_url in element-detail),
 * re-apply the background. Called from map-tab.ts's subscribe hot path.
 *
 * Returns the mapIds of BACKGROUND (non-active) tabs whose STORED DIMS no
 * longer match the mounted manager's canvas (image-sourced maps only). A
 * background re-apply cannot fix those — the cached manager and interaction
 * wiring converted coordinates in the mount-time space, so pins placed after
 * activation would corrupt (y-flip against the wrong height). The caller
 * evicts them so the next activation mounts fresh. The ACTIVE tab is
 * deliberately excluded: right-pane's dims-flip machinery (its
 * lastActiveMapDimsKey block) already disposes + remounts it on the same
 * tick, and a second dispose here races that remount into an empty pane.
 * (S300 close gate; the background-tab leg predates S300 but the imageless
 * "place pins now, add art later" flow made it common.)
 */
export function refreshCachedBackgrounds(): string[] {
  const state = getState();
  const elements = state.data.elements;
  const activeTab = state.ui.rightTabs[state.ui.rightActiveIndex];
  const activeMapId = activeTab?.kind === 'map' ? activeTab.mapId : null;
  const evictBackground: string[] = [];
  for (const entry of mapTabCache.values()) {
    const map = elements.find((e): e is WorldMap => e.type === 'map' && e.id === entry.mapId);
    if (!map) continue;
    const currentKey = sourceKey(map);
    if (currentKey === entry.lastBg) continue;
    const src = pickMapImageSource(map);
    const cfg = entry.manager.getConfig();
    const dimsDrifted =
      src.kind !== 'flat' &&
      typeof map.width === 'number' && map.width > 0 &&
      typeof map.height === 'number' && map.height > 0 &&
      (cfg.canvasWidth !== map.width || cfg.canvasHeight !== map.height);
    if (dimsDrifted) {
      if (entry.mapId !== activeMapId) evictBackground.push(entry.mapId);
      // Active tab: leave it — right-pane remounts it this tick.
      continue;
    }
    entry.ready.then(() =>
      applyMapBackground(entry, map, cfg.canvasWidth, cfg.canvasHeight)
    );
  }
  return evictBackground;
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
