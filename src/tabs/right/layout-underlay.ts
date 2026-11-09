/**
 * The ground under a laid-out map: a Map with no picture of its own whose layout recipe names a ground
 * Map of the same world draws that ground under its pins, where the recipe says it lies (`core/layout-recipe.ts`):
 * the ground's picture, and its zones (rivers, roads, regions) as faint lines and areas. One rule, read by the canvas
 * (`map-tab-backgrounds.ts`) and by the card on the Map's page, so the two never disagree. A Map with its own picture
 * keeps it: the recipe never overrides what a person set.
 */
import type { Element, Marker, WorldMap, Zone } from '../../core/types';
import { layoutGroundOf, type LayoutGround } from '../../core/layout-recipe';
import { pickMapImageSource, type MapImageSource } from './map-image-source';
import { getZoneShape } from './zone-derived';

export interface UnderlayShape {
  /** In the layout Map's pixels (the ground's, plus the margin). */
  points: Array<{ x: number; y: number }>;
  line: boolean;
}

export interface LayoutUnderlay extends LayoutGround {
  /** The ground's picture; null when it has none. */
  source: Exclude<MapImageSource, { kind: 'flat' }> | null;
  /** The ground's zones, moved onto the layout; empty when it has none. */
  shapes: UnderlayShape[];
}

export function layoutUnderlayFor(map: WorldMap, elements: readonly Element[]): LayoutUnderlay | null {
  if (pickMapImageSource(map).kind !== 'flat') return null;
  const lg = layoutGroundOf(map as WorldMap & { x_layout?: unknown }, elements);
  if (!lg) return null;
  const picked = pickMapImageSource(lg.ground);
  const source = picked.kind === 'flat' ? null : picked;
  // One pass: the ground's markers grouped by zone, each group sorted by order (this runs in the background diff
  // key on every state change while a laid-out tab is open, so never a filter per zone).
  const byZone = new Map<string, Marker[]>();
  const zones: Zone[] = [];
  for (const e of elements) {
    if (e.type === 'zone') zones.push(e as Zone);
    else if (e.type === 'marker') {
      const m = e as Marker;
      if (m.map_id !== lg.ground.id || !m.zone_id) continue;
      const g = byZone.get(m.zone_id);
      if (g) g.push(m); else byZone.set(m.zone_id, [m]);
    }
  }
  const shapes: UnderlayShape[] = [];
  for (const zone of zones) {
    const group = byZone.get(zone.id);
    if (!group) continue;
    const line = getZoneShape(zone) === 'line';
    const pts = group
      .slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
      .map((p) => ({ x: p.x + lg.sw.x, y: p.y + lg.sw.y }));
    if (pts.length < (line ? 2 : 3)) continue;
    shapes.push({ points: pts, line });
  }
  if (!source && shapes.length === 0) return null;
  return { ...lg, source, shapes };
}

/** The underlay's part of a background diff key: what it draws and where. Empty when there is none. */
export function layoutUnderlayKey(u: LayoutUnderlay | null): string {
  if (!u) return '';
  const src = !u.source ? 'none' : u.source.kind === 'url' ? `url:${u.source.url}` : `local:${u.source.mediaId}`;
  // The shapes by a cheap digest: any moved, added or removed point drifts it.
  let h = 0;
  for (const s of u.shapes) {
    h = (h * 31 + (s.line ? 1 : 2)) | 0;
    // hundredths, so a move under a pixel still drifts the key
    for (const p of s.points) h = (((h * 31 + Math.round(p.x * 100)) | 0) * 31 + Math.round(p.y * 100)) | 0;
  }
  return `|ground:${u.ground.id}:${src}:${u.sw.x},${u.sw.y},${u.ne.x},${u.ne.y}:z${u.shapes.length}:${h}`;
}
