/**
 * A river on a styled map ends at the coast (S424, Seethe's receipt h20
 * #6514): `clipLineToLand` keeps the parts of a line on land and off water.
 */

import { describe, it, expect } from 'vitest';
import { clipLineToLand, landSpansAlong, pointInPolygon, type Point } from '../../src/visualization/leaflet-2d/ZoneGeometry';

const square = (x0: number, y0: number, x1: number, y1: number): Point[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

const island = square(0, 0, 100, 100);
// from inland out past the east coast into the sea
const river: Point[] = [{ x: 50, y: 50 }, { x: 80, y: 50 }, { x: 150, y: 50 }];

describe('clipLineToLand', () => {
  it('ends a river exactly on the coast it runs out over', () => {
    const parts = clipLineToLand(river, [island], []);
    expect(parts).toHaveLength(1);
    const p = parts[0];
    expect(p[0]).toEqual({ x: 50, y: 50 });
    expect(p[p.length - 1].x).toBeCloseTo(100, 9);
    expect(p.every(q => q.x <= 100 + 1e-9)).toBe(true);
  });

  it('keeps every stored point that is on land', () => {
    const parts = clipLineToLand(river, [island], []);
    expect(parts[0]).toContainEqual({ x: 80, y: 50 });
  });

  it('cuts a lake out of the river, leaving two pieces', () => {
    const lake = square(60, 40, 70, 60);
    const parts = clipLineToLand(river, [island], [lake]);
    expect(parts).toHaveLength(2);
    expect(parts[0][parts[0].length - 1].x).toBeCloseTo(60, 9);
    expect(parts[1][0].x).toBeCloseTo(70, 9);
  });

  it('with no landmass on the map, the ground is land and only water cuts', () => {
    const sea = square(120, 0, 200, 100);
    const parts = clipLineToLand(river, [], [sea]);
    expect(parts).toHaveLength(1);
    expect(parts[0][parts[0].length - 1].x).toBeCloseTo(120, 9);
  });

  it('with no regions at all, draws the line as it is', () => {
    expect(clipLineToLand(river, [], [])).toEqual([river]);
  });

  it('a line wholly at sea has no land part', () => {
    expect(clipLineToLand([{ x: 200, y: 10 }, { x: 300, y: 10 }], [island], [])).toEqual([]);
  });

  it('says where along the line its land lies, as shares of its length', () => {
    // 100 units: 50 on land, then 50 at sea past x 100
    const spans = landSpansAlong(river, [island], []);
    expect(spans).toHaveLength(1);
    expect(spans[0][0]).toBeCloseTo(0, 9);
    expect(spans[0][1]).toBeCloseTo(0.5, 9);
    const lake = square(60, 40, 70, 60);
    const two = landSpansAlong(river, [island], [lake]);
    expect(two.map(s => s.map(v => Math.round(v * 100) / 100))).toEqual([[0, 0.1], [0.2, 0.5]]);
    expect(landSpansAlong(river, [], [])).toEqual([[0, 1]]);
  });

  it('every kept piece lies on land, on a concave coast', () => {
    // a C-shaped island: the river crosses the bay twice
    const c: Point[] = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 30 }, { x: 30, y: 30 },
      { x: 30, y: 70 }, { x: 100, y: 70 }, { x: 100, y: 100 }, { x: 0, y: 100 },
    ];
    const line: Point[] = [{ x: 60, y: 10 }, { x: 60, y: 90 }];
    const parts = clipLineToLand(line, [c], []);
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      for (let i = 0; i < part.length - 1; i++) {
        const mid = { x: (part[i].x + part[i + 1].x) / 2, y: (part[i].y + part[i + 1].y) / 2 };
        expect(pointInPolygon(mid, c)).toBe(true);
      }
    }
  });
});
