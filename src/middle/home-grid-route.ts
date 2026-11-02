/**
 * The home's grid, its lines as routes (pure: points and path strings, no DOM). Every line has a rule
 * with fixed numbers, so two browsers draw the same lines, and no line crosses a square or a name.
 *
 *   The hold mark: one straight vertical at the lower square's own centre, from under the upper
 *   square's name (`top + sq + 36`, a fixed number, never a measured name) to the lower square's top.
 *   A held square joins the square directly above it in its stack; the depth-two indent is the nesting
 *   cue. Two strand squares one above the other (story and event, event and character, the place and
 *   where they are now) take the same mark.
 *
 *   The strand's block (line 0, pos 0 and 1): neighbours in a row, edge to edge at mid-height; the story
 *   to the character down the left gutter (`GUTTER_X`, inside the card's padding); any other pair from
 *   its sides through the column gap (`x = colW`), entering the other square a few px off its middle.
 *
 *   A rest square to a block square: on line 0, the next column through the gap between them, else
 *   today's lane above the line; on a line below, up the channel between the block and the rest
 *   (`x = 2·colW`) into the right side of the story or a column-1 square, or up the left gutter into
 *   the left side of the event or the character.
 *
 *   Every other line is today's (`restPath`), unchanged.
 */

import type { Grid, GridCell } from '../core/home-grid';

export interface RouteGeometry {
  sq: number;
  colW: number;
  rowH: number;
  lineGap: number;
}

export interface Frame {
  g: RouteGeometry;
  /** Each line's top. */
  lineTop: readonly number[];
  centreX(pos: number, depth?: number): number;
  topY(line: number, row: number): number;
}

export type Pt = readonly [number, number];

/** The second level indents a quarter column, so a Zone's own Creature never reads as in the Location above it. */
export const INDENT = 0.25;
/** Under a square's name: the name ends by `sq + 34` (two lines at 0.78rem), so the mark starts at `sq + 36`. */
export const NAME_CLEAR = 36;
/** The story-to-character bow's x: left of column 0, inside the card's padding (no square or name reaches below 6). */
export const GUTTER_X = -8;
/** Other lines in the left gutter run further out, a step each, so none shares the bow's run. */
const GUTTER_STEP = 4;
/** How far off a square's middle a line through a gap enters it, so it never shares a neighbour's line. */
export const ENTRY = 8;
/** A lane link's run above its line's first row, and how much higher each next one runs. */
const LANE_GAP = 8;
const LANE_STEP = 4;
/** A line from a lower line to the block runs in the gap above its own line, under the lanes. */
const CHANNEL_GAP = 22;
const CHANNEL_STEP = 4;

/** The frame of a grid at a geometry: each line's top, and where a column's centre and a row's top are. */
export function frameOf(grid: Grid, g: RouteGeometry): Frame {
  const lineTop: number[] = [];
  let y = 0;
  for (const rows of grid.lineRows) {
    lineTop.push(y);
    y += rows * g.rowH + g.lineGap;
  }
  return {
    g,
    lineTop,
    centreX: (pos, depth = 0) => g.colW * (pos + 0.5) + (depth >= 2 ? g.colW * INDENT : 0),
    topY: (line, row) => lineTop[line] + row * g.rowH,
  };
}

const mid = (c: GridCell, f: Frame): number => f.topY(c.line, c.row) + f.g.sq / 2;
const leftOf = (c: GridCell, f: Frame): number => f.centreX(c.pos, c.depth) - f.g.sq / 2;
const rightOf = (c: GridCell, f: Frame): number => f.centreX(c.pos, c.depth) + f.g.sq / 2;

/** The hold mark (and two strand squares one above the other): from under the upper's name to the lower's top, at the lower's centre. */
export function verticalMark(upper: GridCell, lower: GridCell, f: Frame): Pt[] {
  const x = f.centreX(lower.pos, lower.depth);
  return [[x, f.topY(upper.line, upper.row) + f.g.sq + NAME_CLEAR], [x, f.topY(lower.line, lower.row)]];
}

/** Every held square's mark: each joins the square directly above it in its stack (its holder, or the sibling above). */
export function holdMarks(grid: Grid, f: Frame): Array<{ id: string; above: string; pts: Pt[] }> {
  const at = new Map<string, GridCell>();
  for (const c of grid.cells) at.set(`${c.line}:${c.col}:${c.row}`, c);
  const out: Array<{ id: string; above: string; pts: Pt[] }> = [];
  for (const c of grid.cells) {
    if (!c.holder) continue;
    const above = at.get(`${c.line}:${c.col}:${c.row - 1}`);
    if (above) out.push({ id: c.id, above: above.id, pts: verticalMark(above, c, f) });
  }
  return out;
}

/**
 * Two squares in neighbouring columns, through the gap between them: from the left one's right side at its
 * middle, along the gap at `gx`, into the right one's left side a few px off its middle (toward where the line
 * came from). In one row, a straight line edge to edge.
 */
export function gapRoute(a: GridCell, b: GridCell, f: Frame, gx: number): Pt[] {
  const [l, r] = f.centreX(a.pos, a.depth) <= f.centreX(b.pos, b.depth) ? [a, b] : [b, a];
  const yl = mid(l, f);
  const yr = mid(r, f);
  if (yl === yr) return [[rightOf(l, f), yl], [leftOf(r, f), yr]];
  const enter = yr + (yl > yr ? ENTRY : -ENTRY);
  return [[rightOf(l, f), yl], [gx, yl], [gx, enter], [leftOf(r, f), enter]];
}

/** Two block squares (both pinned), by the block's rules. */
export function blockRoute(a: GridCell, b: GridCell, f: Frame): Pt[] {
  const [u, l] = a.row <= b.row ? [a, b] : [b, a];
  if (a.pos === b.pos && l.row - u.row === 1) return verticalMark(u, l, f);
  if (a.pos === b.pos) {
    // Column 0, rows 0 and 2 (the story and the character): the bow down the left gutter.
    return [[leftOf(u, f), mid(u, f)], [GUTTER_X, mid(u, f)], [GUTTER_X, mid(l, f)], [leftOf(l, f), mid(l, f)]];
  }
  // Neighbours in a row (event and place, character and now), the same place (the character into the event's
  // place, through row 2's empty cell), and any other pair: through the gap between columns 0 and 1.
  return gapRoute(a, b, f, f.g.colW);
}

/**
 * A link two or more columns apart on one line, as corner points: a square in the line's first row leaves
 * from its top; one lower in a stack leaves from its side into the gap between columns and climbs there, so
 * the line never passes through the squares or names above it. Then across the lane to the other end.
 */
export function laneRoute(a: GridCell, b: GridCell, f: Frame, lane: number): Pt[] {
  const port = (e: GridCell, toward: GridCell): Pt[] => {
    const cx = f.centreX(e.pos, e.depth);
    if (e.row === 0) return [[cx, f.topY(e.line, 0)], [cx, lane]];
    const s = Math.sign(f.centreX(toward.pos, toward.depth) - cx) || 1;
    const [edge, gx] = sidePort(e, s, f);
    const y = mid(e, f);
    return [[edge, y], [gx, y], [gx, lane]];
  };
  return [...port(a, b), ...port(b, a).reverse()];
}

/** A square's side toward `s` (1 right, -1 left), and the gap beyond it: its column's edge, or just past a deep square that stands over it. */
function sidePort(e: GridCell, s: number, f: Frame): [number, number] {
  const cx = f.centreX(e.pos, e.depth);
  const edge = cx + s * f.g.sq / 2;
  const boundary = f.g.colW * (e.pos + (s > 0 ? 1 : 0));
  return [edge, s > 0 ? Math.max(boundary, edge + 4) : Math.min(boundary, edge - 4)];
}

/** Which of the line's lanes and gutters a line has taken, so two never share a run. */
export interface RouteCounters {
  lanes: Map<number, number>;
  gaps: Map<number, number>;
  gutter: number;
  channel: number;
}

export const newCounters = (): RouteCounters => ({ lanes: new Map(), gaps: new Map(), gutter: 0, channel: 0 });

function laneY(line: number, f: Frame, n: RouteCounters): number {
  const k = n.lanes.get(line) ?? 0;
  n.lanes.set(line, k + 1);
  return f.lineTop[line] - LANE_GAP - (k % 3) * LANE_STEP;
}

/**
 * A rest square on a line below the block to a block square: into the gap above its own line, along it, up
 * the channel between the block and the rest (the story and column 1, entered from the right) or up the left
 * gutter (the event and the character, entered from the left).
 */
export function channelRoute(rest: GridCell, target: GridCell, f: Frame, n: RouteCounters): Pt[] {
  const fromRight = target.pos === 1 || target.row === 0;
  const k = n.gaps.get(rest.line) ?? 0;
  n.gaps.set(rest.line, k + 1);
  const gapY = f.lineTop[rest.line] - CHANNEL_GAP - (k % 3) * CHANNEL_STEP;
  let x: number;
  if (fromRight) {
    x = 2 * f.g.colW + [0, -3, 3][n.channel % 3];
    n.channel++;
  } else {
    x = GUTTER_X - GUTTER_STEP * (1 + n.gutter % 3);
    n.gutter++;
  }
  const cx = f.centreX(rest.pos, rest.depth);
  let port: Pt[];
  if (rest.row === 0) port = [[cx, f.topY(rest.line, 0)], [cx, gapY]];
  else {
    const [edge, gx] = sidePort(rest, Math.sign(x - cx) || -1, f);
    port = [[edge, mid(rest, f)], [gx, mid(rest, f)], [gx, gapY]];
  }
  const yT = mid(target, f) + ENTRY;
  const end = fromRight ? rightOf(target, f) : leftOf(target, f);
  return [...port, [x, gapY], [x, yT], [end, yT]];
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

/** Two rest squares: today's lines, unchanged (the block's rules apply only where a strand square is an end). */
export function restPath(a: GridCell, b: GridCell, f: Frame, n: RouteCounters): string {
  const { g, centreX, topY } = f;
  const x1 = centreX(a.pos, a.depth);
  const y1 = topY(a.line, a.row) + g.sq / 2;
  const x2 = centreX(b.pos, b.depth);
  const y2 = topY(b.line, b.row) + g.sq / 2;
  const adjacent = a.line === b.line && Math.abs(a.pos - b.pos) <= 1 && a.row === b.row;
  if (adjacent) return `M${x1} ${y1} L${x2} ${y2}`;
  if (a.line === b.line && Math.abs(a.pos - b.pos) === 1) {
    // Next columns, different rows (a held square and its neighbour's top): side to side through the
    // gap between the two columns, never up across the stack above the lower square.
    const s = Math.sign(x2 - x1);
    const sx = x1 + s * g.sq / 2;
    const ex = x2 - s * g.sq / 2;
    const gap = (sx + ex) / 2;
    return `M${sx} ${y1} C ${gap} ${y1}, ${gap} ${y2}, ${ex} ${y2}`;
  }
  if (a.line === b.line && a.pos === b.pos) {
    // Two in one column (a stack): the line bows out to the right, never straight through the squares between.
    const bow = Math.max(x1, x2) + g.sq / 2 + g.colW * 0.2;
    return `M${x1 + g.sq / 2} ${y1} C ${bow} ${y1}, ${bow} ${y2}, ${x2 + g.sq / 2} ${y2}`;
  }
  if (a.line === b.line) {
    // Two or more columns apart on one line: up to a lane above the line's first row and across, so the line
    // crosses no square or name between; each lane link a little higher, so two never share a run.
    return roundedPath(laneRoute(a, b, f, laneY(a.line, f, n)));
  }
  const lift = Math.min(y1, y2) - g.sq / 2 - 6;
  return `M${x1} ${y1} C ${x1} ${lift}, ${x2} ${lift}, ${x2} ${y2}`;
}

/** A line with a strand square at one end or both, by the block's rules. */
export function strandPath(a: GridCell, b: GridCell, f: Frame, n: RouteCounters): string {
  if (a.slot && b.slot) {
    const pts = blockRoute(a, b, f);
    return pts.length === 2 ? `M${pts[0][0]} ${pts[0][1]} L${pts[1][0]} ${pts[1][1]}` : roundedPath(pts);
  }
  const [t, r] = a.slot ? [a, b] : [b, a];
  if (r.line === 0) {
    if (Math.abs(r.pos - t.pos) === 1) {
      const pts = gapRoute(t, r, f, f.g.colW * Math.max(r.pos, t.pos));
      return pts.length === 2 ? `M${pts[0][0]} ${pts[0][1]} L${pts[1][0]} ${pts[1][1]}` : roundedPath(pts);
    }
    return roundedPath(laneRoute(t, r, f, laneY(0, f, n)));
  }
  return roundedPath(channelRoute(r, t, f, n));
}
