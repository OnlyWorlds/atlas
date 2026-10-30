/**
 * Home's picture while the world is small (the home that grows): the grid,
 * drawn from the SDK's `worldGraph` (the one reader the Web's picture uses),
 * placed by `core/home-grid.ts`, measured at the card's own width.
 *
 *   The hand-over is read, never stored: while the grid's height at this
 *   width is at most `HAND_OVER_PX`, the grid; past it, today's centred
 *   picture (or none, when that has no centre). A world that shrinks comes
 *   back to the grid.
 *
 *   The grid reads no per-browser setting (the Web's switched-off types are
 *   not read), so two browsers draw the same grid.
 */

import { worldGraph } from '@onlyworlds/sdk';
import type { Element } from '../core/types';
import { gridOf, type Grid } from '../core/home-grid';
import { collectReferencedIds } from './element-detail-refs';
import { drawGrid, geometryFor, gridHeight, withoutPlusLine, type PlusSquare } from './home-grid-view';
import { typeName } from '../core/type-words';

/** The grid gives way past this height (Seethe's lean from the drawings, 2026-10-30: about the first screen under the card's head). */
export const HAND_OVER_PX = 640;
const TOO_MANY = 48;
const MAP_SPACE = new Set(['map', 'pin', 'marker']);

/** Elements linked to nothing in the world, either way: the loose threads band's reader (pins and every reference counted). */
export function looseIds(elements: readonly Element[]): Set<string> {
  const ids = new Set(elements.map(e => e.id));
  const referenced = collectReferencedIds(elements);
  const linksOut = new Set<string>();
  for (const el of elements) {
    for (const ref of collectReferencedIds([el])) {
      if (ids.has(ref)) { linksOut.add(el.id); break; }
    }
  }
  return new Set(elements.filter(e => !referenced.has(e.id) && !linksOut.has(e.id)).map(e => e.id));
}

export interface GridInput {
  grid: (perLine: number) => Grid;
  names: { nameOf(id: string): string; typeOf(id: string): string; isLoose(id: string): boolean };
  count: number;
  /** The picture's element ids. */
  ids: string[];
}

/** The grid's input from the lore (no room, no proposed, no hidden, no map space, no reading aids: `worldGraph`'s nodes at the owner's rung). */
export function gridInput(lore: readonly Element[], all: readonly Element[]): GridInput | null {
  // No grid of this many fits the height at any width (eight columns, five lines): the graph is not read.
  if (lore.filter(e => !MAP_SPACE.has(e.type)).length > TOO_MANY) return null;
  let graph: ReturnType<typeof worldGraph>;
  try {
    graph = worldGraph({ elements: lore as unknown as object[] } as Parameters<typeof worldGraph>[0], { rung: 'owner' });
  } catch {
    return null;
  }
  const byId = new Map(lore.map(e => [e.id, e] as const));
  const nodes = graph.nodes.map(n => ({ id: n.id, type: n.type, created_at: (byId.get(n.id) as { created_at?: unknown } | undefined)?.created_at }));
  const loose = looseIds(all);
  const memo = new Map<number, Grid>();
  return {
    grid: perLine => {
      let g = memo.get(perLine);
      if (!g) { g = gridOf(nodes, graph.edges, perLine); memo.set(perLine, g); }
      return g;
    },
    names: {
      nameOf: id => {
        const n = graph.nodes.find(x => x.id === id);
        const name = n?.name?.trim();
        return name || `this ${typeName(n?.type ?? 'element')}`;
      },
      typeOf: id => graph.nodes.find(x => x.id === id)?.type ?? '',
      isLoose: id => loose.has(id),
    },
    count: nodes.length,
    ids: nodes.map(n => n.id),
  };
}

export interface GridPicture {
  section: HTMLElement;
  /** Draw at the section's width; answers false when the grid is past the hand-over at that width. */
  mount(): boolean;
  destroy(): void;
}

export function buildGridPicture(
  input: GridInput,
  plus: PlusSquare | null,
  onHandOver: () => void,
  afterDraw?: (host: HTMLElement) => (() => void) | void,
): GridPicture {
  const section = document.createElement('section');
  section.className = 'atlas-home-grid-picture';
  section.setAttribute('data-role', 'home-grid');
  const host = document.createElement('div');
  section.appendChild(host);
  let observer: ResizeObserver | null = null;
  let lastWidth = -1;
  let handedOver = false;
  let unwire: (() => void) | void = undefined;

  const draw = (): boolean => {
    const width = host.clientWidth || section.clientWidth;
    if (width <= 0 || width === lastWidth) return !handedOver;
    lastWidth = width;
    const geo = geometryFor(width);
    // The cheap exit (gate 2's H19): the top row alone past the height, the grid is never laid out.
    const topLines = Math.ceil((input.count + (plus ? 1 : 0)) / geo.perLine);
    const laid = (): Grid => (plus ? input.grid(geo.perLine) : withoutPlusLine(input.grid(geo.perLine)));
    const tooTall = topLines * geo.rowH + (topLines - 1) * geo.lineGap > HAND_OVER_PX
      || gridHeight(laid(), geo) > HAND_OVER_PX;
    if (tooTall) {
      unwire?.();
      unwire = undefined;
      host.innerHTML = '';
      section.hidden = true;
      if (!handedOver) { handedOver = true; onHandOver(); }
      return false;
    }
    unwire?.();
    drawGrid(host, laid(), geo, input.names, plus);
    unwire = afterDraw?.(host);
    return true;
  };

  return {
    section,
    mount(): boolean {
      if (!section.isConnected) return true;
      const ok = draw();
      if (ok && !observer && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => { draw(); });
        observer.observe(section);
      }
      return ok;
    },
    destroy(): void {
      observer?.disconnect();
      observer = null;
      unwire?.();
      unwire = undefined;
    },
  };
}
