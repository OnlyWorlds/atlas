/**
 * Derived views for zones.
 *
 * Zones in OW canon have no map relationship and no geometry — markers are
 * the only spatial truth (see DESIGN_ZONES.md §1). These pure functions
 * reconstruct the spatial views the UI needs from the underlying element
 * lists in state.data.elements.
 */

import type { Element, Marker, Zone } from '../../core/types';

export type ZoneShape = 'polygon' | 'line';

/**
 * Resolve a zone's shape (polygon vs line). Reads the local-only extension
 * field `atlas_shape` (preferred) and falls back to legacy `supertype` for
 * zones created before ZD6 — old atlas builds stored 'polygon' / 'line'
 * directly in supertype, conflating shape with OW's free-text taxonomy.
 * Defaults to 'polygon' for anything ambiguous.
 *
 * NEVER use `zone.supertype` directly to decide rendering. Always go through
 * this helper so new zones (with user-meaningful supertype text) render
 * correctly without false-matching the legacy values.
 */
export function getZoneShape(zone: Zone | undefined | null): ZoneShape {
  if (!zone) return 'polygon';
  const atlasShape = (zone as { atlas_shape?: string }).atlas_shape;
  if (atlasShape === 'line' || atlasShape === 'polygon') return atlasShape;
  // Legacy fallback: pre-ZD6 zones stored shape in supertype.
  const legacy = (zone as { supertype?: string }).supertype;
  if (legacy === 'line') return 'line';
  return 'polygon';
}

/**
 * Zones that appear on a given map.
 *
 * A zone "appears" on a map iff at least one Marker references both that
 * zone and that map. Returns each matching zone exactly once, preserving
 * input order of `zones` for stable rendering.
 */
export function listZonesOnMap(
  mapId: string,
  markers: Marker[],
  zones: Zone[],
): Zone[] {
  const zoneIds = new Set<string>();
  for (const m of markers) {
    if (m.map_id === mapId && m.zone_id) zoneIds.add(m.zone_id);
  }
  return zones.filter(z => zoneIds.has(z.id));
}

/**
 * Markers belonging to a zone on a specific map, sorted by `order`.
 *
 * Used by the canvas renderer to compute polygon/polyline points and by the
 * element-detail "Markers" section. Markers without an `order` field sort
 * to position 0 (deterministic but degenerate — drawing assigns explicit
 * orders so this only matters for legacy/imported data).
 */
export function markersForZoneOnMap(
  zoneId: string,
  mapId: string,
  markers: Marker[],
): Marker[] {
  return markers
    .filter(m => m.zone_id === zoneId && m.map_id === mapId)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/**
 * Spatial geometry of a zone on a map — sorted (x, y) points.
 *
 * For polygons the caller closes the path back to the first point at
 * render time. For lines the path is open.
 */
export function zoneGeometry(
  zoneId: string,
  mapId: string,
  markers: Marker[],
): Array<{ x: number; y: number }> {
  return markersForZoneOnMap(zoneId, mapId, markers).map(m => ({ x: m.x, y: m.y }));
}

/**
 * Whether a zone has any markers anywhere.
 *
 * An orphan zone (no markers on any map) is valid metadata but has no
 * spatial existence — it won't appear in any chip strip but still appears
 * in the elements list and referenced-by panels.
 */
export function isOrphanZone(zone: Zone, markers: Marker[]): boolean {
  return !markers.some(m => m.zone_id === zone.id);
}

/**
 * Convenience — split a heterogeneous element list into zones + markers.
 *
 * Centralizes the type-narrowing for callers operating on state.data.elements.
 */
export function partitionZonesAndMarkers(elements: Element[]): {
  zones: Zone[];
  markers: Marker[];
} {
  const zones: Zone[] = [];
  const markers: Marker[] = [];
  for (const e of elements) {
    if (e.type === 'zone') zones.push(e as Zone);
    else if (e.type === 'marker') markers.push(e as Marker);
  }
  return { zones, markers };
}
