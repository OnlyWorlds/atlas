/**
 * The strand pinned into the one grid (1.121.0): each slot at its fixed cell of line 0, the rest flowing
 * from pos 2, a slot not drawn when its element is not a node, holds across the block's edge handed on as
 * links; and every line's rule with its fixed numbers, sampled on the drawn path against every square's
 * and every name's box (a line may cross a line, never a square or a name).
 */

import { describe, it, expect } from 'vitest';
import { gridOf, pinsOf, type Grid, type GridEdge, type GridNode, type GridPins } from '../../src/core/home-grid';
import { drawGrid, geometryFor, type GridNames } from '../../src/middle/home-grid-view';
import { ENTRY, GUTTER_X, NAME_CLEAR, frameOf } from '../../src/middle/home-grid-route';
import { cheapHeight, handOverAt, HAND_OVER_PX } from '../../src/middle/home-grid-picture';

let seq = 0;
const v7 = (ms: number): string => {
  const hex = ms.toString(16).padStart(12, '0');
  const r = (++seq).toString(16).padStart(15, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${r.slice(0, 3)}-8${r.slice(3, 6)}-${r.slice(6, 15).padEnd(12, '0')}`;
};
const node = (id: string, type: string): GridNode => ({ id, type });
const edge = (source: string, field: string, target: string, index = 0): GridEdge => ({ source, field, target, index });

// A whole strand, made in the journey's order, then the rest after it.
const S = v7(1000), E = v7(2000), L = v7(3000), C = v7(4000), N = v7(5000);
const ODILE = v7(6000), THAW = v7(7000), MARSH = v7(8000), HEN = v7(9000);
const TYPES: Record<string, string> = {
  [S]: 'narrative', [E]: 'event', [L]: 'location', [C]: 'character', [N]: 'location',
  [ODILE]: 'character', [THAW]: 'event', [MARSH]: 'location', [HEN]: 'creature',
};
const nodes = (ids: string[]): GridNode[] => ids.map(id => node(id, TYPES[id]));
const STRAND_EDGES: GridEdge[] = [
  edge(S, 'events', E), edge(E, 'locations', L), edge(S, 'protagonist', C), edge(C, 'location', N), edge(E, 'characters', C),
];
const WHOLE: GridPins = { narrative: S, event: E, location: L, character: C, now: N, same: false };
const at = (g: Grid, id: string) => {
  const c = g.cells.find(x => x.id === id);
  return c ? { line: c.line, pos: c.pos, row: c.row } : null;
};

describe('gridOf with the strand pinned', () => {
  it('pins each slot to its fixed cell of line 0, and the rest flows from pos 2', () => {
    const g = gridOf(nodes([S, E, L, C, N, ODILE]), STRAND_EDGES, 5, WHOLE);
    expect(at(g, S)).toEqual({ line: 0, pos: 0, row: 0 });
    expect(at(g, E)).toEqual({ line: 0, pos: 0, row: 1 });
    expect(at(g, L)).toEqual({ line: 0, pos: 1, row: 1 });
    expect(at(g, C)).toEqual({ line: 0, pos: 0, row: 2 });
    expect(at(g, N)).toEqual({ line: 0, pos: 1, row: 2 });
    expect(at(g, ODILE)).toEqual({ line: 0, pos: 2, row: 0 });
    expect(g.plus).toEqual({ col: 3, line: 0, pos: 3 });
    expect(g.lineRows).toEqual([3]);
    expect(g.blockRows).toBe(3);
    expect(g.cells.find(c => c.id === S)!.slot).toBe('narrative');
  });

  it('the strand\'s own edges are lines, never holds: no square of the block is held', () => {
    const g = gridOf(nodes([S, E, L, C, N]), STRAND_EDGES, 5, WHOLE);
    expect(g.cells.every(c => c.holder === null && c.depth === 0)).toBe(true);
    expect(g.links).toHaveLength(STRAND_EDGES.length);
  });

  it('a partly filled strand keeps its cells: story and hero with no event leave row 1 empty', () => {
    const g = gridOf(nodes([S, C]), [edge(S, 'protagonist', C)], 5, { narrative: S, character: C });
    expect(at(g, S)).toEqual({ line: 0, pos: 0, row: 0 });
    expect(at(g, C)).toEqual({ line: 0, pos: 0, row: 2 });
    expect(g.lineRows).toEqual([3]);
  });

  it('a story and an event alone are two rows; the rows close up below the last filled one', () => {
    const g = gridOf(nodes([S, E]), [edge(S, 'events', E)], 5, { narrative: S, event: E });
    expect(g.blockRows).toBe(2);
    expect(g.lineRows).toEqual([2]);
  });

  it('nothing in the block moves when a slot fills or the rest grows', () => {
    const before = gridOf(nodes([S, E]), [edge(S, 'events', E)], 5, { narrative: S, event: E });
    const after = gridOf(nodes([S, E, L, C, N, ODILE, THAW, MARSH]), STRAND_EDGES, 5, WHOLE);
    for (const id of [S, E]) expect(at(after, id)).toEqual(at(before, id));
  });

  it('when now is the event\'s place it draws once, at the place\'s cell; row 2 pos 1 stays empty', () => {
    const g = gridOf(nodes([S, E, L, C]), [...STRAND_EDGES.slice(0, 3), edge(C, 'location', L)], 5,
      { narrative: S, event: E, location: L, character: C, now: L, same: true });
    expect(at(g, L)).toEqual({ line: 0, pos: 1, row: 1 });
    expect(g.cells.filter(c => c.id === L)).toHaveLength(1);
    expect(g.cells.some(c => c.line === 0 && c.pos === 1 && c.row === 2)).toBe(false);
    expect(g.same).toBe(true);
  });

  it('a slot whose element is not a node (hidden, a room element) leaves its cell empty', () => {
    // L hidden: the graph has no node for it, and no edge to it.
    const g = gridOf(nodes([S, E, C, N]), STRAND_EDGES.filter(e => e.target !== L), 5, WHOLE);
    expect(at(g, L)).toBeNull();
    expect(g.cells.some(c => c.line === 0 && c.pos === 1 && c.row === 1)).toBe(false);
    expect(at(g, C)).toEqual({ line: 0, pos: 0, row: 2 });
  });

  it('no story drawn, or no strand: today\'s grid exactly', () => {
    const plain = gridOf(nodes([S, E, ODILE]), [edge(S, 'events', E)], 5);
    expect(gridOf(nodes([S, E, ODILE]), [edge(S, 'events', E)], 5, { narrative: null, event: E })).toEqual(plain);
    // The story hidden: the rest of its slots are today's grid too.
    const noStory = gridOf(nodes([E, L]), [edge(E, 'locations', L)], 5);
    expect(gridOf(nodes([E, L]), [edge(E, 'locations', L)], 5, WHOLE)).toEqual(noStory);
    expect(plain.blockRows).toBe(0);
  });

  it('holds across the block\'s edge become links: a Character standing in the strand\'s place, another Event the story lists', () => {
    const g = gridOf(nodes([S, E, L, C, N, ODILE, THAW]),
      [...STRAND_EDGES, edge(ODILE, 'location', L), edge(S, 'events', THAW, 1)], 5, WHOLE);
    expect(at(g, ODILE)).toEqual({ line: 0, pos: 2, row: 0 });
    expect(at(g, THAW)).toEqual({ line: 0, pos: 3, row: 0 });
    expect(g.links).toContainEqual({ source: ODILE, target: L, field: 'location' });
    expect(g.links).toContainEqual({ source: S, target: THAW, field: 'events' });
  });

  it('holds inside the rest stay holds, under their holder, the held one\'s column empty', () => {
    const g = gridOf(nodes([S, E, MARSH, HEN]), [edge(S, 'events', E), edge(HEN, 'location', MARSH)], 5, { narrative: S, event: E });
    expect(at(g, MARSH)).toEqual({ line: 0, pos: 2, row: 0 });
    expect(at(g, HEN)).toEqual({ line: 0, pos: 2, row: 1 });
    expect(g.plus.pos).toBe(4);
  });

  it('wraps the rest onto line 1 at a phone\'s four columns; line 0 keeps three rows', () => {
    const g = gridOf(nodes([S, E, L, C, N, ODILE, THAW, MARSH]), STRAND_EDGES, 4, WHOLE);
    expect(at(g, MARSH)).toEqual({ line: 1, pos: 0, row: 0 });
    expect(g.lineRows[0]).toBe(3);
  });

  it('pinsOf reads the strand as the SDK answers it', () => {
    const one = (id: string) => ({ id, name: id });
    expect(pinsOf({ narrative: one(S), event: one(E), location: one(L), character: one(C), now: one(L), same: true }))
      .toEqual({ narrative: S, event: E, location: L, character: C, now: L, same: true });
  });
});

// ---- The lines, drawn and sampled ----

type Box = { id: string; kind: 'square' | 'name'; x0: number; y0: number; x1: number; y1: number };

/** Every square (the + too) and every name's widest ink (the name keeps 6 px of each column's edge, two lines tall). */
function boxes(grid: Grid, width: number): Box[] {
  const g = geometryFor(width);
  const f = frameOf(grid, g);
  const out: Box[] = [];
  for (const c of grid.cells) {
    const cx = f.centreX(c.pos, c.depth);
    const top = f.topY(c.line, c.row);
    const w = c.depth >= 2 ? g.colW / 2 : g.colW;
    out.push({ id: c.id, kind: 'square', x0: cx - g.sq / 2, y0: top, x1: cx + g.sq / 2, y1: top + g.sq });
    out.push({ id: c.id, kind: 'name', x0: cx - w / 2 + 6, y0: top + g.sq + 4, x1: cx + w / 2 - 6, y1: top + g.sq + 34 });
  }
  const px = f.centreX(grid.plus.pos);
  const pt = f.topY(grid.plus.line, 0);
  out.push({ id: 'plus', kind: 'square', x0: px - g.sq / 2, y0: pt, x1: px + g.sq / 2, y1: pt + g.sq });
  return out;
}

/** A path's points, sampled along each command (M, L, Q, C). */
function sample(d: string): Array<[number, number]> {
  const toks = d.match(/[MLQC]|-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? [];
  const pts: Array<[number, number]> = [];
  let i = 0;
  let cur: [number, number] = [0, 0];
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    const cmd = toks[i++];
    if (cmd === 'M') { cur = [num(), num()]; pts.push(cur); continue; }
    if (cmd === 'L') {
      const to: [number, number] = [num(), num()];
      for (let t = 0.02; t <= 1.0001; t += 0.02) pts.push([cur[0] + (to[0] - cur[0]) * t, cur[1] + (to[1] - cur[1]) * t]);
      cur = to;
      continue;
    }
    if (cmd === 'Q') {
      const c1: [number, number] = [num(), num()];
      const to: [number, number] = [num(), num()];
      for (let t = 0.05; t <= 1.0001; t += 0.05) {
        const u = 1 - t;
        pts.push([u * u * cur[0] + 2 * u * t * c1[0] + t * t * to[0], u * u * cur[1] + 2 * u * t * c1[1] + t * t * to[1]]);
      }
      cur = to;
      continue;
    }
    if (cmd === 'C') {
      const c1: [number, number] = [num(), num()];
      const c2: [number, number] = [num(), num()];
      const to: [number, number] = [num(), num()];
      for (let t = 0.02; t <= 1.0001; t += 0.02) {
        const u = 1 - t;
        pts.push([
          u * u * u * cur[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * to[0],
          u * u * u * cur[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * to[1],
        ]);
      }
      cur = to;
    }
  }
  return pts;
}

const NAMES: GridNames = { nameOf: id => id, typeOf: id => TYPES[id] ?? '', isLoose: () => false };

function drawn(grid: Grid, width: number): Array<{ d: string; ends: string[]; cls: string }> {
  const host = document.createElement('div');
  drawGrid(host, grid, geometryFor(width), NAMES, { type: null, word: null });
  return [...host.querySelectorAll('path')].map(p => ({ d: p.getAttribute('d')!, ends: p.getAttribute('data-ends')!.split(' '), cls: p.getAttribute('class')! }));
}

/** Each line that passes through a square other than its own ends, or through any name (its ends' own included). */
function crossings(grid: Grid, width: number): string[] {
  const all = boxes(grid, width);
  const out: string[] = [];
  for (const p of drawn(grid, width)) {
    const hit = new Set<string>();
    for (const [x, y] of sample(p.d)) {
      for (const b of all) {
        if (b.kind === 'square' && p.ends.includes(b.id)) continue;
        if (x > b.x0 + 0.5 && x < b.x1 - 0.5 && y > b.y0 + 0.5 && y < b.y1 - 0.5) hit.add(`${b.kind} ${b.id}`);
      }
    }
    for (const h of hit) out.push(`${p.ends.join('-')} crosses ${h}`);
  }
  return out;
}

const pathOf = (grid: Grid, width: number, a: string, b: string) =>
  drawn(grid, width).find(p => p.ends.includes(a) && p.ends.includes(b) && p.ends.length === 2)?.d ?? null;

// The card widths: 1440's Picture (about 690 px, seven columns), a phone (about 350, four), and a wide card (eight).
const WIDTHS = [690, 350, 1100];

describe('the block\'s lines', () => {
  const whole = (w: number) => gridOf(nodes([S, E, L, C, N]), STRAND_EDGES, geometryFor(w).perLine, WHOLE);

  for (const w of WIDTHS) {
    it(`a whole strand crosses no square and no name at ${w}`, () => {
      expect(crossings(whole(w), w)).toEqual([]);
    });
  }

  it('story to event and event to character: the hold mark, at the lower square\'s centre from top + sq + 36', () => {
    const g = geometryFor(690);
    const f = frameOf(whole(690), g);
    expect(pathOf(whole(690), 690, S, E)).toBe(`M${f.centreX(0)} ${g.sq + NAME_CLEAR} L${f.centreX(0)} ${g.rowH}`);
    expect(pathOf(whole(690), 690, E, C)).toBe(`M${f.centreX(0)} ${g.rowH + g.sq + NAME_CLEAR} L${f.centreX(0)} ${2 * g.rowH}`);
  });

  it('event to its place and character to now: straight, edge to edge at mid-height', () => {
    const g = geometryFor(690);
    const f = frameOf(whole(690), g);
    const y = g.rowH + g.sq / 2;
    expect(pathOf(whole(690), 690, E, L)).toBe(`M${f.centreX(0) + g.sq / 2} ${y} L${f.centreX(1) - g.sq / 2} ${y}`);
    const y2 = 2 * g.rowH + g.sq / 2;
    expect(pathOf(whole(690), 690, C, N)).toBe(`M${f.centreX(0) + g.sq / 2} ${y2} L${f.centreX(1) - g.sq / 2} ${y2}`);
  });

  it('the place and where they are now (one inside the other): the hold mark in column 1', () => {
    const grid = gridOf(nodes([S, E, L, C, N]), [...STRAND_EDGES, edge(N, 'parent_location', L)], 4, WHOLE);
    const g = geometryFor(350);
    const f = frameOf(grid, g);
    expect(pathOf(grid, 350, L, N)).toBe(`M${f.centreX(1)} ${g.rowH + g.sq + NAME_CLEAR} L${f.centreX(1)} ${2 * g.rowH}`);
  });

  it('the protagonist bows down the left gutter at GUTTER_X, outside every square and name', () => {
    const d = pathOf(whole(690), 690, S, C)!;
    const xs = sample(d).map(p => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(GUTTER_X, 0);
    expect(GUTTER_X).toBeLessThan(0);
  });

  it('the same place: from the character\'s right edge, up the column gap, into the place under the event\'s line', () => {
    const grid = gridOf(nodes([S, E, L, C]), [...STRAND_EDGES.slice(0, 3), edge(E, 'characters', C), edge(C, 'location', L)], 7,
      { narrative: S, event: E, location: L, character: C, now: L, same: true });
    const g = geometryFor(690);
    const f = frameOf(grid, g);
    const d = pathOf(grid, 690, C, L)!;
    const pts = sample(d);
    expect(pts[0]).toEqual([f.centreX(0) + g.sq / 2, 2 * g.rowH + g.sq / 2]);
    const end = pts[pts.length - 1];
    expect(end[0]).toBeCloseTo(f.centreX(1) - g.sq / 2);
    expect(end[1]).toBeCloseTo(g.rowH + g.sq / 2 + ENTRY);
    expect(Math.max(...pts.map(p => p[0]))).toBeLessThanOrEqual(f.centreX(1) - g.sq / 2 + 0.001);
    for (const w of WIDTHS) {
      const gw = gridOf(nodes([S, E, L, C]), [...STRAND_EDGES.slice(0, 3), edge(E, 'characters', C), edge(C, 'location', L)], geometryFor(w).perLine,
        { narrative: S, event: E, location: L, character: C, now: L, same: true });
      expect(crossings(gw, w)).toEqual([]);
    }
  });

  it('any other pair (story to place, event to now, the hero born in the event\'s place) runs through the column gap', () => {
    const edges = [...STRAND_EDGES, edge(S, 'locations', L), edge(S, 'locations', N, 1), edge(E, 'locations', N, 1), edge(C, 'birthplace', L)];
    for (const w of WIDTHS) {
      const grid = gridOf(nodes([S, E, L, C, N]), edges, geometryFor(w).perLine, WHOLE);
      expect(crossings(grid, w)).toEqual([]);
      const g = geometryFor(w);
      for (const [a, b] of [[S, L], [E, N], [C, L]] as const) {
        const xs = sample(pathOf(grid, w, a, b)!).map(p => p[0]);
        expect(xs.some(x => Math.abs(x - g.colW) < 0.001)).toBe(true);
      }
    }
  });

  it('two links between one pair draw one line', () => {
    const grid = gridOf(nodes([S, C]), [edge(S, 'protagonist', C), edge(S, 'characters', C)], 7, { narrative: S, character: C });
    expect(drawn(grid, 690).filter(p => p.ends.includes(S) && p.ends.includes(C))).toHaveLength(1);
  });
});

describe('lines between the block and the rest', () => {
  const rest = [...STRAND_EDGES, edge(ODILE, 'location', L), edge(S, 'events', THAW, 1), edge(HEN, 'location', MARSH)];
  const world = (w: number) => gridOf(nodes([S, E, L, C, N, ODILE, THAW, MARSH, HEN]), rest, geometryFor(w).perLine, WHOLE);

  for (const w of WIDTHS) {
    it(`a whole strand and four more cross no square and no name at ${w}`, () => {
      expect(crossings(world(w), w)).toEqual([]);
    });
  }

  it('a rest square on line 0, two columns or more away, takes the lane above the line', () => {
    const d = pathOf(world(690), 690, S, THAW)!;
    expect(Math.min(...sample(d).map(p => p[1]))).toBeLessThan(0);
  });

  it('a rest square in the next column runs through the gap between them', () => {
    const g = geometryFor(690);
    const d = pathOf(world(690), 690, ODILE, L)!;
    expect(sample(d).some(p => Math.abs(p[0] - 2 * g.colW) < 0.001)).toBe(true);
  });

  it('from line 1: up the channel at 2·colW into the right side of a column-1 square or the story', () => {
    const grid = gridOf(nodes([S, E, L, C, N, ODILE, THAW, MARSH]), [...STRAND_EDGES, edge(MARSH, 'parent_location', L)], 4, WHOLE);
    const g = geometryFor(350);
    const f = frameOf(grid, g);
    expect(grid.cells.find(c => c.id === MARSH)!.line).toBe(1);
    const pts = sample(pathOf(grid, 350, MARSH, L)!);
    expect(pts.some(p => Math.abs(p[0] - 2 * g.colW) < 0.001)).toBe(true);
    const end = pts[pts.length - 1];
    expect(end[0]).toBeCloseTo(f.centreX(1) + g.sq / 2);
    expect(crossings(grid, 350)).toEqual([]);
  });

  it('from line 1: up the left gutter into the left side of the event or the character', () => {
    const grid = gridOf(nodes([S, E, L, C, N, ODILE, THAW, MARSH]), [...STRAND_EDGES, edge(E, 'locations', MARSH, 1), edge(C, 'birthplace', MARSH)], 4, WHOLE);
    const g = geometryFor(350);
    const f = frameOf(grid, g);
    for (const t of [E, C]) {
      const pts = sample(pathOf(grid, 350, MARSH, t)!);
      expect(Math.min(...pts.map(p => p[0]))).toBeLessThan(GUTTER_X);
      expect(pts[pts.length - 1][0]).toBeCloseTo(f.centreX(0) - g.sq / 2);
    }
    expect(crossings(grid, 350)).toEqual([]);
  });

  it('a held square deep in a stack on line 1 leaves by its side and still crosses nothing', () => {
    const grid = gridOf(nodes([S, E, L, C, N, ODILE, THAW, MARSH, HEN]), [...STRAND_EDGES, edge(HEN, 'location', MARSH), edge(S, 'characters', HEN)], 4, WHOLE);
    expect(grid.cells.find(c => c.id === HEN)!.row).toBe(1);
    expect(crossings(grid, 350)).toEqual([]);
  });
});

describe('the hold mark (every grid)', () => {
  const Z = v7(100), A = v7(200), CH = v7(300), B = v7(400), D = v7(500);
  const T: Record<string, string> = { [Z]: 'zone', [A]: 'location', [CH]: 'character', [B]: 'location', [D]: 'character' };
  const ns = [Z, A, CH, B, D].map(id => node(id, T[id]));
  const es = [edge(A, 'zone', Z), edge(CH, 'location', A), edge(B, 'zone', Z), edge(D, 'location', B)];

  it('each held square joins the square directly above it: siblings through each other, at the held square\'s own centre', () => {
    const g = gridOf(ns, es, 5);
    const geo = geometryFor(1100);
    const f = frameOf(g, geo);
    const host = document.createElement('div');
    drawGrid(host, g, geo, { nameOf: id => id, typeOf: id => T[id], isLoose: () => false }, null);
    const marks = [...host.querySelectorAll('.atlas-home-grid-chain')].map(p => ({ d: p.getAttribute('d'), ends: p.getAttribute('data-ends') }));
    expect(marks).toHaveLength(4);
    const cell = (id: string) => g.cells.find(c => c.id === id)!;
    for (const id of [A, CH, B, D]) {
      const c = cell(id);
      const above = g.cells.find(x => x.col === c.col && x.row === c.row - 1)!;
      const x = f.centreX(c.pos, c.depth);
      expect(marks).toContainEqual({ d: `M${x} ${f.topY(0, above.row) + geo.sq + NAME_CLEAR} L${x} ${f.topY(0, c.row)}`, ends: `${above.id} ${id}` });
    }
    // The rail and its ticks are gone: no horizontal hold segment.
    for (const m of marks) {
      const [x1, , x2] = m.d!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      expect(x1).toBe(x2);
    }
  });

  for (const w of [1100, 690, 350, 300]) {
    it(`a two-deep stack with a sibling after it crosses no square or name at ${w}`, () => {
      expect(crossings(gridOf(ns, es, geometryFor(w).perLine), w)).toEqual([]);
    });
  }
});

describe('the hand-over with the block', () => {
  it('the threshold is HAND_OVER_PX plus the block\'s height', () => {
    const g = geometryFor(690);
    expect(handOverAt(0, g)).toBe(HAND_OVER_PX);
    expect(handOverAt(3, g)).toBe(HAND_OVER_PX + 3 * g.rowH);
  });

  it('the cheap exit counts the block\'s rows and its two columns, never the count alone', () => {
    const g = geometryFor(690);
    // Five pinned and one more, with the +: the block's two columns and two squares on top: one line, three rows tall.
    expect(cheapHeight({ count: 6, pinned: 5, blockRows: 3 }, true, g)).toBe(3 * g.rowH);
    // Without the block the same six and the + read as one line of one row.
    expect(cheapHeight({ count: 6, pinned: 0, blockRows: 0 }, true, g)).toBe(g.rowH);
  });

  it('the cheap exit is never more than the grid as laid out', () => {
    for (const w of WIDTHS) {
      const g = geometryFor(w);
      const grid = gridOf(nodes([S, E, L, C, N, ODILE, THAW, MARSH, HEN]), STRAND_EDGES, g.perLine, WHOLE);
      const h = grid.lineRows.reduce((s, r) => s + r * g.rowH, 0) + (grid.lineRows.length - 1) * g.lineGap;
      expect(cheapHeight({ count: 9, pinned: 5, blockRows: 3 }, true, g)).toBeLessThanOrEqual(h);
    }
  });
});
