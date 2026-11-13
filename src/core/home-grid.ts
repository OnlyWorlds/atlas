/**
 * The home's grid (the home that grows): where each square stands, derived
 * from the world on every draw and never stored, so two browsers with the
 * same elements at the same width draw the same grid.
 *
 *   Arrival: a UUIDv7 id's own milliseconds, else `created_at`, else first.
 *   A new element is always last, so being born moves nothing drawn before.
 *
 *   Holds: the pairs the SDK's `dragField` marks `holds` put one square
 *   under another (a Character in its Location, an Event in its story). A
 *   held element stands in its holder's column, its own column left empty;
 *   every other link is a line.
 *
 *   Which end is held, by the field's own kind: a single link puts the
 *   element that carries it under its target; a list puts the elements it
 *   lists under the one that lists them.
 *
 *   Columns wrap onto lines at the card's width; a line is as tall as its
 *   deepest stack.
 *
 *   The strand (1.121.0): Home's Picture hands in the strand as read, and
 *   its slots are pinned to fixed cells of line 0 (`STRAND_CELL`): the story
 *   at pos 0 row 0, the event under it, the event's place beside the event,
 *   the main character under the event, where they are now beside them. A
 *   slot draws only when its element is a node of this read; an empty one
 *   keeps its cell. Everything else flows from pos 2 under the rules above.
 *   A pinned square is never held: an edge with a pinned end is a line.
 *
 * Pure: nodes and edges as the SDK's `worldGraph` answers them.
 */

import { compareInstants, dragField, instantOf, type OwInstant } from '@onlyworlds/sdk';
import { linkKind } from './home-grid-pair';

/**
 * Whether a link from an element of `sourceType` through `field` to one of
 * `targetType` holds, and which end stands under the other: the table's
 * `holds` for that pair and that field, the end by the field's kind. Null
 * for a link that draws a line.
 */
export function holdOf(sourceType: string, field: string, targetType: string): { held: 'source' | 'target'; list: boolean } | null {
  const row = dragField(sourceType, targetType);
  if (!row || !row.holds || row.on !== sourceType || row.field !== field) return null;
  const kind = linkKind(sourceType, field);
  if (kind === 'single_link') return { held: 'source', list: false };
  if (kind === 'multi_link') return { held: 'target', list: true };
  return null;
}

export interface GridNode { id: string; type: string; created_at?: unknown }
export interface GridEdge { source: string; field: string; target: string; index: number }

/** A strand slot, as `core/strand.ts` names them. */
export type GridSlot = 'narrative' | 'event' | 'location' | 'character' | 'now';

/** The strand as this opening read it: each slot's element id (null: empty), and whether now is the event's place. */
export interface GridPins {
  narrative?: string | null;
  event?: string | null;
  location?: string | null;
  character?: string | null;
  now?: string | null;
  same?: boolean | null;
}

/** The strand as read (the SDK's `strandOf` shape), as the grid pins it: each slot's id, and whether now is the event's place. */
export function pinsOf(s: { [K in GridSlot]: { id: string } | null } & { same: boolean | null }): GridPins {
  return {
    narrative: s.narrative?.id ?? null, event: s.event?.id ?? null, location: s.location?.id ?? null,
    character: s.character?.id ?? null, now: s.now?.id ?? null, same: s.same === true,
  };
}

/** Each slot's fixed cell on line 0: its position and row. */
export const STRAND_CELL: Record<GridSlot, { pos: number; row: number }> = {
  narrative: { pos: 0, row: 0 },
  event: { pos: 0, row: 1 },
  location: { pos: 1, row: 1 },
  character: { pos: 0, row: 2 },
  now: { pos: 1, row: 2 },
};

/** The columns the strand's block takes on line 0; the rest starts after them. */
export const STRAND_COLS = 2;

const SLOT_ORDER: readonly GridSlot[] = ['narrative', 'event', 'location', 'character', 'now'];

export interface GridCell {
  id: string;
  /** Arrival rank: the column before wrapping. */
  col: number;
  line: number;
  /** Position within the line, 0 to perLine - 1. */
  pos: number;
  /** Row within the line: 0 the top row, 1 and on a stack. */
  row: number;
  /** 0 on top, 1 held, 2 held by a held one. */
  depth: number;
  /** The square above it in its chain, for a held one. */
  holder: string | null;
  /** The strand slot this square is pinned to, for a square in the strand's block. */
  slot?: GridSlot;
}

export interface GridLink { source: string; target: string; field: string }

export interface Grid {
  cells: GridCell[];
  /** Where the + square stands: the next arrival. */
  plus: { col: number; line: number; pos: number };
  /** Every edge that is not the hold drawing a square under its holder. */
  links: GridLink[];
  perLine: number;
  /** Rows in each line, the + square's line included. */
  lineRows: number[];
  /** Rows the strand's block takes on line 0 (0 or absent: no block). */
  blockRows?: number;
  /** Whether where they are now is the event's place (it draws once, at the place's cell). */
  same?: boolean;
}

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An RFC v7 id's milliseconds fall before this; past it, the version digit 7 is the v1 server's pre-RFC draft. */
const RFC_V7_BEFORE = Date.UTC(2100, 0, 1);

/**
 * When an element arrived, as an instant: an RFC UUIDv7 id's own time; the
 * v1 server's draft ids (also version 7, `06…`) carry 36-bit seconds first,
 * read as such; else its `created_at` as the SDK's `instantOf` reads a time
 * (the message profile's grammar, to the microsecond); else null, a time that
 * cannot be read. Pure: no clock is read.
 */
export function arrivalInstantOf(node: GridNode): OwInstant | null {
  if (V7.test(node.id)) {
    const hex = node.id.slice(0, 8) + node.id.slice(9, 13);
    const ms = parseInt(hex, 16);
    if (ms < RFC_V7_BEFORE) return { seconds: Math.floor(ms / 1000), microseconds: (ms % 1000) * 1000 };
    return { seconds: parseInt(hex.slice(0, 9), 16), microseconds: 0 };
  }
  return instantOf(node.created_at);
}

/**
 * Two arrivals, earlier first: two readable ones as `compareInstants` orders
 * them; one that cannot be read before every readable one, so a folder whose
 * elements carry no time keeps its squares where they stand when an element
 * is born (being born moves nothing drawn before).
 */
export function compareArrivals(a: OwInstant | null, b: OwInstant | null): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? -1 : 1;
  return compareInstants(a, b);
}

/**
 * `arrivalInstantOf` in epoch milliseconds (a fraction carries the
 * microseconds); minus infinity for an arrival that cannot be read (first).
 */
export function arrivalOf(node: GridNode): number {
  const at = arrivalInstantOf(node);
  return at ? at.seconds * 1000 + at.microseconds / 1000 : -Infinity;
}

/**
 * The element that arrived last, among those whose arrival can be read: an
 * element with no readable time is never the newest. Equal arrivals keep the
 * order given (the first wins). Undefined when none can be read.
 */
export function latestArrivalOf<T extends GridNode>(nodes: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestAt: OwInstant | null = null;
  for (const n of nodes) {
    const at = arrivalInstantOf(n);
    if (at === null) continue;
    if (bestAt === null || compareInstants(at, bestAt) > 0) { best = n; bestAt = at; }
  }
  return best;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Holder types, narrowest first: a Location before a Zone. */
const HOLDER_RANK: Record<string, number> = { location: 0, zone: 1 };

/**
 * The strand's pinned squares: each filled slot whose element is a node, at its fixed cell. None unless the
 * story itself is a node (a mark with no story drawn is today's grid). An element pins once, at its first
 * slot: where they are now, when it is the event's place, stays at the place's cell.
 */
export function strandPinsOf(nodes: readonly GridNode[], pins: GridPins | null | undefined): Map<string, GridSlot> {
  const out = new Map<string, GridSlot>();
  if (!pins?.narrative) return out;
  const ids = new Set(nodes.map(n => n.id));
  if (!ids.has(pins.narrative)) return out;
  for (const slot of SLOT_ORDER) {
    const id = pins[slot];
    if (!id || !ids.has(id) || out.has(id)) continue;
    out.set(id, slot);
  }
  return out;
}

export function gridOf(
  nodes: readonly GridNode[],
  edges: readonly GridEdge[],
  perLine: number,
  pins?: GridPins | null,
): Grid {
  const pinned = strandPinsOf(nodes, pins);
  const block = pinned.size > 0;
  // The block's two columns and one more for the rest: a line with the block is never narrower than three.
  const per = Math.max(block ? 3 : 1, Math.floor(perLine));
  const offset = block ? STRAND_COLS : 0;
  const arrival = new Map(nodes.map(n => [n.id, arrivalInstantOf(n)] as const));
  const order = nodes.filter(n => !pinned.has(n.id))
    .sort((a, b) => compareArrivals(arrival.get(a.id) ?? null, arrival.get(b.id) ?? null) || byCodePoint(a.id, b.id));
  const rank = new Map(order.map((n, i) => [n.id, i] as const));
  const typeOf = new Map(nodes.map(n => [n.id, n.type] as const));
  const isNode = (id: string): boolean => rank.has(id) || pinned.has(id);

  // Each element's holding candidates, with the edge that makes each (its index orders a list holder's stack).
  const candidates = new Map<string, { holder: string; index: number; list: boolean }[]>();
  const holdEdge = (e: GridEdge): { held: string; holder: string; list: boolean } | null => {
    if (!rank.has(e.source) || !rank.has(e.target) || e.source === e.target) return null;
    const h = holdOf(typeOf.get(e.source)!, e.field, typeOf.get(e.target)!);
    if (!h) return null;
    return h.held === 'source' ? { held: e.source, holder: e.target, list: h.list } : { held: e.target, holder: e.source, list: h.list };
  };
  for (const e of edges) {
    const h = holdEdge(e);
    if (!h) continue;
    const list = candidates.get(h.held) ?? [];
    list.push({ holder: h.holder, index: e.index, list: h.list });
    candidates.set(h.held, list);
  }
  // The holder: the narrowest place, then the earliest by arrival.
  const holderOf = new Map<string, { holder: string; index: number; list: boolean }>();
  for (const [held, list] of candidates) {
    const best = [...list].sort((a, b) =>
      (HOLDER_RANK[typeOf.get(a.holder)!] ?? 2) - (HOLDER_RANK[typeOf.get(b.holder)!] ?? 2)
      || rank.get(a.holder)! - rank.get(b.holder)!)[0];
    holderOf.set(held, best);
  }
  // A chain that loops (a malformed world) is cut: its members stand on top.
  const rootOf = (id: string): string | null => {
    const seen = new Set<string>([id]);
    let at = id;
    while (holderOf.has(at)) {
      at = holderOf.get(at)!.holder;
      if (seen.has(at)) return null;
      seen.add(at);
    }
    return at;
  };
  for (const id of [...holderOf.keys()]) if (rootOf(id) === null) holderOf.delete(id);

  const children = new Map<string, string[]>();
  for (const [held, { holder }] of holderOf) {
    const list = children.get(holder) ?? [];
    list.push(held);
    children.set(holder, list);
  }
  // Held through a list: the list's own order (a placing appends); through a single link, arrival.
  for (const list of children.values()) {
    list.sort((a, b) => {
      const ha = holderOf.get(a)!;
      const hb = holderOf.get(b)!;
      return ha.list && hb.list ? ha.index - hb.index || rank.get(a)! - rank.get(b)! : rank.get(a)! - rank.get(b)!;
    });
  }

  const cells: GridCell[] = [];
  const stackRows = new Map<number, number>(); // line -> deepest row used
  // The block: each pinned slot at its own cell; line 0 at least as tall as the block's lowest filled row.
  let blockRows = 0;
  for (const [id, slot] of pinned) {
    const { pos, row } = STRAND_CELL[slot];
    cells.push({ id, col: pos, line: 0, pos, row, depth: 0, holder: null, slot });
    blockRows = Math.max(blockRows, row + 1);
  }
  if (block) stackRows.set(0, blockRows - 1);
  const place = (id: string, col: number, row: number, depth: number, holder: string | null): number => {
    const line = Math.floor(col / per);
    cells.push({ id, col, line, pos: col % per, row, depth, holder });
    stackRows.set(line, Math.max(stackRows.get(line) ?? 0, row));
    let next = row + 1;
    for (const child of children.get(id) ?? []) next = place(child, col, next, depth + 1, id);
    return next;
  };
  for (const n of order) {
    if (holderOf.has(n.id)) continue;
    place(n.id, rank.get(n.id)! + offset, 0, 0, null);
  }
  // The block's squares first, in the story's order, then the rest by arrival.
  const sortKey = (c: GridCell): number => (c.slot ? SLOT_ORDER.indexOf(c.slot) - SLOT_ORDER.length : rank.get(c.id)!);
  cells.sort((a, b) => sortKey(a) - sortKey(b));

  const plusCol = order.length + offset;
  const plusLine = Math.floor(plusCol / per);
  const lines = Math.max(plusLine + 1, ...cells.map(c => c.line + 1));
  const lineRows = Array.from({ length: lines }, (_, i) => (stackRows.get(i) ?? 0) + 1);

  // Every edge between two drawn squares that is not a hold drawn as a stack: a hold with a pinned end
  // (a Character standing in the strand's place, another Event the story lists) is a line to the block.
  const links: GridLink[] = [];
  for (const e of edges) {
    if (!isNode(e.source) || !isNode(e.target) || e.source === e.target) continue;
    const h = holdEdge(e);
    if (h && holderOf.get(h.held)?.holder === h.holder) continue;
    links.push({ source: e.source, target: e.target, field: e.field });
  }

  return {
    cells, plus: { col: plusCol, line: plusLine, pos: plusCol % per }, links, perLine: per, lineRows,
    blockRows, same: block && pins?.same === true,
  };
}
