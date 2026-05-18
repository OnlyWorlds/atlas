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
 * Maps associated with an element, sorted by hierarchy DESC then alpha:
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

  candidates.sort((a, b) => {
    const aH = typeof a.hierarchy === 'number' ? a.hierarchy : 0;
    const bH = typeof b.hierarchy === 'number' ? b.hierarchy : 0;
    if (aH !== bH) return bH - aH; // hierarchy DESC
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  return candidates;
}

/**
 * For a Location element, gather both direct maps (anchored to this
 * location) and descendant maps (anchored to any location in this
 * location's subtree). Walks `parent_location` chains transitively.
 *
 * Pure function. Returns two lists, each sorted by hierarchy DESC then alpha.
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

  const sortMaps = (arr: WorldMap[]): WorldMap[] => {
    return arr.sort((a, b) => {
      const aH = typeof a.hierarchy === 'number' ? a.hierarchy : 0;
      const bH = typeof b.hierarchy === 'number' ? b.hierarchy : 0;
      if (aH !== bH) return bH - aH; // hierarchy DESC
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  };

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
