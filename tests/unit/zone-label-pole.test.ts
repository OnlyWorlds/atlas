/**
 * An area's name on a styled map sits at the point farthest inside the shape
 * (S423): `poleOfInaccessibility`.
 */

import { describe, it, expect } from 'vitest';
import { poleOfInaccessibility, polygonCentroid, pointInPolygon } from '../../src/visualization/leaflet-2d/ZoneGeometry';

// a crescent: its vertex mean falls in the bay, outside the land
const crescent = [
  ...Array.from({ length: 24 }, (_, i) => {
    const t = Math.PI * 0.15 + (i / 23) * Math.PI * 1.7;
    return { x: 1000 + 500 * Math.cos(t), y: 1000 + 500 * Math.sin(t) };
  }),
  ...Array.from({ length: 24 }, (_, i) => {
    const t = Math.PI * 1.85 - (i / 23) * Math.PI * 1.7;
    return { x: 1150 + 380 * Math.cos(t), y: 1000 + 380 * Math.sin(t) };
  }),
];

describe('poleOfInaccessibility', () => {
  it('the instrument: a crescent whose vertex mean falls outside it', () => {
    expect(pointInPolygon(polygonCentroid(crescent)!, crescent)).toBe(false);
  });

  it('puts the name inside the crescent', () => {
    expect(pointInPolygon(poleOfInaccessibility(crescent), crescent)).toBe(true);
  });

  it('finds the middle of a square', () => {
    const p = poleOfInaccessibility([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    expect(Math.abs(p.x - 50)).toBeLessThan(2);
    expect(Math.abs(p.y - 50)).toBeLessThan(2);
  });

  // A ceiling, not a guard of the precision scaling (that halves a cost well under it).
  it('stays quick on a 300-point coast (it runs on every sync of a styled map)', () => {
    const coast = Array.from({ length: 300 }, (_, i) => {
      const t = (i / 300) * Math.PI * 2;
      const r = 700 * (1 + 0.2 * Math.sin(3 * t) + 0.1 * Math.sin(7 * t) + 0.03 * Math.sin(29 * t));
      return { x: 1000 + r * Math.cos(t), y: 1000 + r * Math.sin(t) };
    });
    const t0 = performance.now();
    const p = poleOfInaccessibility(coast);
    const ms = performance.now() - t0;
    expect(pointInPolygon(p, coast)).toBe(true);
    expect(ms).toBeLessThan(50);
  });

  // gate G1: a sliver from another tool seeded 200,000 cells and hung the tab.
  it('returns quickly for slivers, and still inside a thin strip', () => {
    const slivers = [
      [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 1000, y: 0.01 }],
      [{ x: 0, y: 0 }, { x: 200000, y: 0 }, { x: 100000, y: 1 }],
      [{ x: 0, y: 0 }, { x: 0.01, y: 0 }, { x: 0.005, y: 2000 }],
    ];
    for (const s of slivers) {
      const t0 = performance.now();
      poleOfInaccessibility(s);
      expect(performance.now() - t0).toBeLessThan(200);
    }
    const strip = [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 20 }, { x: 0, y: 20 }];
    const p = poleOfInaccessibility(strip);
    expect(pointInPolygon(p, strip)).toBe(true);
    expect(Math.abs(p.y - 10)).toBeLessThan(2);
  }, 10000);

  it('returns for a flat or tiny ring', () => {
    expect(poleOfInaccessibility([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }])).toEqual({ x: 10, y: 0 });
    expect(poleOfInaccessibility([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });
});
