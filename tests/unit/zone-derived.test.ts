/**
 * Pure-function tests for zone-derived views.
 *
 * Zones have no spatial relationship in OW canon; everything is reconstructed
 * from markers (see DESIGN_ZONES.md §1). These tests pin the reconstruction
 * contract.
 */

import { describe, it, expect } from 'vitest';
import {
  listZonesOnMap,
  markersForZoneOnMap,
  zoneGeometry,
  isOrphanZone,
  partitionZonesAndMarkers,
  getZoneShape,
} from '../../src/tabs/right/zone-derived';
import type { Zone, Marker, Element } from '../../src/core/types';

function zone(id: string, name = id, extras: Partial<Zone> = {}): Zone {
  return {
    id,
    type: 'zone',
    name,
    local_updated_at: '2026-05-16T00:00:00.000Z',
    ...extras,
  };
}

function marker(id: string, mapId: string, zoneId: string | undefined, x: number, y: number, order: number): Marker {
  return {
    id,
    type: 'marker',
    name: '',
    map_id: mapId,
    zone_id: zoneId,
    x,
    y,
    order,
    local_updated_at: '2026-05-16T00:00:00.000Z',
  };
}

describe('listZonesOnMap', () => {
  it('returns zones with at least one marker on the map', () => {
    const zones = [zone('z1'), zone('z2'), zone('z3')];
    const markers = [
      marker('m1', 'map-A', 'z1', 0, 0, 0),
      marker('m2', 'map-A', 'z2', 0, 0, 0),
      marker('m3', 'map-B', 'z3', 0, 0, 0),
    ];
    expect(listZonesOnMap('map-A', markers, zones).map(z => z.id)).toEqual(['z1', 'z2']);
    expect(listZonesOnMap('map-B', markers, zones).map(z => z.id)).toEqual(['z3']);
  });

  it('returns empty when no markers reference the map', () => {
    const zones = [zone('z1')];
    const markers = [marker('m1', 'map-A', 'z1', 0, 0, 0)];
    expect(listZonesOnMap('map-empty', markers, zones)).toEqual([]);
  });

  it('handles a zone with markers on multiple maps (cross-map zone)', () => {
    const zones = [zone('trade-route')];
    const markers = [
      marker('m1', 'map-North', 'trade-route', 50, 50, 0),
      marker('m2', 'map-North', 'trade-route', 500, 500, 1),
      marker('m3', 'map-South', 'trade-route', 50, 50, 2),
      marker('m4', 'map-South', 'trade-route', 500, 500, 3),
    ];
    expect(listZonesOnMap('map-North', markers, zones)).toHaveLength(1);
    expect(listZonesOnMap('map-South', markers, zones)).toHaveLength(1);
    expect(listZonesOnMap('map-North', markers, zones)[0].id).toBe('trade-route');
  });

  it('skips markers without a zone_id (they do not contribute to chip strip)', () => {
    const zones = [zone('z1')];
    const markers = [
      marker('m-orphan', 'map-A', undefined, 0, 0, 0),
      marker('m1', 'map-A', 'z1', 0, 0, 1),
    ];
    expect(listZonesOnMap('map-A', markers, zones).map(z => z.id)).toEqual(['z1']);
  });

  it('does not return a zone whose only matching markers reference a different zone id', () => {
    const zones = [zone('z1'), zone('z2')];
    const markers = [marker('m1', 'map-A', 'z1', 0, 0, 0)];
    expect(listZonesOnMap('map-A', markers, zones).map(z => z.id)).toEqual(['z1']);
  });

  it('preserves input order of zones for stable rendering', () => {
    const zones = [zone('z3'), zone('z1'), zone('z2')];
    const markers = [
      marker('mA', 'map-X', 'z1', 0, 0, 0),
      marker('mB', 'map-X', 'z2', 0, 0, 0),
      marker('mC', 'map-X', 'z3', 0, 0, 0),
    ];
    expect(listZonesOnMap('map-X', markers, zones).map(z => z.id)).toEqual(['z3', 'z1', 'z2']);
  });
});

describe('markersForZoneOnMap', () => {
  it('returns markers belonging to the zone+map, sorted by order ascending', () => {
    const markers = [
      marker('m1', 'map-A', 'z1', 100, 100, 2),
      marker('m2', 'map-A', 'z1', 200, 200, 0),
      marker('m3', 'map-A', 'z1', 300, 300, 1),
      marker('m4', 'map-A', 'z2', 0, 0, 0),       // decoy: different zone
      marker('m5', 'map-B', 'z1', 0, 0, 0),       // decoy: different map
    ];
    const result = markersForZoneOnMap('z1', 'map-A', markers);
    expect(result.map(m => m.id)).toEqual(['m2', 'm3', 'm1']);
  });

  it('returns empty when zone has no markers on the map', () => {
    const markers = [marker('m1', 'map-B', 'z1', 0, 0, 0)];
    expect(markersForZoneOnMap('z1', 'map-A', markers)).toEqual([]);
  });

  it('treats missing order as 0 (deterministic but degenerate)', () => {
    const noOrder: Marker = {
      id: 'm-legacy',
      type: 'marker',
      name: '',
      map_id: 'map-A',
      zone_id: 'z1',
      x: 0,
      y: 0,
      local_updated_at: '2026-05-16T00:00:00.000Z',
    };
    const result = markersForZoneOnMap('z1', 'map-A', [noOrder]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m-legacy');
  });
});

describe('zoneGeometry', () => {
  it('returns sorted (x,y) point list', () => {
    const markers = [
      marker('m1', 'map-A', 'z1', 300, 400, 2),
      marker('m2', 'map-A', 'z1', 100, 200, 0),
      marker('m3', 'map-A', 'z1', 500, 600, 1),
    ];
    expect(zoneGeometry('z1', 'map-A', markers)).toEqual([
      { x: 100, y: 200 },
      { x: 500, y: 600 },
      { x: 300, y: 400 },
    ]);
  });
});

describe('isOrphanZone', () => {
  it('true when zone has no markers anywhere', () => {
    expect(isOrphanZone(zone('z1'), [])).toBe(true);
    expect(isOrphanZone(zone('z1'), [marker('m1', 'map-A', 'z2', 0, 0, 0)])).toBe(true);
  });

  it('false when zone has at least one marker', () => {
    expect(
      isOrphanZone(zone('z1'), [marker('m1', 'map-A', 'z1', 0, 0, 0)]),
    ).toBe(false);
  });
});

describe('partitionZonesAndMarkers', () => {
  it('separates zone and marker elements, ignoring other types', () => {
    const elements: Element[] = [
      zone('z1'),
      marker('m1', 'map-A', 'z1', 0, 0, 0),
      { id: 'char-1', type: 'character', name: 'Alice', local_updated_at: '2026-05-16T00:00:00.000Z' },
      zone('z2'),
      marker('m2', 'map-A', 'z2', 0, 0, 0),
    ];
    const { zones, markers } = partitionZonesAndMarkers(elements);
    expect(zones.map(z => z.id)).toEqual(['z1', 'z2']);
    expect(markers.map(m => m.id)).toEqual(['m1', 'm2']);
  });
});

describe('getZoneShape', () => {
  it('reads atlas_shape first', () => {
    expect(getZoneShape(zone('z', 'z', { atlas_shape: 'line', supertype: 'Polygon' } as Partial<Zone>))).toBe('line');
    expect(getZoneShape(zone('z', 'z', { atlas_shape: 'polygon', supertype: 'Line' } as Partial<Zone>))).toBe('polygon');
  });

  // Only atlas writes atlas_shape. Every other writer puts the shape in
  // supertype under its own casing (zoner: `line`; Skeld's Sikelia writer:
  // `Line`), and a zone from any of them has nothing else to say what it is.
  it('falls back to supertype in any casing', () => {
    expect(getZoneShape(zone('z', 'z', { supertype: 'line' }))).toBe('line');
    expect(getZoneShape(zone('z', 'z', { supertype: 'Line' }))).toBe('line');
    expect(getZoneShape(zone('z', 'z', { supertype: 'LINE ' }))).toBe('line');
    expect(getZoneShape(zone('z', 'z', { supertype: 'Polygon' }))).toBe('polygon');
  });

  it('defaults to polygon for anything else', () => {
    expect(getZoneShape(zone('z', 'z', { supertype: 'River' }))).toBe('polygon');
    expect(getZoneShape(zone('z', 'z', { supertype: '' }))).toBe('polygon');
    expect(getZoneShape(undefined)).toBe('polygon');
  });
});
