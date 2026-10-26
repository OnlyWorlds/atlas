/**
 * Blank-canvas → image spatial rescale (DESIGN_MAPS.md §4.2).
 *
 * When an image is attached to a map that was a blank flat canvas, the
 * canvas dims change from the stamped square to the image's real size.
 * Pins and zone markers placed on the blank canvas were a SKETCH — their
 * meaning is the relative layout, not the absolute numbers — so they scale
 * proportionally onto the image. (Image→image swaps do NOT scale: there the
 * coords are geography, and the world changing under them is the honest
 * contract — §4.1.)
 *
 * Pure kernel: computes the patches; callers apply them through the store
 * (per-id write chains) and refresh.
 */

import type { Element, Marker, Pin } from './types';

export interface CanvasDims {
  w: number;
  h: number;
}

export interface SpatialScalePatch {
  id: string;
  type: 'pin' | 'marker';
  x: number;
  y: number;
}

/** Pins + zone markers anchored to this map (the two spatial artifact kinds). */
export function spatialElementsOnMap(elements: Element[], mapId: string): (Pin | Marker)[] {
  return elements.filter(
    (e): e is Pin | Marker => (e.type === 'pin' || e.type === 'marker') && (e as Pin | Marker).map_id === mapId,
  );
}

/**
 * Proportional patches for every pin/marker on the map. Rounded to integers
 * (the wire demands them) and clamped into the new canvas so float edges
 * can't land a coord at exactly w+0.4 → w+0. Returns [] when either dims
 * pair is degenerate or the scale is identity.
 */
export function scaleSpatialPatches(
  elements: Element[],
  mapId: string,
  from: CanvasDims,
  to: CanvasDims,
): SpatialScalePatch[] {
  if (!(from.w > 0 && from.h > 0 && to.w > 0 && to.h > 0)) return [];
  if (from.w === to.w && from.h === to.h) return [];
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return spatialElementsOnMap(elements, mapId)
    .filter(e => typeof e.x === 'number' && typeof e.y === 'number')
    .map(e => ({
      id: e.id,
      type: e.type as 'pin' | 'marker',
      x: clamp(Math.round(e.x * (to.w / from.w)), to.w),
      y: clamp(Math.round(e.y * (to.h / from.h)), to.h),
    }));
}
