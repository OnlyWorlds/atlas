/**
 * A link two or more columns apart on one line crosses no square and no name
 * between its ends: it climbs to a lane above the line's first row, and a
 * square lower in a stack leaves from its side into the gap between columns.
 * The case is the style read of 1.111.0: Mira held under The Harbour, Ilse
 * next, The Founding two columns on, and The Founding lists Mira.
 */

import { describe, it, expect } from 'vitest';
import type { Grid, GridCell } from '../../src/core/home-grid';
import { drawGrid, geometryFor, type GridNames } from '../../src/middle/home-grid-view';

const cell = (id: string, pos: number, row = 0, depth = 0, holder: string | null = null): GridCell =>
  ({ id, col: pos, line: 0, pos, row, depth, holder });

const TYPES: Record<string, string> = { harbour: 'location', mira: 'character', ilse: 'character', founding: 'event', tale: 'narrative' };
const names: GridNames = { nameOf: id => id, typeOf: id => TYPES[id], isLoose: () => false };

type Box = { id: string; x0: number; y0: number; x1: number; y1: number };

/** Every square, and the name band under it (inset 2 px: a name is centred and seldom fills its column). */
function boxes(grid: Grid, g: ReturnType<typeof geometryFor>): Box[] {
  return grid.cells.flatMap(c => {
    const cx = g.colW * (c.pos + 0.5) + (c.depth >= 2 ? g.colW * 0.25 : 0);
    const top = c.row * g.rowH;
    return [
      { id: c.id, x0: cx - g.sq / 2, y0: top, x1: cx + g.sq / 2, y1: top + g.sq },
      { id: c.id, x0: g.colW * c.pos + 2, y0: top + g.sq + 2, x1: g.colW * (c.pos + 1) - 2, y1: top + g.sq + 30 },
    ];
  });
}

/** The path's points in order (a run's corners, a curve's control points): the polygon the line keeps within. */
function points(d: string): Array<[number, number]> {
  const n = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(Number);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < n.length; i += 2) out.push([n[i], n[i + 1]]);
  return out;
}

/** Does the segment pass through the box's inside (sampled finely; touching an edge is not crossing)? */
function crosses([ax, ay]: [number, number], [bx, by]: [number, number], b: Box): boolean {
  for (let t = 0; t <= 1; t += 0.01) {
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    if (x > b.x0 + 0.5 && x < b.x1 - 0.5 && y > b.y0 + 0.5 && y < b.y1 - 0.5) return true;
  }
  return false;
}

function linkPaths(grid: Grid, width: number): { d: string[]; g: ReturnType<typeof geometryFor> } {
  const g = geometryFor(width);
  const host = document.createElement('div');
  drawGrid(host, grid, g, names, null);
  return { d: [...host.querySelectorAll('.atlas-home-grid-link')].map(p => p.getAttribute('d')!), g };
}

function crossings(grid: Grid, width: number): string[] {
  const { d, g } = linkPaths(grid, width);
  const all = boxes(grid, g);
  return grid.links.flatMap((l, i) => {
    const pts = points(d[i]);
    const others = all.filter(b => b.id !== l.source && b.id !== l.target);
    const hit = new Set<string>();
    for (let k = 1; k < pts.length; k++) for (const b of others) if (crosses(pts[k - 1], pts[k], b)) hit.add(b.id);
    return [...hit].map(id => `${l.source} to ${l.target} crosses ${id}`);
  });
}

const seethe: Grid = {
  cells: [cell('harbour', 0), cell('mira', 0, 1, 1, 'harbour'), cell('ilse', 1), cell('founding', 2), cell('tale', 3)],
  plus: { col: 4, line: 0, pos: 4 },
  links: [{ source: 'founding', target: 'mira', field: 'characters' }],
  perLine: 5,
  lineRows: [2],
};

describe('a link two or more columns apart', () => {
  for (const width of [1100, 390]) {
    it(`crosses no square or name between its ends at ${width}`, () => {
      expect(crossings(seethe, width)).toEqual([]);
    });
  }

  it('two top-row squares apart, and two such links, each keep clear and never share a run', () => {
    const grid: Grid = {
      ...seethe,
      links: [{ source: 'founding', target: 'harbour', field: 'location' }, { source: 'tale', target: 'harbour', field: 'locations' }],
    };
    expect(crossings(grid, 1100)).toEqual([]);
    const { d } = linkPaths(grid, 1100);
    const laneY = (s: string) => Math.min(...points(s).map(p => p[1]));
    expect(laneY(d[0])).not.toBe(laneY(d[1]));
  });

  it('a stacked square to the left of its partner leaves by its side, from the middle of its square', () => {
    const { d, g } = linkPaths(seethe, 1100);
    const [start, ...rest] = points(d[0]);
    const end = rest[rest.length - 1];
    // The Founding (top row) leaves from its top edge; Mira (row 1) is entered from its right side, at its middle.
    expect(start[1]).toBe(0);
    expect(end[0]).toBeCloseTo(g.colW * 0.5 + g.sq / 2);
    expect(end[1]).toBeCloseTo(g.rowH + g.sq / 2);
  });
});
