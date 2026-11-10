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
import { layoutOf } from '@onlyworlds/sdk';
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

/**
 * The map-space profile's rule 8 (schema-dist serial 110): a Map whose `x_layout` is an object with a non-empty
 * string `method` is a layout map, and this is its method (`"hand"` is a board); anything else is null. The SDK's
 * reading (`layoutOf`, 4.142.0) answers it, so Atlas holds no second copy of the rule; no trim, as the page says.
 */
export function layoutMethodOf(value: unknown): string | null {
  return layoutOf({ type: 'map', id: '-', x_layout: value }, [], []).layout;
}

/**
 * Rule 10's writer half: what a hand placement or a hand move of a Pin on this Map writes beside its point.
 * `{ x_hand: true }` on a layout map; nothing on any other Map (every Pin there is placed by hand already).
 * A machine move (a rescale onto a new picture) is no hand move and takes none.
 */
export function handMarkFor(map: { x_layout?: unknown } | undefined): { x_hand?: true } {
  return map && layoutMethodOf(map.x_layout) !== null ? { x_hand: true } : {};
}

/** The Pin fields a person types on its page that move it: its point. (The page's Map row writes `map`, which never
 *  moves a Pin to another Map, so it places nothing.) */
export const PIN_PLACE_FIELDS = ['x', 'y', 'z'] as const;

/**
 * Rule 10 for a Pin edited on its own page: typing a new x, y or z is a hand move, so it carries the mark when the
 * Pin's Map is a layout map. A cleared value or an unchanged one places nothing.
 */
export function handMarkForPinEdit(
  pin: { type: string; map_id?: unknown },
  fieldName: string,
  was: unknown,
  next: unknown,
  mapById: (id: string) => { x_layout?: unknown } | undefined,
): { x_hand?: true } {
  if (pin.type !== 'pin' || !(PIN_PLACE_FIELDS as readonly string[]).includes(fieldName)) return {};
  if (next === null || next === undefined || next === '' || next === was) return {};
  return typeof pin.map_id === 'string' ? handMarkFor(mapById(pin.map_id)) : {};
}

export function parseLayoutRecipe(value: unknown): LayoutRecipe | null {
  const v = obj(value);
  if (!v) return null;
  const method = layoutMethodOf(v);
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
