/**
 * Helpers for resolving the maps associated with an element.
 *
 * History note (DESIGN_MAPS.md §3.6): atlas previously auto-opened a map
 * when the user clicked an element. Smoke surfaced that as disorienting and
 * the behavior was removed. These helpers stayed because they still compute
 * useful "maps related to this element" lists for other surfaces:
 *
 *   - `getAssociatedMaps(elementId, elements)` — used by the element-detail
 *     top-bar pin/map cluster (DESIGN_MAPS.md §3.5).
 *   - `getLocationMapPresence(locationId, elements)` — Locations also surface
 *     descendant maps (maps anchored to any location in the subtree).
 *
 * Both are pure functions over an elements snapshot — no state reads, no DOM.
 */

import type { Element, Pin, Marker, WorldMap } from '../../core/types';

/**
 * Whether an element has a Map element anchored to it via `map.location`.
 * Today only Locations can own sub-maps (the OW schema lets `map.location`
 * point at a Location id). Used by pin rendering to decide if the small
 * map-badge glyph should overlay the pin — the badge means "this element
 * has its own map" (i.e. clicking opens a sub-map), not "this element
 * appears on a map" (which would always be true if it has a pin).
 */
export function hasLinkedSubMap(
  elementId: string,
  elements: readonly Element[],
): boolean {
  const el = elements.find(e => e.id === elementId);
  if (!el || el.type !== 'location') return false;
  return elements.some(
    m => m.type === 'map' && m.location === elementId,
  );
}

/**
 * How many `parent_map` steps lie above a map, counted up to the first break:
 * a parent that is not a map in this world, or a step back onto a map already
 * walked (a cycle). A root, or a map whose parent is gone, is 0.
 */
function mapDepths(elements: readonly Element[]): Map<string, number> {
  const parentOf = new Map<string, string | undefined>();
  for (const e of elements) {
    if (e.type !== 'map') continue;
    const p = (e as WorldMap).parent_map;
    parentOf.set(e.id, typeof p === 'string' && p ? p : undefined);
  }
  const depth = new Map<string, number>();
  for (const id of parentOf.keys()) {
    const seen = new Set<string>([id]);
    let n = 0;
    let at = parentOf.get(id);
    while (at !== undefined && parentOf.has(at) && !seen.has(at)) {
      seen.add(at);
      n++;
      at = parentOf.get(at);
    }
    depth.set(id, n);
  }
  return depth;
}

/**
 * The order a map is picked in, first to last (DESIGN_MAPS.md §1.3: nesting is
 * said by `parent_map`, and `hierarchy` only orders siblings, lower first):
 * the deepest map in the `parent_map` tree, then the lowest `hierarchy` (none
 * reads as 0), then the name, then the id by code point.
 */
export function mapPickOrder(elements: readonly Element[]): (a: WorldMap, b: WorldMap) => number {
  const depth = mapDepths(elements);
  return (a, b) => {
    const dA = depth.get(a.id) ?? 0;
    const dB = depth.get(b.id) ?? 0;
    if (dA !== dB) return dB - dA;
    const hA = typeof a.hierarchy === 'number' && Number.isFinite(a.hierarchy) ? a.hierarchy : 0;
    const hB = typeof b.hierarchy === 'number' && Number.isFinite(b.hierarchy) ? b.hierarchy : 0;
    if (hA !== hB) return hA - hB;
    const byName = (typeof a.name === 'string' ? a.name : '').localeCompare(typeof b.name === 'string' ? b.name : '');
    if (byName !== 0) return byName;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/**
 * Maps associated with an element, in `mapPickOrder` (deepest first):
 *   - Location element  → maps where `map.location === element.id`
 *   - Zone element      → distinct maps that have a marker with
 *                         `marker.zone_id === element.id` (zones live on
 *                         a map via their markers, not directly)
 *   - Other element     → distinct maps that have a pin with
 *                         `pin.element_id === element.id`
 */
export function getAssociatedMaps(
  elementId: string,
  elements: readonly Element[],
): WorldMap[] {
  const el = elements.find(e => e.id === elementId);
  if (!el) return [];

  let candidates: WorldMap[] = [];
  if (el.type === 'location') {
    candidates = elements.filter(
      (m): m is WorldMap => m.type === 'map' && m.location === elementId,
    );
  } else if (el.type === 'zone') {
    // Zones live on maps transitively via their markers (DESIGN_ZONES.md §1).
    const targetedMapIds = new Set<string>();
    for (const m of elements) {
      if (m.type !== 'marker') continue;
      const marker = m as Marker;
      if (marker.zone_id === elementId) targetedMapIds.add(marker.map_id);
    }
    candidates = elements.filter(
      (m): m is WorldMap => m.type === 'map' && targetedMapIds.has(m.id),
    );
  } else {
    // Find pins for this element; collect their distinct map ids.
    const targetedMapIds = new Set<string>();
    for (const p of elements) {
      if (p.type !== 'pin') continue;
      const pin = p as Pin;
      if (pin.element_id === elementId) targetedMapIds.add(pin.map_id);
    }
    candidates = elements.filter(
      (m): m is WorldMap => m.type === 'map' && targetedMapIds.has(m.id),
    );
  }

  return candidates.sort(mapPickOrder(elements));
}

/**
 * For a Location element, gather both direct maps (anchored to this
 * location) and descendant maps (anchored to any location in this
 * location's subtree). Walks `parent_location` chains transitively.
 *
 * Pure function. Returns two lists, each in `mapPickOrder`.
 */
export interface LocationMapPresence {
  direct: WorldMap[];
  descendants: WorldMap[];
}

export function getLocationMapPresence(
  locationId: string,
  elements: readonly Element[],
): LocationMapPresence {
  // Build a parent → children map for locations.
  const childrenByParent = new Map<string, string[]>();
  for (const e of elements) {
    if (e.type !== 'location') continue;
    const parent = e['parent_location'];
    if (typeof parent === 'string' && parent) {
      const arr = childrenByParent.get(parent) ?? [];
      arr.push(e.id);
      childrenByParent.set(parent, arr);
    }
  }

  // BFS to find descendant location ids. Bounded by visited-set so any
  // pathological cycle in parent_location doesn't infinite-loop.
  const descendantLocIds = new Set<string>();
  const queue: string[] = [...(childrenByParent.get(locationId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (descendantLocIds.has(id)) continue;
    descendantLocIds.add(id);
    for (const childId of childrenByParent.get(id) ?? []) {
      queue.push(childId);
    }
  }

  const order = mapPickOrder(elements);
  const sortMaps = (arr: WorldMap[]): WorldMap[] => arr.sort(order);

  const direct = sortMaps(
    elements.filter((m): m is WorldMap => m.type === 'map' && m.location === locationId),
  );
  const descendants = sortMaps(
    elements.filter(
      (m): m is WorldMap =>
        m.type === 'map' &&
        typeof m.location === 'string' &&
        descendantLocIds.has(m.location),
    ),
  );

  return { direct, descendants };
}
