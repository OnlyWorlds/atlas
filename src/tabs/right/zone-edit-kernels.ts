/**
 * Pure kernels for zone shape editing.
 *
 * DELIBERATELY STORE-FREE, DOM-FREE AND LEAFLET-FREE — plain arithmetic over
 * marker records. They lift verbatim.
 *
 * Extracted in S307 because `zone-edit-mode.ts` is 1000+ lines with zero test
 * coverage at any layer (its sibling's "exercised by smoke" comment was
 * false — no e2e drives edit mode at all), and the two defects below are pure
 * arithmetic that no DOM harness is needed to pin down.
 */
import type { Marker } from '../../core/types';

/** A canvas's storage-space dimensions. */
export interface CanvasDims { w: number; h: number }

/**
 * Where a vertex actually lands when a drag is committed.
 *
 * THE BUG THIS CLOSES (S307): the vertex-drag commit rounded and wrote
 * straight through with NO bounds guard, while `scaleSpatialPatches`
 * (`core/map-spatial-scale.ts`, the sketch-rescale path) clamps every
 * coordinate to `[0, max]`. Two transforms over the same coordinate space
 * disagreeing on their bounds rule is how the S300 pin-corruption class
 * happens: CRS.Simple happily lets a vertex be dragged well past the canvas
 * edge, so a zone could hold x = -180. Attach an image to that map later and
 * the rescale multiplies by the ratio then clamps to 0 — that one vertex
 * snaps to the edge while every in-bounds vertex scales proportionally, and
 * the polygon deforms.
 *
 * Kept in the same shape as `scaleSpatialPatches` on purpose (round, then
 * clamp to [0, max]) so the two cannot drift apart again; the test asserts
 * parity against it directly rather than restating the rule.
 */
export function commitVertexPosition(pt: { x: number; y: number }, dims: CanvasDims): { x: number; y: number } {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  return {
    x: clamp(Math.round(pt.x), dims.w),
    y: clamp(Math.round(pt.y), dims.h),
  };
}

export interface InsertionPlan {
  /** `order` for the newly inserted marker. */
  newOrder: number;
  /** Existing markers whose `order` must change, with their new values. */
  updates: Array<{ id: string; order: number }>;
}

/**
 * Plan the order values for inserting a vertex into segment `segmentIndex`.
 *
 * `zoneMarkers` arrives SORTED BY ORDER (markersForZoneOnMap), so
 * `segmentIndex` is an ARRAY INDEX: segment i runs from marker[i] to
 * marker[(i+1) % len].
 *
 * THE BUG THIS CLOSES (S307): the old code did `newOrder = segmentIndex + 1`
 * and then bumped every marker whose ORDER VALUE was >= that number. Index
 * and order are only interchangeable when the orders happen to be exactly
 * 0..n-1, which the renderer's own docstring warns is not guaranteed for
 * legacy or imported data. Two real failures fell out of that:
 *
 *   - orders [0, 5, 9], click segment 1 (between the 5 and the 9):
 *     newOrder = 2, bump everything >= 2 → 5→6, 9→10, new marker at 2.
 *     Sorted: 0, 2, 6, 10 — the vertex landed between the FIRST and SECOND
 *     markers, i.e. segment 0. The polygon visibly self-intersects.
 *   - an imported zone with no `order` fields at all (every marker reads 0):
 *     nothing is ever >= newOrder, so nothing bumps and the vertex is
 *     APPENDED to the end no matter which edge was clicked.
 *
 * The fix renumbers the whole ring to 0..n by POSITION, which also normalises
 * degenerate order data as a side effect — the same thing `deleteMarkerInEdit`
 * already does to close gaps, and evidence the codebase knew orders drift.
 * Only markers whose order actually changes appear in `updates`, so a
 * well-numbered ring still writes the minimum.
 */
export function computeInsertion(zoneMarkers: Marker[], segmentIndex: number): InsertionPlan | null {
  const len = zoneMarkers.length;
  if (len === 0) return null;
  if (segmentIndex < 0 || segmentIndex >= len) return null;

  // The new vertex sits at array position segmentIndex + 1. For the closing
  // segment of a polygon (last → first) that is the end of the ring.
  const insertAt = segmentIndex + 1;

  const updates: Array<{ id: string; order: number }> = [];
  for (let i = 0; i < len; i++) {
    // Positions at or after the insertion point shift up by one.
    const nextOrder = i < insertAt ? i : i + 1;
    if ((zoneMarkers[i].order ?? 0) !== nextOrder) {
      updates.push({ id: zoneMarkers[i].id, order: nextOrder });
    }
  }
  return { newOrder: insertAt, updates };
}
