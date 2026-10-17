/**
 * A map drawn from its own zones (S423, h20 #6442; the design:
 * Forge/Notes/2026-10-17-s423-map-from-zones-design.md).
 *
 * The stored shape is the meaning; the look is the renderer's reading of it.
 * A map may name a style (`atlas_map_style`); each zone whose subtype names a
 * known kind (Skeld's convention, h20 #6449: the kind rides the subtype, the
 * supertype carries the shape) then draws with that kind's treatment: a
 * ragged coast, a hatch for a range, a name along a river. Nothing here is
 * ever written back: every point this module makes exists only on screen.
 * A zone with any other subtype draws exactly as it does on a plain map.
 *
 * Pure: no DOM, no Leaflet. ZoneOverlay applies the treatments.
 */

import type { Point } from '../visualization/leaflet-2d/ZoneGeometry';

export type InkKind =
  | 'landmass' | 'sea' | 'lake' | 'range' | 'forest' | 'marsh' | 'desert' | 'territory'
  | 'river' | 'road' | 'wall' | 'border' | 'coast';

/** The subtype words, matched trimmed and case-insensitively. */
const KIND_WORDS: Record<string, InkKind> = {
  landmass: 'landmass', sea: 'sea', lake: 'lake', range: 'range', forest: 'forest',
  marsh: 'marsh', desert: 'desert', territory: 'territory',
  river: 'river', road: 'road', route: 'road', path: 'road',
  wall: 'wall', border: 'border', coast: 'coast',
};

/** The words a zone's kind can take, in the order a picker offers them. */
export const ZONE_KIND_WORDS = [
  'Landmass', 'Sea', 'Lake', 'Range', 'Forest', 'Marsh', 'Desert', 'Territory',
  'River', 'Road', 'Wall', 'Border', 'Coast',
] as const;

export function zoneKindOf(subtype: unknown): InkKind | undefined {
  if (typeof subtype !== 'string') return undefined;
  return KIND_WORDS[subtype.trim().toLowerCase()];
}

/**
 * Pattern shapes; `fdots`, `dashes` and `thinhatch` are Seethe's modern-atlas
 * grids (S424), `rhatch`, `trees`, `hmarsh`, `grain` and `crosshatch` her
 * hatched ones (S425).
 */
export type InkPattern = 'hatch' | 'stipple' | 'marsh' | 'dots' | 'fdots' | 'dashes' | 'thinhatch'
  | 'rhatch' | 'trees' | 'hmarsh' | 'grain' | 'crosshatch';

/** How one kind draws in one style. */
export interface InkTreatment {
  kind: InkKind;
  stroke: string;
  /** 0 draws no stroke. */
  weight: number;
  strokeOpacity: number;
  dash?: string;
  /** A colour, or a pattern by name. Absent: no fill. */
  fill?: string;
  pattern?: InkPattern;
  /** The pattern's colour. Absent: the stroke's. */
  patternColor?: string;
  /** A tint under the pattern (a range's dots over its warm ground). Absent: the pattern alone. */
  patternBg?: string;
  /** Midpoint displacement as a share of a segment's length; 0 = drawn straight. */
  rough: number;
  /** Shore bands under a landmass, widest first, in screen px. */
  shore?: Array<{ color: string; width: number }>;
  /** Paint order: lower draws first (under). */
  layer: number;
  /** A line's name follows the line. */
  labelAlong?: boolean;
  /** What a line clipped to land is clipped by: land holds it, water cuts it. */
  region?: 'land' | 'water';
  /** A line drawn only where it is on land (a river ends at the coast). */
  clipToLand?: boolean;
}

export interface MapStylePreset {
  id: MapStyleId;
  name: string;
  /** The sea: the flat canvas when the map has no Background colour of its own. */
  sea: string;
  /** The canvas edge. */
  edge: string;
  ink: string;
  kinds: Record<InkKind, InkTreatment>;
}

export const MAP_STYLE_IDS = ['ink', 'atlas', 'hatched'] as const;
export type MapStyleId = typeof MAP_STYLE_IDS[number];

const INK = '#3b2a1a';
const t = (kind: InkKind, rest: Omit<InkTreatment, 'kind'>): InkTreatment => ({ kind, ...rest });

const INK_ON_PARCHMENT: MapStylePreset = {
  id: 'ink',
  name: 'Ink on parchment',
  sea: '#e9dcc0',
  edge: '#8a7458',
  ink: INK,
  kinds: {
    sea:       t('sea',       { stroke: INK, weight: 1.2, strokeOpacity: 0.8, fill: '#dfd0b0', rough: 0.22, layer: 1, region: 'water' }),
    landmass:  t('landmass',  { stroke: INK, weight: 1.6, strokeOpacity: 1, fill: '#f3ead2', rough: 0.22, layer: 2, region: 'land',
      shore: [{ color: '#c9b48d', width: 26 }, { color: '#d6c4a0', width: 18 }, { color: '#dfd0b0', width: 10 }] }),
    lake:      t('lake',      { stroke: INK, weight: 1.2, strokeOpacity: 1, fill: '#dccba6', rough: 0.18, layer: 3, region: 'water' }),
    desert:    t('desert',    { stroke: INK, weight: 0, strokeOpacity: 0, pattern: 'dots', rough: 0.2, layer: 4 }),
    marsh:     t('marsh',     { stroke: INK, weight: 0, strokeOpacity: 0, pattern: 'marsh', rough: 0.2, layer: 4 }),
    forest:    t('forest',    { stroke: INK, weight: 0, strokeOpacity: 0, pattern: 'stipple', patternColor: '#4a5a2e', rough: 0.2, layer: 4 }),
    range:     t('range',     { stroke: INK, weight: 0.6, strokeOpacity: 0.5, pattern: 'hatch', rough: 0.22, layer: 4 }),
    territory: t('territory', { stroke: INK, weight: 1.2, strokeOpacity: 0.7, dash: '6, 4', rough: 0.08, layer: 5 }),
    coast:     t('coast',     { stroke: INK, weight: 1.6, strokeOpacity: 1, rough: 0.22, layer: 6 }),
    river:     t('river',     { stroke: INK, weight: 1.3, strokeOpacity: 1, rough: 0.22, layer: 6, labelAlong: true, clipToLand: true }),
    road:      t('road',      { stroke: INK, weight: 1, strokeOpacity: 0.8, dash: '5, 3', rough: 0, layer: 6, labelAlong: true }),
    wall:      t('wall',      { stroke: INK, weight: 2.2, strokeOpacity: 1, rough: 0.04, layer: 6 }),
    border:    t('border',    { stroke: INK, weight: 1.2, strokeOpacity: 0.8, dash: '2, 4, 8, 4', rough: 0.08, layer: 6 }),
  },
};

/**
 * Modern atlas (S424): soft tints, clean lines, nothing jittered. Seethe's
 * table, row for row (h20 #6542, `Studio/desk/current/
 * 2026-10-17-atlas-three-styles/map-atlas.ts`); its lettering is in
 * atlas.css under `.atlas-map-style-atlas`. Not taken yet: her pin dot (a
 * pin keeps its type's icon) and the wall's one-sided ticks.
 */
const MODERN_ATLAS: MapStylePreset = {
  id: 'atlas',
  name: 'Modern atlas',
  sea: '#e3edf0',
  edge: '#4a5a6a',
  ink: '#1a2838',
  kinds: {
    sea:       t('sea',       { stroke: '#5a7a90', weight: 0.6, strokeOpacity: 1, fill: '#e3edf0', rough: 0, layer: 1, region: 'water' }),
    landmass:  t('landmass',  { stroke: '#4a5a6a', weight: 1, strokeOpacity: 1, fill: '#f5efe0', rough: 0, layer: 2, region: 'land' }),
    lake:      t('lake',      { stroke: '#5a7a90', weight: 0.5, strokeOpacity: 1, fill: '#c9dde4', rough: 0, layer: 3, region: 'water' }),
    desert:    t('desert',    { stroke: '#d9c8a5', weight: 0.4, strokeOpacity: 1, fill: '#f5e9ce', rough: 0, layer: 4 }),
    marsh:     t('marsh',     { stroke: '#8a8a65', weight: 0.4, strokeOpacity: 1, pattern: 'dashes', patternBg: '#eae8d2', rough: 0, layer: 4 }),
    forest:    t('forest',    { stroke: '#7a9070', weight: 0.5, strokeOpacity: 1, pattern: 'fdots', patternColor: '#5a7050', patternBg: '#e8ebd8', rough: 0, layer: 4 }),
    range:     t('range',     { stroke: '#9a8a6d', weight: 0.5, strokeOpacity: 1, pattern: 'dots', patternBg: '#f0e6cf', rough: 0, layer: 4 }),
    territory: t('territory', { stroke: '#253040', weight: 1, strokeOpacity: 1, dash: '6, 4', pattern: 'thinhatch', rough: 0, layer: 5 }),
    coast:     t('coast',     { stroke: '#4a5a6a', weight: 1, strokeOpacity: 1, rough: 0, layer: 6 }),
    river:     t('river',     { stroke: '#5a8bb0', weight: 1.4, strokeOpacity: 1, rough: 0, layer: 6, labelAlong: true, clipToLand: true }),
    road:      t('road',      { stroke: '#5a5048', weight: 1.2, strokeOpacity: 1, rough: 0, layer: 6, labelAlong: true }),
    wall:      t('wall',      { stroke: '#3e3832', weight: 1.8, strokeOpacity: 1, rough: 0, layer: 6 }),
    border:    t('border',    { stroke: '#8a7f74', weight: 1.5, strokeOpacity: 1, dash: '3, 2', rough: 0, layer: 6 }),
  },
};

/**
 * Hatched (S425): an engraver's atlas, one sepia ink on aged paper, the kinds
 * told apart by texture, never by hue. Seethe's table (h20 #6572, `Studio/desk/
 * current/2026-10-17-atlas-three-styles/map-hatched.ts`); its lettering is in
 * atlas.css under `.atlas-map-style-hatched`. Her double coast is drawn as two
 * shore bands, so the second line runs on the sea side 5 px out (the period's
 * water-lining) rather than inside the land. The areas take a light hand's
 * wobble, my reading where her table is silent. Not taken: her pin ring (a pin
 * keeps its type's icon), the wall's ticks, the sea's rhumb lines (off in her
 * own table).
 */
const SEPIA = '#28220f';
const HATCH_LAND = '#f0e9cf';
const HATCHED: MapStylePreset = {
  id: 'hatched',
  name: 'Hatched',
  sea: '#e8e2cc',
  edge: SEPIA,
  ink: SEPIA,
  kinds: {
    sea:       t('sea',       { stroke: SEPIA, weight: 1, strokeOpacity: 1, fill: '#e8e2cc', rough: 0.12, layer: 1, region: 'water' }),
    landmass:  t('landmass',  { stroke: SEPIA, weight: 2.2, strokeOpacity: 1, fill: HATCH_LAND, rough: 0.12, layer: 2, region: 'land',
      shore: [{ color: SEPIA, width: 10.7 }, { color: '#e8e2cc', width: 9.3 }] }),
    lake:      t('lake',      { stroke: SEPIA, weight: 0.9, strokeOpacity: 1, fill: '#dcd6b8', rough: 0.12, layer: 3, region: 'water' }),
    desert:    t('desert',    { stroke: SEPIA, weight: 0.4, strokeOpacity: 1, pattern: 'grain', patternBg: HATCH_LAND, rough: 0.12, layer: 4 }),
    marsh:     t('marsh',     { stroke: SEPIA, weight: 0.4, strokeOpacity: 1, pattern: 'hmarsh', patternBg: HATCH_LAND, rough: 0.12, layer: 4 }),
    forest:    t('forest',    { stroke: SEPIA, weight: 0.5, strokeOpacity: 1, pattern: 'trees', patternBg: HATCH_LAND, rough: 0.12, layer: 4 }),
    range:     t('range',     { stroke: SEPIA, weight: 0.6, strokeOpacity: 1, pattern: 'rhatch', patternBg: HATCH_LAND, rough: 0.12, layer: 4 }),
    territory: t('territory', { stroke: '#3a2c1a', weight: 0.9, strokeOpacity: 1, dash: '5, 3', pattern: 'crosshatch', rough: 0, layer: 5 }),
    coast:     t('coast',     { stroke: SEPIA, weight: 2.2, strokeOpacity: 1, rough: 0.12, layer: 6 }),
    river:     t('river',     { stroke: '#3a2c1a', weight: 1.3, strokeOpacity: 1, rough: 0.12, layer: 6, labelAlong: true, clipToLand: true }),
    road:      t('road',      { stroke: '#5a4a30', weight: 0.9, strokeOpacity: 1, dash: '4, 3', rough: 0, layer: 6, labelAlong: true }),
    wall:      t('wall',      { stroke: SEPIA, weight: 1.6, strokeOpacity: 1, rough: 0.04, layer: 6 }),
    border:    t('border',    { stroke: '#5a4a30', weight: 1.2, strokeOpacity: 1, dash: '3, 2', rough: 0, layer: 6 }),
  },
};

const PRESETS: Record<MapStyleId, MapStylePreset> = { ink: INK_ON_PARCHMENT, atlas: MODERN_ATLAS, hatched: HATCHED };

/** A pattern's id in the renderer's defs: one per shape, colour and ground, so two styles never share a wrong one. */
export function inkPatternId(pattern: InkPattern, color: string, bg?: string): string {
  const hex = (c: string) => c.replace(/[^0-9a-z]/gi, '');
  return `atlas-ink-${pattern}-${hex(color)}${bg ? `-on-${hex(bg)}` : ''}`;
}

export function mapStylePreset(id: unknown): MapStylePreset | undefined {
  return typeof id === 'string' && (MAP_STYLE_IDS as readonly string[]).includes(id)
    ? PRESETS[id as MapStyleId]
    : undefined;
}

/** The style a map names (`atlas_map_style`), or undefined: plain. */
export function mapStyleOf(map: unknown): MapStylePreset | undefined {
  if (!map || typeof map !== 'object') return undefined;
  return mapStylePreset((map as { atlas_map_style?: unknown }).atlas_map_style);
}

/** Paint order for a zone without a kind on a styled map: over the areas, under the lines. */
export const PLAIN_ZONE_LAYER = 5;

// ---------- the ink ----------

/**
 * Order-independent hash of a segment's two endpoints, 0..1. Keyed to the
 * WORLD coordinates, never to a vertex's index, so the ink of one segment
 * holds still when a vertex is added or moved anywhere else.
 */
export function segmentHash(a: Point, b: Point): number {
  let p = [Math.round(a.x * 100), Math.round(a.y * 100)];
  let q = [Math.round(b.x * 100), Math.round(b.y * 100)];
  if (p[0] > q[0] || (p[0] === q[0] && p[1] > q[1])) [p, q] = [q, p];
  let h = 2166136261 >>> 0;
  for (const v of [p[0], p[1], q[0], q[1]]) {
    h ^= v & 0xffff; h = Math.imul(h, 16777619);
    h ^= v >>> 16; h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const MAX_DEPTH = 10;

function subdivide(a: Point, b: Point, minSeg: number, rough: number, out: Point[], depth: number): void {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < minSeg || depth >= MAX_DEPTH) return;
  const off = (segmentHash(a, b) - 0.5) * len * rough;
  const m = { x: (a.x + b.x) / 2 - (dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off };
  subdivide(a, m, minSeg, rough, out, depth + 1);
  out.push(m);
  subdivide(m, b, minSeg, rough, out, depth + 1);
}

/**
 * The drawn line through `points`: each segment broken by seeded midpoint
 * displacement until its pieces are shorter than `minSeg` (storage units).
 * Every stored point is kept, and a smaller `minSeg` (zooming in) only adds
 * points between the ones a larger one made, so the coast refines and never
 * re-wobbles. `rough` 0 returns the points as they are.
 */
export function inkPoints(points: Point[], minSeg: number, rough: number, closed: boolean): Point[] {
  if (rough <= 0 || points.length < 2 || !(minSeg > 0)) return points;
  const out: Point[] = [];
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i], b = points[(i + 1) % n];
    out.push(a);
    subdivide(a, b, minSeg, rough, out, 0);
  }
  if (!closed) out.push(points[n - 1]);
  return out;
}

/** The ink's finest piece at a zoom: about ten screen pixels (CRS.Simple: one unit is 2^zoom px). */
export function inkMinSegment(zoom: number): number {
  return 10 / Math.pow(2, zoom);
}
