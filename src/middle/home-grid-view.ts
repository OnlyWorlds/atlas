/**
 * The home's grid, drawn (the home that grows): each element a square in
 * its type's colour and icon, a held one under the square above it joined by
 * the hold mark, the strand's squares in their block, every other link a line
 * that keeps clear of the squares and names between (each line's rule is
 * `home-grid-route.ts`'s), and the + square at the next arrival. Where each square stands is `core/home-grid.ts`'s, derived on
 * every draw; this file only draws it.
 *
 * Names are the elements' own; nothing on the picture names a set of kinds.
 */

import type { Grid } from '../core/home-grid';
import { frameOf, holdMarks, INDENT, newCounters, restPath, strandPath } from './home-grid-route';
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

export { laneRoute, roundedPath } from './home-grid-route';

export function drawGrid(host: HTMLElement, grid: Grid, g: GridGeometry, names: GridNames, plus: PlusSquare | null): void {
  host.innerHTML = '';
  host.classList.add('atlas-home-grid');
  const f = frameOf(grid, g);
  const height = gridHeight(grid, g);
  host.style.height = `${height}px`;
  const { centreX, topY } = f;
  const at = new Map(grid.cells.map(c => [c.id, c] as const));

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'atlas-home-grid-lines');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  const path = (d: string, cls: string, ends: readonly string[]): void => {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    p.setAttribute('data-ends', ends.join(' '));
    svg.appendChild(p);
  };
  // The hold mark: each held square joined to the square directly above it in its stack.
  for (const m of holdMarks(grid, f)) {
    path(`M${m.pts[0][0]} ${m.pts[0][1]} L${m.pts[1][0]} ${m.pts[1][1]}`, 'atlas-home-grid-chain', [m.above, m.id]);
  }
  // Every other link: kept clear of every square and name between its ends. A pair with a strand square
  // draws once, by the block's rules; every other pair as before.
  const n = newCounters();
  const drawn = new Set<string>();
  for (const l of grid.links) {
    const a = at.get(l.source)!;
    const b = at.get(l.target)!;
    if (a.slot || b.slot) {
      const key = [a.id, b.id].sort().join(' ');
      if (drawn.has(key)) continue;
      drawn.add(key);
      path(strandPath(a, b, f, n), 'atlas-home-grid-link', [a.id, b.id]);
    } else path(restPath(a, b, f, n), 'atlas-home-grid-link', [a.id, b.id]);
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
    if (c.slot) cell.setAttribute('data-strand-slot', c.slot);
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
