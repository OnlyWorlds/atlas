/**
 * Helpers for map-world test fixtures. Keeps the per-world files tight.
 */

import type { WorldMap, Element } from '../../../src/core/types';

export interface LocationFixture extends Element {
  type: 'location';
  parent_location?: string;
}

let stamp = 0;
function nextStamp(): string {
  // Deterministic monotonic ISO strings keyed off a module-level counter so
  // tests that compare timestamps across fixtures stay stable.
  stamp += 1;
  return new Date(Date.UTC(2026, 0, 1, 0, 0, stamp)).toISOString();
}

export function mkMap(partial: Partial<WorldMap> & { id: string; name: string }): WorldMap {
  return {
    id: partial.id,
    type: 'map',
    name: partial.name,
    local_updated_at: nextStamp(),
    image_url: partial.image_url,
    width: partial.width,
    height: partial.height,
    depth: partial.depth,
    background_color: partial.background_color,
    hierarchy: partial.hierarchy,
    parent_map: partial.parent_map,
    location: partial.location,
    image_media_id: partial.image_media_id,
  };
}

export function mkLocation(partial: { id: string; name: string; parent_location?: string }): LocationFixture {
  return {
    id: partial.id,
    type: 'location',
    name: partial.name,
    local_updated_at: nextStamp(),
    parent_location: partial.parent_location,
  };
}
