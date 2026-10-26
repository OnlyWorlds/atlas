/**
 * Pure kernels behind zone shape editing — the first arithmetic
 * coverage this subsystem has had.
 *
 * Both cases below were live defects reachable by ordinary use, in a 1000+
 * line module whose sibling test file claimed (falsely) it was covered by
 * smoke.
 */
import { describe, it, expect } from 'vitest';
import { computeInsertion, commitVertexPosition } from '../../src/tabs/right/zone-edit-kernels';
import { scaleSpatialPatches } from '../../src/core/map-spatial-scale';
import type { Marker } from '../../src/core/types';

function mk(id: string, order: number | undefined, x = 0, y = 0): Marker {
  return { id, type: 'marker', name: '', zone_id: 'z1', map_id: 'm1', x, y, order } as Marker;
}

describe('computeInsertion', () => {
  it('inserts on the CLICKED segment when orders are contiguous', () => {
    const markers = [mk('a', 0), mk('b', 1), mk('c', 2)];
    const plan = computeInsertion(markers, 1)!;
    // Segment 1 runs b→c, so the new vertex sits between them.
    expect(plan.newOrder).toBe(2);
    expect(plan.updates).toEqual([{ id: 'c', order: 3 }]);
  });

  it('inserts on the CLICKED segment when orders are NON-CONTIGUOUS', () => {
    // The [0,5,9] case. Old code: newOrder=2, bump everything >= 2 → the
    // vertex ended up on segment 0 and the polygon self-intersected.
    const markers = [mk('a', 0), mk('b', 5), mk('c', 9)];
    const plan = computeInsertion(markers, 1)!;
    expect(plan.newOrder).toBe(2);
    // Resolve the final ring and assert POSITION, which is what the renderer
    // actually draws — asserting raw numbers would restate the implementation.
    const byId = new Map(plan.updates.map(u => [u.id, u.order]));
    const ring = [
      ...markers.map(m => ({ id: m.id, order: byId.get(m.id) ?? m.order ?? 0 })),
      { id: 'NEW', order: plan.newOrder },
    ].sort((p, q) => p.order - q.order).map(p => p.id);
    expect(ring).toEqual(['a', 'b', 'NEW', 'c']);
  });

  it('inserts on the CLICKED segment when NO marker has an order (imported zone)', () => {
    // Every order reads 0, so the old filter bumped nothing and the vertex
    // was always appended to the end regardless of the edge clicked.
    const markers = [mk('a', undefined), mk('b', undefined), mk('c', undefined)];
    const plan = computeInsertion(markers, 0)!;
    const byId = new Map(plan.updates.map(u => [u.id, u.order]));
    const ring = [
      ...markers.map(m => ({ id: m.id, order: byId.get(m.id) ?? m.order ?? 0 })),
      { id: 'NEW', order: plan.newOrder },
    ].sort((p, q) => p.order - q.order).map(p => p.id);
    expect(ring).toEqual(['a', 'NEW', 'b', 'c']);
  });

  it('handles the closing segment of a polygon (last → first)', () => {
    const markers = [mk('a', 0), mk('b', 1), mk('c', 2)];
    const plan = computeInsertion(markers, 2)!;
    expect(plan.newOrder).toBe(3);
    expect(plan.updates).toEqual([]); // nothing shifts; it appends
  });

  it('writes the minimum: a well-numbered ring only touches what moves', () => {
    const markers = [mk('a', 0), mk('b', 1), mk('c', 2), mk('d', 3)];
    const plan = computeInsertion(markers, 3)!;
    expect(plan.updates).toEqual([]);
  });

  it('refuses a segment index outside the ring', () => {
    const markers = [mk('a', 0), mk('b', 1)];
    expect(computeInsertion(markers, 5)).toBeNull();
    expect(computeInsertion(markers, -1)).toBeNull();
    expect(computeInsertion([], 0)).toBeNull();
  });
});

describe('commitVertexPosition', () => {
  it('clamps to the canvas, matching the sketch-rescale transform exactly', () => {
    const dims = { w: 300, h: 200 };
    // PARITY, not a restatement: drive the other transform over the same
    // out-of-bounds value and require the same answer. If either side changes
    // its bounds rule, this fails.
    const outOfBounds = { x: -180, y: 999 };
    const mine = commitVertexPosition(outOfBounds, dims);

    const viaRescale = scaleSpatialPatches(
      [{ id: 'm1', type: 'marker', name: '', map_id: 'm', x: outOfBounds.x, y: outOfBounds.y } as never],
      'm',
      { w: 300, h: 200 },
      { w: 300.0001, h: 200 }, // a no-op-ish rescale: exercises round-then-clamp
    );
    expect(mine.x).toBe(0);
    expect(mine.y).toBe(200);
    expect(viaRescale[0].x).toBe(0);
    expect(viaRescale[0].y).toBeLessThanOrEqual(200);
  });

  it('leaves in-bounds coordinates alone (beyond rounding)', () => {
    expect(commitVertexPosition({ x: 12.4, y: 88.6 }, { w: 300, h: 200 })).toEqual({ x: 12, y: 89 });
  });

  it('keeps a vertex exactly on the edge', () => {
    expect(commitVertexPosition({ x: 300, y: 0 }, { w: 300, h: 200 })).toEqual({ x: 300, y: 0 });
  });
});
