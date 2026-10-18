/**
 * Pure geometry helpers for zones.
 *
 * Ported from zoner's ZoneCanvas.ts (audit: 2026-05-16). These functions
 * operate on storage-space coordinates (bottom-left origin since S361, x
 * grows right, y grows up) — the same coord space as Marker.x / Marker.y.
 * Every helper here is reflection-invariant, so the flip changed none of them.
 *
 * No Leaflet dependency. Pure functions only. Drives the canvas overlay
 * (rendering + selection + insertion) and the zone-derived helpers.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Squared distance from point P to segment AB (with clamped projection).
 *
 * Returns the squared distance to avoid the Math.sqrt cost when the caller
 * only needs ordering (e.g. "closest segment of N"). Use `distanceToSegment`
 * for the unsquared result.
 */
export function distanceToSegmentSquared(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate segment (A == B). Distance is just |P - A|.
    const ex = p.x - a.x;
    const ey = p.y - a.y;
    return ex * ex + ey * ey;
  }
  // Project P onto AB; clamp t to [0, 1] so the foot stays on the segment.
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  const fx = a.x + t * dx;
  const fy = a.y + t * dy;
  const ex = p.x - fx;
  const ey = p.y - fy;
  return ex * ex + ey * ey;
}

/** Euclidean distance from point P to segment AB (clamped projection). */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return Math.sqrt(distanceToSegmentSquared(p, a, b));
}

/**
 * Projection foot of P onto segment AB, clamped to segment endpoints.
 *
 * Returns the point on AB closest to P. Used when inserting a new marker
 * onto a clicked segment — the inserted marker goes at the projection foot.
 */
export function projectToSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Closest segment in a polyline / polygon edge list, given a query point P.
 *
 * Returns `{ index, distance, foot }` where `index` is the segment's start
 * marker index (so the segment is `points[index] → points[index+1]`). For
 * a closed polygon, the wrap segment is included (last → first) at index =
 * points.length - 1.
 *
 * Returns null when `points.length < 2`.
 */
export function findClosestSegment(
  p: Point,
  points: Point[],
  closed: boolean,
): { index: number; distance: number; foot: Point } | null {
  if (points.length < 2) return null;
  const lastIdx = closed ? points.length : points.length - 1;
  let best: { index: number; distance: number; foot: Point } | null = null;
  for (let i = 0; i < lastIdx; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const d2 = distanceToSegmentSquared(p, a, b);
    if (best === null || d2 < best.distance) {
      best = { index: i, distance: d2, foot: projectToSegment(p, a, b) };
    }
  }
  // Convert from squared to actual distance for the returned value.
  if (best) best.distance = Math.sqrt(best.distance);
  return best;
}

/**
 * Centroid of a polygon by simple vertex averaging.
 *
 * Not a "true" area-weighted centroid (which requires the shoelace formula),
 * but adequate for label/handle placement on convex-ish or near-uniform
 * polygons. Matches zoner's `calculateCentroid` (audit ZoneCanvas.ts:745-754).
 *
 * Returns `null` for empty input.
 */
export function polygonCentroid(points: Point[]): Point | null {
  if (points.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

/**
 * Midpoint of a polyline (for label placement on lines).
 *
 * Picks the midpoint of the longest segment, which usually has visual room
 * for a label without overlapping marker handles.
 */
export function polylineLabelAnchor(points: Point[]): Point | null {
  if (points.length === 0) return null;
  if (points.length === 1) return { ...points[0] };
  let bestIdx = 0;
  let bestLen2 = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const l2 = dx * dx + dy * dy;
    if (l2 > bestLen2) {
      bestLen2 = l2;
      bestIdx = i;
    }
  }
  const a = points[bestIdx];
  const b = points[bestIdx + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Point-in-polygon test (ray casting).
 *
 * Used for canvas hit-testing on polygons. Leaflet's L.Polygon handles
 * fill-clicks natively, but this helper is useful for non-Leaflet contexts
 * (e.g. drag-into-zone checks during pin drag, future selection regions).
 */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > p.y !== yj > p.y &&
      p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Snap an angle (radians) to the nearest 45° multiple. Used by the
 * shift-snap drawing feature (DESIGN_ZONES.md §2.4).
 */
export function snapAngleTo45(theta: number): number {
  const step = Math.PI / 4; // 45°
  return Math.round(theta / step) * step;
}

/**
 * Project a click point onto the axis-aligned (snapped) ray from anchor.
 *
 * Used during shift-snap drawing: given the previous marker (anchor) and
 * the current click, snap to the nearest 45° direction and project the
 * click distance onto that direction. The returned point is what gets
 * appended to the marker list — yields perfect axis-aligned segments and,
 * with four shift-clicks at right angles, perfect rectangles.
 */
export function snapToAxis(anchor: Point, click: Point): Point {
  const dx = click.x - anchor.x;
  const dy = click.y - anchor.y;
  const theta = Math.atan2(dy, dx);
  const snapped = snapAngleTo45(theta);
  // Project click vector onto snapped direction.
  const dist = dx * Math.cos(snapped) + dy * Math.sin(snapped);
  // Negative projection (click is behind anchor along snapped axis) — clamp
  // to non-negative so the new marker is forward-of-anchor or AT anchor.
  const clamped = Math.max(0, dist);
  return {
    x: Math.round(anchor.x + clamped * Math.cos(snapped)),
    y: Math.round(anchor.y + clamped * Math.sin(snapped)),
  };
}

/**
 * Douglas-Peucker on an open run of points: keeps both ends and every point
 * that sits farther than `tolerance` from the line the kept points make. A
 * traced stroke (S423) comes in at one point every few pixels and goes into
 * the world as the few that carry its shape: every point kept is a Marker
 * file, so the stored shape stays at meaning resolution and the ink draws
 * the rest.
 */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let at = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distanceToSegment(points[i], points[s], points[e]);
      if (d > maxD) { maxD = d; at = i; }
    }
    if (at > 0 && maxD > tolerance) {
      keep[at] = 1;
      stack.push([s, at], [at, e]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/**
 * A traced stroke to the points a zone stores (S423): a moving average over
 * `2 * radius + 1` samples takes out the hand's wobble (the ink puts a coast's
 * raggedness back at draw time), then `simplifyPath`. Without the average, a
 * wobble near the tolerance survives and nearly doubles the points kept.
 */
export function simplifyStroke(points: Point[], tolerance: number, radius = 2): Point[] {
  if (points.length < 3) return points.slice();
  const n = points.length;
  const smooth = points.map((p, i) => {
    if (i === 0 || i === n - 1) return p;
    const a = Math.max(0, i - radius), b = Math.min(n - 1, i + radius);
    let sx = 0, sy = 0;
    for (let j = a; j <= b; j++) { sx += points[j].x; sy += points[j].y; }
    return { x: sx / (b - a + 1), y: sy / (b - a + 1) };
  });
  return simplifyPath(smooth, tolerance);
}

/** Signed distance from `p` to a ring's outline: positive inside, negative outside. */
function signedDistanceToRing(p: Point, ring: Point[]): number {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    best = Math.min(best, distanceToSegmentSquared(p, ring[i], ring[(i + 1) % ring.length]));
  }
  return (pointInPolygon(p, ring) ? 1 : -1) * Math.sqrt(best);
}

/**
 * Where a name sits best inside a polygon (S423): the point farthest from its
 * outline (the pole of inaccessibility, after Mapbox's polylabel: a grid of
 * cells refined best-first until no cell can beat the best by `precision`).
 * The vertex mean can fall outside a concave shape, a bay or a crescent; this
 * cannot. Pure and bounded: cells are capped, so a hostile ring still returns.
 */
export function poleOfInaccessibility(ring: Point[], precision = 1): Point {
  if (ring.length < 3) return ring.length ? { ...ring[0] } : { x: 0, y: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) {
    if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
  }
  const size = Math.min(maxX - minX, maxY - minY);
  if (!(size > 0)) return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  // A name needs the middle to a hundredth of the shape, not to a unit. It
  // halves the cost (measured S423: about 0.6 to 0.3 ms on a 300-point coast),
  // which counts because a label re-anchors on every sync of every zone.
  const eps = Math.max(precision, size / 100);
  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const cell = (x: number, y: number, h: number): Cell => {
    const d = signedDistanceToRing({ x, y }, ring);
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  // A binary max-heap on `max`: a sliver's queue grows into the tens of
  // thousands, and a linear scan per step hung the tab (gate G1).
  const queue: Cell[] = [];
  const push = (c: Cell): void => {
    queue.push(c);
    for (let i = queue.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (queue[up].max >= queue[i].max) break;
      [queue[up], queue[i]] = [queue[i], queue[up]];
      i = up;
    }
  };
  const pop = (): Cell => {
    const top = queue[0];
    const last = queue.pop()!;
    if (queue.length) {
      queue[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1;
        let at = i;
        if (l < queue.length && queue[l].max > queue[at].max) at = l;
        if (r < queue.length && queue[r].max > queue[at].max) at = r;
        if (at === i) break;
        [queue[at], queue[i]] = [queue[i], queue[at]];
        i = at;
      }
    }
    return top;
  };
  // Seed cells are the shape's short side, but never more than 32 along the
  // long one: a 2000 x 0.01 sliver seeded 200,000 of them (gate G1).
  const seed = Math.max(size, Math.max(maxX - minX, maxY - minY) / 32);
  const h0 = seed / 2;
  for (let x = minX; x < maxX; x += seed) {
    for (let y = minY; y < maxY; y += seed) push(cell(x + h0, y + h0, h0));
  }
  // Start from the vertex mean when it is inside: most shapes are nearly there.
  const mean = polygonCentroid(ring) ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let best = cell(mean.x, mean.y, 0);
  for (const c of queue) if (c.d > best.d) best = c;
  for (let guard = 0; queue.length && guard < 4000; guard++) {
    // best-first: take the cell with the highest potential
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= eps) continue;
    const h = c.h / 2;
    push(cell(c.x - h, c.y - h, h)); push(cell(c.x + h, c.y - h, h));
    push(cell(c.x - h, c.y + h, h)); push(cell(c.x + h, c.y + h, h));
  }
  return { x: best.x, y: best.y };
}

/** Where segment a-b crosses segment c-d, as a share of a-b (0..1), or undefined. */
function crossingT(a: Point, b: Point, c: Point, d: Point): number | undefined {
  const rx = b.x - a.x, ry = b.y - a.y, sx = d.x - c.x, sy = d.y - c.y;
  const den = rx * sy - ry * sx;
  if (den === 0) return undefined;
  const qx = c.x - a.x, qy = c.y - a.y;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : undefined;
}

/**
 * A ring with its edges bucketed on a grid of at most GRID x GRID cells, so a
 * short segment tests only the edges near it (gate G2: an inked coast at deep
 * zoom has thousands of edges, and every river segment tested all of them).
 */
interface Ring {
  pts: Point[]; minX: number; minY: number; maxX: number; maxY: number;
  cell: number; cols: number; rows: number; edges: Map<number, number[]>;
}

const GRID = 64;
const ringIndex = new WeakMap<Point[], Ring>();

function ringOf(pts: Point[]): Ring {
  const known = ringIndex.get(pts);
  if (known) return known;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const cell = Math.max(maxX - minX, maxY - minY) / GRID || 1;
  const cols = Math.min(GRID, Math.floor((maxX - minX) / cell)) + 1;
  const rows = Math.min(GRID, Math.floor((maxY - minY) / cell)) + 1;
  const r: Ring = { pts, minX, minY, maxX, maxY, cell, cols, rows, edges: new Map() };
  // Edge k runs from pts[k - 1] (pts[n - 1] for k = 0) to pts[k], as the crossing walk reads them.
  for (let k = 0, j = pts.length - 1; k < pts.length; j = k++) {
    const a = pts[j], b = pts[k];
    forCells(r, Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y), key => {
      const list = r.edges.get(key);
      if (list) list.push(k); else r.edges.set(key, [k]);
    });
  }
  ringIndex.set(pts, r);
  return r;
}

function forCells(r: Ring, x0: number, y0: number, x1: number, y1: number, visit: (key: number) => void): void {
  const clampC = (v: number) => Math.max(0, Math.min(r.cols - 1, Math.floor((v - r.minX) / r.cell)));
  const clampR = (v: number) => Math.max(0, Math.min(r.rows - 1, Math.floor((v - r.minY) / r.cell)));
  const c0 = clampC(x0), c1 = clampC(x1), r0 = clampR(y0), r1 = clampR(y1);
  for (let c = c0; c <= c1; c++) for (let rr = r0; rr <= r1; rr++) visit(rr * r.cols + c);
}

/** The ring's edges whose cells meet a box, each once. */
function edgesNear(r: Ring, x0: number, y0: number, x1: number, y1: number): number[] {
  const seen = new Set<number>();
  forCells(r, x0, y0, x1, y1, key => { for (const k of r.edges.get(key) ?? []) seen.add(k); });
  return [...seen];
}

function inRing(p: Point, r: Ring): boolean {
  if (!(p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY) || r.pts.length < 3) return false;
  // pointInPolygon's ray, cast right, meets only edges in the cells of p's row from p on.
  const n = r.pts.length;
  let inside = false;
  for (const k of edgesNear(r, p.x, p.y, r.maxX, p.y)) {
    const a = r.pts[k], b = r.pts[(k + n - 1) % n];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The parts of a line that lie on land (S423, Seethe's receipt h20 #6514:
 * a river ends at the coast). A point is on land when it is inside some
 * `land` ring (or there are none: the map's own ground is the land) and
 * inside no `water` ring (a sea, a lake). Each segment is cut where it
 * crosses any ring's edge and each piece is kept or dropped by its
 * midpoint, so the line ends exactly on the outline it meets. Pure: the
 * stored line is never touched, only what is drawn.
 */
export function clipLineToLand(line: Point[], land: Point[][], water: Point[][]): Point[][] {
  if (line.length < 2) return line.length ? [line] : [];
  const out: Point[][] = [];
  let cur: Point[] | null = null;
  const cut = eachLandPiece(line, land, water, (_seg, a, b, t0, t1, on) => {
    const at = (t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (!on) { cur = null; return; }
    if (!cur) { cur = [at(t0)]; out.push(cur); }
    cur.push(at(t1));
  });
  return cut ? out : [line];
}

/**
 * Where along a line its land lies (S424), as shares of the line's length
 * from its first point: the stretches `clipLineToLand` draws. A name along
 * a river keeps to them, so it never prints over the mouth's stretch at sea.
 * With no regions at all, the whole line.
 */
export function landSpansAlong(line: Point[], land: Point[][], water: Point[][]): Array<[number, number]> {
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const d = Math.hypot(line[i + 1].x - line[i].x, line[i + 1].y - line[i].y);
    lens.push(d);
    total += d;
  }
  if (!(total > 0)) return [];
  const spans: Array<[number, number]> = [];
  let open: [number, number] | null = null;
  const before = lens.map((_, i) => lens.slice(0, i).reduce((x, y) => x + y, 0));
  const cut = eachLandPiece(line, land, water, (seg, _a, _b, t0, t1, on) => {
    if (!on) { open = null; return; }
    const s0 = (before[seg] + lens[seg] * t0) / total, s1 = (before[seg] + lens[seg] * t1) / total;
    if (open) open[1] = s1;
    else { open = [s0, s1]; spans.push(open); }
  });
  return cut ? spans : [[0, 1]];
}

/**
 * The walk both share: every piece of every segment, cut where it crosses a
 * region's outline, with whether its midpoint is on land. False when there
 * are no regions to cut by (the line is all land).
 */
function eachLandPiece(
  line: Point[], land: Point[][], water: Point[][],
  visit: (seg: number, a: Point, b: Point, t0: number, t1: number, onLand: boolean) => void,
): boolean {
  const landR = land.filter(r => r.length >= 3).map(ringOf);
  const waterR = water.filter(r => r.length >= 3).map(ringOf);
  if (landR.length === 0 && waterR.length === 0) return false;
  const onLand = (p: Point): boolean =>
    (landR.length === 0 || landR.some(r => inRing(p, r))) && !waterR.some(r => inRing(p, r));
  const rings = [...landR, ...waterR];
  // Land or not can change only where an outline passes, so a segment with no
  // edge near it carries the state its neighbour ended in (gate G2).
  let carried: boolean | undefined;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1];
    const sx0 = Math.min(a.x, b.x), sx1 = Math.max(a.x, b.x), sy0 = Math.min(a.y, b.y), sy1 = Math.max(a.y, b.y);
    const ts: number[] = [0, 1];
    let near = false;
    for (const r of rings) {
      if (r.maxX < sx0 || r.minX > sx1 || r.maxY < sy0 || r.minY > sy1) continue;
      const n = r.pts.length;
      for (const k of edgesNear(r, sx0, sy0, sx1, sy1)) {
        near = true;
        const t = crossingT(a, b, r.pts[(k + n - 1) % n], r.pts[k]);
        if (t !== undefined) ts.push(t);
      }
    }
    if (!near && carried !== undefined) {
      visit(i, a, b, 0, 1, carried);
      continue;
    }
    ts.sort((x, y) => x - y);
    for (let k = 0; k < ts.length - 1; k++) {
      const t0 = ts[k], t1 = ts[k + 1];
      if (t1 - t0 < 1e-9) continue;
      const m = (t0 + t1) / 2;
      carried = onLand({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m });
      visit(i, a, b, t0, t1, carried);
    }
  }
  return true;
}

/**
 * Whether two point lists are equal coordinate-by-coordinate. Used to skip
 * needless re-render when zone geometry hasn't actually changed.
 */
export function pointListsEqual(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
}
