/**
 * Locate-on-map: given an element the sidebar marks as present on the active
 * map (the `place` badge), resolve WHERE on that map to pan. Two kinds of
 * presence, mirroring the badge's own logic (elements-sidebar renders it for
 * either):
 *
 *   - a PIN on the active map points at the element → the pin's stored coords.
 *   - a ZONE with markers on the active map → the centroid of those markers.
 *
 * Pure and store-free so it unit-tests without a folder or a Leaflet map; the
 * sidebar caller does the getState + panMapTabTo wiring. Returns null when no
 * position resolves (the caller then falls through to opening the element).
 */

import type { Element } from '../core/types';

type Spatial = Record<string, unknown>;

export function locateTargetFor(
  elements: Element[],
  elementId: string,
  activeMapId: string,
): { x: number; y: number } | null {
  // A pin on the active map that references this element wins — that is the
  // element's own placement.
  for (const el of elements) {
    if (el.type !== 'pin') continue;
    const p = el as Spatial;
    if (p.map_id === activeMapId && p.element_id === elementId
        && typeof p.x === 'number' && typeof p.y === 'number') {
      return { x: p.x, y: p.y };
    }
  }
  // Otherwise, if the element is a zone with markers on the active map, aim at
  // their centroid (a zone has no single point of its own).
  const target = elements.find(el => el.id === elementId);
  if (target && target.type === 'zone') {
    const markers = elements.filter(el => {
      if (el.type !== 'marker') return false;
      const m = el as Spatial;
      return m.map_id === activeMapId && m.zone_id === elementId
        && typeof m.x === 'number' && typeof m.y === 'number';
    }) as Spatial[];
    if (markers.length > 0) {
      const cx = Math.round(markers.reduce((s, m) => s + (m.x as number), 0) / markers.length);
      const cy = Math.round(markers.reduce((s, m) => s + (m.y as number), 0) / markers.length);
      return { x: cx, y: cy };
    }
  }
  return null;
}
