/**
 * A layout method's recipe on a Map (`x_layout`): `{ method, settings }`, the settings the method's own.
 * The one place Atlas knows the recipe's shape (agreed 2026-11-09: the SDK's `trailByPlace` recipe,
 * one shape for every tool): `settings.ground: { map, width, height, name? }` names the pictured Map the layout
 * stands on, and `settings.margin` is the band the layout's frame adds on every side. A ground pin plus the margin is
 * the layout point, on the same axes (the standard's bottom-left origin, no flip, no scale), so the ground's picture
 * spans `[margin, margin]` to `[margin + width, margin + height]` in the layout Map's own pixels.
 *
 * Pure. Another tool's value: every field is re-checked, and what does not hold reads as absent.
 */
import type { Element, WorldMap } from './types';

/** The key in `settings.ground` that names the ground Map's element id. */
export const GROUND_MAP_KEY = 'map';

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim().length > 0 ? v.trim() : null);
const whole = (v: unknown, min: number): number | null =>
  (typeof v === 'number' && Number.isSafeInteger(v) && v >= min ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null);

export interface LayoutRecipe {
  method: string;
  /** The ground as the recipe names it; each part null when absent or malformed. */
  ground: { mapId: string | null; name: string | null; width: number | null; height: number | null } | null;
  /** The frame's band on every side; null when absent or malformed. */
  margin: number | null;
}

export function parseLayoutRecipe(value: unknown): LayoutRecipe | null {
  const v = obj(value);
  if (!v) return null;
  const method = str(v.method);
  if (!method) return null;
  const settings = obj(v.settings);
  const g = obj(settings?.ground);
  return {
    method,
    ground: g ? { mapId: str(g[GROUND_MAP_KEY]), name: str(g.name), width: whole(g.width, 1), height: whole(g.height, 1) } : null,
    margin: whole(settings?.margin, 0),
  };
}

export interface LayoutGround {
  /** The ground Map, an element of the same world. */
  ground: WorldMap;
  /** Where its picture spans in the layout Map's pixels (bottom-left origin). */
  sw: { x: number; y: number };
  ne: { x: number; y: number };
}

/**
 * The ground under a laid-out Map: the recipe's ground Map found in the world, with where its picture goes.
 * Null unless every part holds: a recipe, a ground id that is another Map of this world, the ground's size and
 * the margin as whole numbers. Whether the ground has a picture is the caller's question.
 */
export function layoutGroundOf(map: Pick<Element, 'id'> & { x_layout?: unknown }, elements: readonly Element[]): LayoutGround | null {
  const r = parseLayoutRecipe(map.x_layout);
  const g = r?.ground;
  if (!r || !g || !g.mapId || g.width == null || g.height == null || r.margin == null) return null;
  if (g.mapId === map.id) return null;
  const ground = elements.find((e) => e.id === g.mapId && e.type === 'map') as WorldMap | undefined;
  if (!ground) return null;
  const m = r.margin;
  return { ground, sw: { x: m, y: m }, ne: { x: m + g.width, y: m + g.height } };
}
