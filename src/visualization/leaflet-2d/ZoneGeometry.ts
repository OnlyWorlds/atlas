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
  const queue: Cell[] = [];
  const h0 = size / 2;
  for (let x = minX; x < maxX; x += size) {
    for (let y = minY; y < maxY; y += size) queue.push(cell(x + h0, y + h0, h0));
  }
  // Start from the vertex mean when it is inside: most shapes are nearly there.
  const mean = polygonCentroid(ring) ?? { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  let best = cell(mean.x, mean.y, 0);
  for (const c of queue) if (c.d > best.d) best = c;
  for (let guard = 0; queue.length && guard < 20000; guard++) {
    // best-first: take the cell with the highest potential
    let at = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[at].max) at = i;
    const c = queue.splice(at, 1)[0];
    if (c.d > best.d) best = c;
    if (c.max - best.d <= eps) continue;
    const h = c.h / 2;
    queue.push(cell(c.x - h, c.y - h, h), cell(c.x + h, c.y - h, h), cell(c.x - h, c.y + h, h), cell(c.x + h, c.y + h, h));
  }
  return { x: best.x, y: best.y };
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
