/**
 * A river on a styled map ends at the coast (Seethe's receipt,
 * 2026-10-17): `clipLineToLand` keeps the parts of a line on land and off water.
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

// gate G2: the clip walks an edge index and carries land between outlines.
// The instrument: the walk, every segment against every edge, every
// piece by its midpoint, run on the same jagged shapes.
describe('clipLineToLand against the plain walk', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const blob = (cx: number, cy: number, r: number, n: number): Point[] =>
    Array.from({ length: n }, (_, i) => {
      const t = (i / n) * Math.PI * 2, k = r * (0.7 + 0.6 * rnd());
      return { x: cx + k * Math.cos(t), y: cy + k * Math.sin(t) };
    });
  const crossT = (a: Point, b: Point, c: Point, d: Point): number | undefined => {
    const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
    const den = rx * sy - ry * sx;
    if (den === 0) return undefined;
    const qx = c.x - a.x, qy = c.y - a.y;
    const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
  };
  const plain = (line: Point[], land: Point[][], water: Point[][]): Point[][] => {
    const on = (p: Point) => land.some(r => pointInPolygon(p, r)) && !water.some(r => pointInPolygon(p, r));
    const out: Point[][] = [];
    let cur: Point[] | null = null;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      const ts = [0, 1];
      for (const r of [...land, ...water]) for (let k = 0, j = r.length - 1; k < r.length; j = k++) {
        const t = crossT(a, b, r[j], r[k]);
        if (t !== undefined) ts.push(t);
      }
      ts.sort((x, y) => x - y);
      const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      for (let k = 0; k < ts.length - 1; k++) {
        if (ts[k + 1] - ts[k] < 1e-9) continue;
        if (!on(at((ts[k] + ts[k + 1]) / 2))) { cur = null; continue; }
        if (!cur) { cur = [at(ts[k])]; out.push(cur); }
        cur.push(at(ts[k + 1]));
      }
    }
    return out;
  };

  it('cuts every wandering river where the plain walk does', () => {
    for (let trial = 0; trial < 40; trial++) {
      const land = [blob(500, 500, 300, 400), blob(1200, 600, 150, 120)];
      const water = [blob(500, 500, 80, 60)];
      let x = 100 + 1000 * rnd(), y = 100 + 800 * rnd();
      const line: Point[] = [{ x, y }];
      for (let i = 0; i < 60; i++) { x += 60 * (rnd() - 0.5); y += 60 * (rnd() - 0.5); line.push({ x, y }); }
      expect(clipLineToLand(line, land, water)).toEqual(plain(line, land, water));
    }
  });

  it('stays quick against a coast inked to twelve thousand points', () => {
    // shaped like ink: short edges, a wobble of a few units
    const coast = Array.from({ length: 12000 }, (_, i) => {
      const t = (i / 12000) * Math.PI * 2, k = 700 * (1 + 0.1 * Math.sin(5 * t)) + 4 * rnd();
      return { x: 1000 + k * Math.cos(t), y: 1000 + k * Math.sin(t) };
    });
    const rivers = Array.from({ length: 100 }, (_, i) => {
      const t = (i / 100) * Math.PI * 2;
      return Array.from({ length: 80 }, (_, k) => ({ x: 1000 + (400 + 5 * k) * Math.cos(t), y: 1000 + (400 + 5 * k) * Math.sin(t) }));
    });
    // Per river against the plain walk, on the same machine in the same run, never a wall-clock
    // limit: a fixed 150 ms read 105 to 215 ms under load, while the index ran 70 to 150 times
    // faster per river than the walk. Three rivers of the walk keep the test short.
    const t0 = performance.now();
    for (const r of rivers) clipLineToLand(r, [coast], []);
    const indexedPerRiver = (performance.now() - t0) / rivers.length;
    const t1 = performance.now();
    for (const r of rivers.slice(0, 3)) plain(r, [coast], []);
    const walkedPerRiver = (performance.now() - t1) / 3;
    expect(indexedPerRiver).toBeLessThan(walkedPerRiver / 10);
  }, 30000);
});
