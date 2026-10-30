/**
 * The home's grid, drawn (the home that grows): each element a square in
 * its type's colour and icon, a held one under its holder joined by a chain,
 * every other link a line that keeps clear of the squares and names between, and the + square at the next
 * arrival. Where each square stands is `core/home-grid.ts`'s, derived on
 * every draw; this file only draws it.
 *
 * Names are the elements' own; nothing on the picture names a set of kinds.
 */

import type { Grid, GridCell } from '../core/home-grid';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../core/constants';
import type { ElementType } from '../core/types';
import { aTypeName } from '../core/type-words';

export interface GridGeometry {
  /** The square's side. */
  sq: number;
  /** A column's width. */
  colW: number;
  /** A row: the square, its name below, the chain's gap. */
  rowH: number;
  /** Between two lines. */
  lineGap: number;
}

/** 64 px squares on a wide card, 48 below 600 px (the drawings' sizes); columns as many as fit the card. */
export function geometryFor(cardWidth: number): GridGeometry & { perLine: number } {
  const sq = cardWidth >= 600 ? 64 : 48;
  const minCol = sq + 28;
  const perLine = Math.max(3, Math.min(8, Math.floor(cardWidth / minCol)));
  return { sq, colW: cardWidth / perLine, rowH: sq + 52, lineGap: 18, perLine };
}

/** The grid without the + square's own line, when no + is drawn (a line that holds only the + would stand empty). */
export function withoutPlusLine(grid: Grid): Grid {
  const last = grid.cells.reduce((m, c) => Math.max(m, c.line), 0);
  return { ...grid, lineRows: grid.lineRows.slice(0, last + 1) };
}

/** The grid's own height at a geometry: what the hand-over reads. */
export function gridHeight(grid: Grid, g: GridGeometry): number {
  return grid.lineRows.reduce((h, rows) => h + rows * g.rowH, 0) + Math.max(0, grid.lineRows.length - 1) * g.lineGap;
}

export interface GridNames {
  /** The element's name as shown, its type word when it has none. */
  nameOf(id: string): string;
  typeOf(id: string): string;
  /** Linked to nothing in the world: drawn dim and dashed. */
  isLoose(id: string): boolean;
}

export interface PlusSquare {
  /** The kind the + makes, or null for a plain + that asks which. */
  type: string | null;
  /** The word under it ("a character"). */
  word: string | null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The second level indents a quarter column, so a Zone's own Creature never reads as in the Location above it. */
const INDENT = 0.25;
/** A lane link's run above its line's first row, and how much higher each next one runs. */
const LANE_GAP = 8;
const LANE_STEP = 4;

type Pt = readonly [number, number];

/**
 * A link two or more columns apart on one line, as corner points: a square in the line's first row leaves
 * from its top; one lower in a stack leaves from its side into the gap between columns and climbs there, so
 * the line never passes through the squares or names above it. Then across the lane to the other end.
 */
export function laneRoute(
  a: GridCell, b: GridCell, g: GridGeometry,
  centreX: (pos: number, depth?: number) => number, topY: (line: number, row: number) => number, lane: number,
): Pt[] {
  const port = (e: GridCell, toward: GridCell): Pt[] => {
    const cx = centreX(e.pos, e.depth);
    if (e.row === 0) return [[cx, topY(e.line, 0)], [cx, lane]];
    const s = Math.sign(centreX(toward.pos, toward.depth) - cx) || 1;
    const edge = cx + s * g.sq / 2;
    const boundary = g.colW * (e.pos + (s > 0 ? 1 : 0));
    // A deep square can stand past its column's edge at the narrowest columns: the gap is then just beyond it.
    const gx = s > 0 ? Math.max(boundary, edge + 4) : Math.min(boundary, edge - 4);
    const mid = topY(e.line, e.row) + g.sq / 2;
    return [[edge, mid], [gx, mid], [gx, lane]];
  };
  return [...port(a, b), ...port(b, a).reverse()];
}

/** Straight runs through the points, each corner rounded (at most 8 px, never past half a run). */
export function roundedPath(pts: readonly Pt[], r = 8): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1];
    const [x, y] = pts[i];
    const [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(x - px, y - py);
    const outLen = Math.hypot(nx - x, ny - y);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k === 0) { d += ` L${x} ${y}`; continue; }
    const ax = x - (x - px) / inLen * k, ay = y - (y - py) / inLen * k;
    const bx = x + (nx - x) / outLen * k, by = y + (ny - y) / outLen * k;
    d += ` L${ax} ${ay} Q ${x} ${y}, ${bx} ${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return `${d} L${lx} ${ly}`;
}

export function drawGrid(host: HTMLElement, grid: Grid, g: GridGeometry, names: GridNames, plus: PlusSquare | null): void {
  host.innerHTML = '';
  host.classList.add('atlas-home-grid');
  const lineTop: number[] = [];
  let y = 0;
  for (const rows of grid.lineRows) {
    lineTop.push(y);
    y += rows * g.rowH + g.lineGap;
  }
  const height = gridHeight(grid, g);
  host.style.height = `${height}px`;
  const centreX = (pos: number, depth = 0): number => g.colW * (pos + 0.5) + (depth >= 2 ? g.colW * INDENT : 0);
  const topY = (line: number, row: number): number => lineTop[line] + row * g.rowH;
  const at = new Map(grid.cells.map(c => [c.id, c] as const));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'atlas-home-grid-lines');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  const path = (d: string, cls: string): void => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    svg.appendChild(p);
  };
  // A holder's rail (the design's drawing B): down the left of its column band, one step further in per
  // level its holder is in, from below the holder's name, with a tick to each held square's left edge.
  const step = g.colW * INDENT;
  const held = new Map<string, typeof grid.cells>();
  for (const c of grid.cells) if (c.holder) held.set(c.holder, [...(held.get(c.holder) ?? []), c]);
  for (const [holderId, list] of held) {
    const h = at.get(holderId)!;
    const railX = g.colW * h.pos + (g.colW - g.sq) / 2 - 10 + h.depth * step;
    const y1 = topY(h.line, h.row) + g.sq + 34;
    const mid = (c: GridCell): number => topY(c.line, c.row) + g.sq / 2;
    const last = Math.max(...list.map(mid));
    path(`M${railX} ${y1} L${railX} ${last}`, 'atlas-home-grid-chain');
    for (const c of list) path(`M${railX} ${mid(c)} L${centreX(c.pos, c.depth) - g.sq / 2} ${mid(c)}`, 'atlas-home-grid-chain');
  }
  // Every other link: kept clear of every square and name between its ends.
  const lanes = new Map<number, number>();
  for (const l of grid.links) {
    const a = at.get(l.source)!;
    const b = at.get(l.target)!;
    const x1 = centreX(a.pos, a.depth);
    const y1 = topY(a.line, a.row) + g.sq / 2;
    const x2 = centreX(b.pos, b.depth);
    const y2 = topY(b.line, b.row) + g.sq / 2;
    const adjacent = a.line === b.line && Math.abs(a.pos - b.pos) <= 1 && a.row === b.row;
    if (adjacent) path(`M${x1} ${y1} L${x2} ${y2}`, 'atlas-home-grid-link');
    else if (a.line === b.line && Math.abs(a.pos - b.pos) === 1) {
      // Next columns, different rows (a held square and its neighbour's top): side to side through the
      // gap between the two columns, never up across the stack above the lower square.
      const s = Math.sign(x2 - x1);
      const sx = x1 + s * g.sq / 2;
      const ex = x2 - s * g.sq / 2;
      const gap = (sx + ex) / 2;
      path(`M${sx} ${y1} C ${gap} ${y1}, ${gap} ${y2}, ${ex} ${y2}`, 'atlas-home-grid-link');
    } else if (a.line === b.line && a.pos === b.pos) {
      // Two in one column (a stack): the line bows out to the right, never straight through the squares between.
      const bow = Math.max(x1, x2) + g.sq / 2 + g.colW * 0.2;
      path(`M${x1 + g.sq / 2} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${x2 + g.sq / 2} ${y2}`, 'atlas-home-grid-link');
    } else if (a.line === b.line) {
      // Two or more columns apart on one line: up to a lane above the line's first row and across, so the line
      // crosses no square or name between; each lane link a little higher, so two never share a run.
      const lane = lineTop[a.line] - LANE_GAP - (lanes.get(a.line) ?? 0) % 3 * LANE_STEP;
      lanes.set(a.line, (lanes.get(a.line) ?? 0) + 1);
      path(roundedPath(laneRoute(a, b, g, centreX, topY, lane)), 'atlas-home-grid-link');
    } else {
      const lift = Math.min(y1, y2) - g.sq / 2 - 6;
      path(`M${x1} ${y1} C ${x1} ${lift}, ${x2} ${lift}, ${x2} ${y2}`, 'atlas-home-grid-link');
    }
  }
  host.appendChild(svg);

  for (const c of grid.cells) {
    const type = names.typeOf(c.id);
    const cell = document.createElement('div');
    cell.className = 'atlas-home-grid-cell' + (names.isLoose(c.id) ? ' is-loose' : '');
    cell.setAttribute('data-grid-id', c.id);
    cell.setAttribute('data-depth', String(c.depth));
    cell.setAttribute('data-line', String(c.line));
    cell.setAttribute('data-pos', String(c.pos));
    cell.setAttribute('data-row', String(c.row));
    // A depth-two name's box narrows by the step on each side, so it stops short of the next column.
    const width = c.depth >= 2 ? g.colW - 2 * g.colW * INDENT : g.colW;
    cell.style.left = `${centreX(c.pos, c.depth) - width / 2}px`;
    cell.style.top = `${topY(c.line, c.row)}px`;
    cell.style.width = `${width}px`;
    cell.style.setProperty('--sq', `${g.sq}px`);
    cell.style.setProperty('--type-color', ELEMENT_TYPE_COLORS[type as ElementType] ?? 'var(--atlas-text-muted)');
    const square = document.createElement('span');
    square.className = 'atlas-home-grid-square';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = ELEMENT_ICONS[type as ElementType] ?? 'circle';
    square.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'atlas-home-grid-name';
    name.textContent = names.nameOf(c.id);
    // The name clamps at two lines; the whole of it rides on hover (the accessible name reads the text whole).
    cell.title = names.nameOf(c.id);
    cell.append(square, name);
    host.appendChild(cell);
  }

  if (plus) {
    const cell = document.createElement('div');
    cell.className = 'atlas-home-grid-cell atlas-home-grid-plus';
    cell.setAttribute('data-grid-plus', plus.type ?? 'any');
    cell.style.left = `${centreX(grid.plus.pos) - g.colW / 2}px`;
    cell.style.top = `${topY(grid.plus.line, 0)}px`;
    cell.style.width = `${g.colW}px`;
    cell.style.setProperty('--sq', `${g.sq}px`);
    if (plus.type) cell.style.setProperty('--type-color', ELEMENT_TYPE_COLORS[plus.type as ElementType] ?? 'var(--atlas-accent)');
    const square = document.createElement('span');
    square.className = 'atlas-home-grid-square';
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = plus.type ? (ELEMENT_ICONS[plus.type as ElementType] ?? 'add') : 'add';
    square.appendChild(icon);
    if (plus.type) {
      const badge = document.createElement('span');
      badge.className = 'atlas-home-grid-plus-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.textContent = '+';
      square.appendChild(badge);
    }
    cell.appendChild(square);
    if (plus.word) {
      const word = document.createElement('span');
      word.className = 'atlas-home-grid-name atlas-home-grid-plus-word';
      word.textContent = plus.word;
      cell.appendChild(word);
    }
    host.appendChild(cell);
  }
}

/** The + square's word for a kind: the world's own word with its article ("a character", "an event"). */
export function plusWord(type: string): string {
  return aTypeName(type).toLowerCase();
}
