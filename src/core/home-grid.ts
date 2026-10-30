/**
 * The home's grid (the home that grows): where each square stands, derived
 * from the world on every draw and never stored, so two browsers with the
 * same elements at the same width draw the same grid.
 *
 *   Arrival: a UUIDv7 id's own milliseconds, else `created_at`, else first.
 *   A new element is always last, so being born moves nothing drawn before.
 *
 *   Holds: a few link fields put one square under another (a Character in
 *   its Location, an Event in its story). A held element stands in its
 *   holder's column, its own column left empty; every other link is a line.
 *
 *   Columns wrap onto lines at the card's width; a line is as tall as its
 *   deepest stack.
 *
 * Pure: nodes and edges as the SDK's `worldGraph` answers them.
 */

/** A holding field: which end of the edge is held. Temporary until the SDK's `dragField` carries `holds`. */
export interface HoldDef {
  /** The type whose field it is (the edge's source). */
  on: string;
  field: string;
  /** Which end of the edge stands under the other. */
  held: 'source' | 'target';
}

/** The pairs that hold (the schema owner's ruling of 2026-10-30). Swapped for `dragField(...).holds` at schema-dist serial 95. */
export const HOLDS: readonly HoldDef[] = [
  { on: 'character', field: 'location', held: 'source' },
  { on: 'creature', field: 'location', held: 'source' },
  { on: 'object', field: 'location', held: 'source' },
  { on: 'creature', field: 'zone', held: 'source' },
  { on: 'location', field: 'zone', held: 'source' },
  { on: 'narrative', field: 'events', held: 'target' },
];

export interface GridNode { id: string; type: string; created_at?: unknown }
export interface GridEdge { source: string; field: string; target: string; index: number }

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
}

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** An RFC v7 id's milliseconds fall before this; past it, the version digit 7 is the v1 server's pre-RFC draft. */
const RFC_V7_BEFORE = Date.UTC(2100, 0, 1);

/**
 * When an element arrived, in epoch milliseconds: an RFC UUIDv7 id's own
 * time; the v1 server's draft ids (also version 7, `06…`) carry 36-bit
 * seconds first, read as such; else its `created_at`; else minus infinity
 * (first). Pure: no clock is read.
 */
export function arrivalOf(node: GridNode): number {
  if (V7.test(node.id)) {
    const hex = node.id.slice(0, 8) + node.id.slice(9, 13);
    const ms = parseInt(hex, 16);
    if (ms < RFC_V7_BEFORE) return ms;
    return parseInt(hex.slice(0, 9), 16) * 1000;
  }
  if (typeof node.created_at === 'string') {
    const t = Date.parse(node.created_at);
    if (Number.isFinite(t)) return t;
  }
  return -Infinity;
}

const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Holder types, narrowest first: a Location before a Zone. */
const HOLDER_RANK: Record<string, number> = { location: 0, zone: 1 };

export function gridOf(
  nodes: readonly GridNode[],
  edges: readonly GridEdge[],
  perLine: number,
  holds: readonly HoldDef[] = HOLDS,
): Grid {
  const per = Math.max(1, Math.floor(perLine));
  const order = [...nodes].sort((a, b) => arrivalOf(a) - arrivalOf(b) || byCodePoint(a.id, b.id));
  const rank = new Map(order.map((n, i) => [n.id, i] as const));
  const typeOf = new Map(nodes.map(n => [n.id, n.type] as const));

  // Each element's holding candidates, with the edge that makes each (its index orders a list holder's stack).
  const candidates = new Map<string, { holder: string; index: number }[]>();
  const holdEdge = (e: GridEdge): { held: string; holder: string } | null => {
    const def = holds.find(h => h.on === typeOf.get(e.source) && h.field === e.field);
    if (!def || !rank.has(e.target) || e.source === e.target) return null;
    return def.held === 'source' ? { held: e.source, holder: e.target } : { held: e.target, holder: e.source };
  };
  for (const e of edges) {
    const h = holdEdge(e);
    if (!h) continue;
    const list = candidates.get(h.held) ?? [];
    list.push({ holder: h.holder, index: e.index });
    candidates.set(h.held, list);
  }
  // The holder: the narrowest place, then the earliest by arrival.
  const holderOf = new Map<string, { holder: string; index: number }>();
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
  // A list holder's stack keeps the list's own order (a placing appends); any other, arrival.
  for (const [holder, list] of children) {
    list.sort((a, b) => {
      const ia = holderOf.get(a)!.index;
      const ib = holderOf.get(b)!.index;
      return typeOf.get(holder) === 'narrative' ? ia - ib || rank.get(a)! - rank.get(b)! : rank.get(a)! - rank.get(b)!;
    });
  }

  const cells: GridCell[] = [];
  const stackRows = new Map<number, number>(); // line -> deepest row used
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
    place(n.id, rank.get(n.id)!, 0, 0, null);
  }
  cells.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);

  const plusCol = order.length;
  const plusLine = Math.floor(plusCol / per);
  const lines = Math.max(plusLine + 1, ...cells.map(c => c.line + 1));
  const lineRows = Array.from({ length: lines }, (_, i) => (stackRows.get(i) ?? 0) + 1);

  const links: GridLink[] = [];
  for (const e of edges) {
    if (!rank.has(e.source) || !rank.has(e.target) || e.source === e.target) continue;
    const h = holdEdge(e);
    if (h && holderOf.get(h.held)?.holder === h.holder) continue;
    links.push({ source: e.source, target: e.target, field: e.field });
  }

  return { cells, plus: { col: plusCol, line: plusLine, pos: plusCol % per }, links, perLine: per, lineRows };
}
