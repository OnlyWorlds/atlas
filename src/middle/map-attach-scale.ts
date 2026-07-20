/**
 * Apply the blank-canvas → image rescale (DESIGN_MAPS.md §4.2, S300b).
 *
 * Shared by both image-attach paths (the element editor's Local-image row
 * and the image_url field hook). The kernel (core/map-spatial-scale.ts)
 * computes; this walks the patches through the store's typed update methods
 * so every write rides the per-id chains, then the caller refreshes once.
 */

import type { FolderStore } from '../store/folder-store';
import type { CanvasDims } from '../core/map-spatial-scale';
import { scaleSpatialPatches, spatialElementsOnMap } from '../core/map-spatial-scale';

/** Count of pins + markers on the map — for confirm/toast copy. */
export async function countSpatialOnMap(store: FolderStore, mapId: string): Promise<{ pins: number; markers: number }> {
  const elements = await store.listElements();
  const spatial = spatialElementsOnMap(elements, mapId);
  return {
    pins: spatial.filter(e => e.type === 'pin').length,
    markers: spatial.filter(e => e.type === 'marker').length,
  };
}

/** "3 pins and 2 zone points" — shared phrasing for confirm + toast. */
export function spatialPhrase(counts: { pins: number; markers: number }): string {
  const parts: string[] = [];
  if (counts.pins > 0) parts.push(`${counts.pins} pin${counts.pins === 1 ? '' : 's'}`);
  if (counts.markers > 0) parts.push(`${counts.markers} zone point${counts.markers === 1 ? '' : 's'}`);
  return parts.join(' and ');
}

/**
 * Scale every pin/marker on the map from the old canvas into the new one.
 * Returns how many elements were rewritten (0 = nothing to do). The caller
 * owns the single refresh + push after.
 */
export async function rescaleSketchOntoImage(
  store: FolderStore,
  mapId: string,
  from: CanvasDims,
  to: CanvasDims,
): Promise<number> {
  const elements = await store.listElements();
  const patches = scaleSpatialPatches(elements, mapId, from, to);
  for (const p of patches) {
    if (p.type === 'pin') await store.updatePin(p.id, { x: p.x, y: p.y });
    else await store.updateMarker(p.id, { x: p.x, y: p.y });
  }
  return patches.length;
}
