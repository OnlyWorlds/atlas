/**
 * Blank-canvas → image rescale kernel (DESIGN_MAPS.md §4.2).
 *
 * The contract: pins + zone markers on the map scale proportionally from the
 * old canvas into the new; other maps' artifacts and non-spatial elements
 * are untouched; outputs are integer + clamped; degenerate or identity
 * dims produce no patches.
 */

import { describe, it, expect } from 'vitest';
import { scaleSpatialPatches, spatialElementsOnMap } from '../../src/core/map-spatial-scale';
import type { Element } from '../../src/core/types';

const el = (partial: Record<string, unknown>): Element => partial as unknown as Element;

const world: Element[] = [
  el({ id: 'p1', type: 'pin', map_id: 'M', element_id: 'c1', x: 1000, y: 500 }),
  el({ id: 'p2', type: 'pin', map_id: 'M', element_id: 'c2', x: 2000, y: 2000 }),
  el({ id: 'p3', type: 'pin', map_id: 'OTHER', element_id: 'c3', x: 100, y: 100 }),
  el({ id: 'm1', type: 'marker', map_id: 'M', zone_id: 'z1', x: 0, y: 1500 }),
  el({ id: 'm2', type: 'marker', map_id: 'M', zone_id: 'z1', x: 333, y: 667 }),
  el({ id: 'c1', type: 'character', name: 'Bystander' }),
];

describe('spatialElementsOnMap', () => {
  it('selects pins + markers of the map only', () => {
    expect(spatialElementsOnMap(world, 'M').map(e => e.id).sort()).toEqual(['m1', 'm2', 'p1', 'p2']);
  });
});

describe('scaleSpatialPatches', () => {
  it('scales proportionally, rounds to integers, and clamps into the new canvas', () => {
    const patches = scaleSpatialPatches(world, 'M', { w: 2000, h: 2000 }, { w: 300, h: 200 });
    const byId = Object.fromEntries(patches.map(p => [p.id, p]));
    expect(byId['p1']).toMatchObject({ type: 'pin', x: 150, y: 50 });
    // The far-corner pin lands exactly ON the new border, never beyond.
    expect(byId['p2']).toMatchObject({ x: 300, y: 200 });
    expect(byId['m1']).toMatchObject({ type: 'marker', x: 0, y: 150 });
    // 333 * 0.15 = 49.95 → 50 ; 667 * 0.1 = 66.7 → 67
    expect(byId['m2']).toMatchObject({ x: 50, y: 67 });
    expect(byId['p3']).toBeUndefined();
    expect(patches).toHaveLength(4);
  });

  it('identity dims → no patches (no pointless writes)', () => {
    expect(scaleSpatialPatches(world, 'M', { w: 2000, h: 2000 }, { w: 2000, h: 2000 })).toEqual([]);
  });

  it('degenerate dims → no patches (never divide by zero, never scale to nothing)', () => {
    expect(scaleSpatialPatches(world, 'M', { w: 0, h: 2000 }, { w: 300, h: 200 })).toEqual([]);
    expect(scaleSpatialPatches(world, 'M', { w: 2000, h: 2000 }, { w: 300, h: 0 })).toEqual([]);
  });

  it('non-numeric coords are skipped, not corrupted', () => {
    const messy = [el({ id: 'px', type: 'pin', map_id: 'M', x: undefined, y: 5 })];
    expect(scaleSpatialPatches(messy, 'M', { w: 2000, h: 2000 }, { w: 300, h: 200 })).toEqual([]);
  });

  it('upscaling works too (small blank canvas onto a bigger image)', () => {
    const patches = scaleSpatialPatches(world, 'M', { w: 2000, h: 2000 }, { w: 4000, h: 4000 });
    const p1 = patches.find(p => p.id === 'p1')!;
    expect(p1).toMatchObject({ x: 2000, y: 1000 });
  });
});
