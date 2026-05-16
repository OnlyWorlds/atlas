/**
 * FolderStore zone + marker contract.
 *
 * Zones are pure metadata (no map, no geometry). Markers carry map_id +
 * optional zone_id + x/y/z + order — the only spatial truth. These tests
 * lock the CRUD contract for the new model (see DESIGN_ZONES.md §1).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let folder: MockFolderStore;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
});

describe('Zone CRUD', () => {
  it('creates a zone with pure metadata (no map_id)', async () => {
    const z = await folder.createZone({ id: 'z1', name: 'Forest', supertype: 'polygon' });
    expect(z.id).toBe('z1');
    expect(z.type).toBe('zone');
    expect(z.name).toBe('Forest');
    expect((z as { supertype?: string }).supertype).toBe('polygon');
    // Zone explicitly has NO map_id (would not type-check anyway).
    expect((z as { map_id?: string }).map_id).toBeUndefined();
    expect(z.local_updated_at).toBeTruthy();
  });

  it('updateZone patches fields and bumps local_updated_at', async () => {
    const z = await folder.createZone({ id: 'z1', name: 'Forest', supertype: 'polygon' });
    const original = z.local_updated_at;
    const updated = await folder.updateZone('z1', { name: 'Deep Forest' });
    expect(updated.name).toBe('Deep Forest');
    expect(updated.local_updated_at > original).toBe(true);
  });

  it('listZones returns all zones unfiltered', async () => {
    await folder.createZone({ id: 'z1', name: 'A', supertype: 'polygon' });
    await folder.createZone({ id: 'z2', name: 'B', supertype: 'line' });
    await folder.createZone({ id: 'z3', name: 'C', supertype: 'polygon' });
    const zones = await folder.listZones();
    expect(zones.map(z => z.id).sort()).toEqual(['z1', 'z2', 'z3']);
  });

  it('atlas-extension visual fields persist via update', async () => {
    await folder.createZone({ id: 'z1', name: 'F', supertype: 'polygon' });
    const patched = await folder.updateZone('z1', {
      atlas_color: '#ff8800',
      atlas_opacity: 0.7,
      atlas_label_visible: true,
    });
    expect(patched.atlas_color).toBe('#ff8800');
    expect(patched.atlas_opacity).toBe(0.7);
    expect(patched.atlas_label_visible).toBe(true);
  });
});

describe('Marker CRUD', () => {
  it('creates a marker with full spatial+relational state', async () => {
    const m = await folder.createMarker({
      id: 'm1',
      name: '',
      map_id: 'map-A',
      zone_id: 'z1',
      x: 150,
      y: 250,
      order: 0,
    });
    expect(m.id).toBe('m1');
    expect(m.type).toBe('marker');
    expect(m.map_id).toBe('map-A');
    expect(m.zone_id).toBe('z1');
    expect(m.x).toBe(150);
    expect(m.y).toBe(250);
    expect(m.order).toBe(0);
  });

  it('creates a marker without a zone (free marker, rare)', async () => {
    const m = await folder.createMarker({
      id: 'm-free',
      name: 'standalone',
      map_id: 'map-A',
      x: 0,
      y: 0,
    });
    expect(m.zone_id).toBeUndefined();
  });

  it('updateMarker patches coords/order and bumps local_updated_at', async () => {
    const m = await folder.createMarker({ id: 'm1', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });
    const original = m.local_updated_at;
    const patched = await folder.updateMarker('m1', { x: 500, y: 600, order: 3 });
    expect(patched.x).toBe(500);
    expect(patched.y).toBe(600);
    expect(patched.order).toBe(3);
    expect(patched.local_updated_at > original).toBe(true);
  });

  it('listMarkers (no filter) returns all markers', async () => {
    await folder.createMarker({ id: 'm1', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm2', name: '', map_id: 'map-B', zone_id: 'z2', x: 0, y: 0, order: 0 });
    expect((await folder.listMarkers()).map(m => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('listMarkers({mapId}) filters to one map', async () => {
    await folder.createMarker({ id: 'm1', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm2', name: '', map_id: 'map-A', zone_id: 'z1', x: 1, y: 1, order: 1 });
    await folder.createMarker({ id: 'm3', name: '', map_id: 'map-B', zone_id: 'z1', x: 0, y: 0, order: 0 });
    expect((await folder.listMarkers({ mapId: 'map-A' })).map(m => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('listMarkers({zoneId}) filters across maps', async () => {
    await folder.createMarker({ id: 'm1', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm2', name: '', map_id: 'map-B', zone_id: 'z1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm3', name: '', map_id: 'map-A', zone_id: 'z2', x: 0, y: 0, order: 0 });
    expect((await folder.listMarkers({ zoneId: 'z1' })).map(m => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('listMarkers({mapId, zoneId}) filters both', async () => {
    await folder.createMarker({ id: 'm1', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm2', name: '', map_id: 'map-A', zone_id: 'z2', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm3', name: '', map_id: 'map-B', zone_id: 'z1', x: 0, y: 0, order: 0 });
    expect((await folder.listMarkers({ mapId: 'map-A', zoneId: 'z1' })).map(m => m.id)).toEqual(['m1']);
  });

  it('deleteMarker is a leaf operation (no cascade)', async () => {
    await folder.createMarker({ id: 'm1', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });
    const { tombstones } = await folder.deleteMarker('m1');
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].id).toBe('m1');
  });
});

describe('Cross-map zone (one zone spans two maps via markers)', () => {
  it('one zone has markers on two maps; both maps see the zone', async () => {
    // Zoner-canonical pattern: a single zone object with markers across maps.
    await folder.createZone({ id: 'trade-route', name: 'Trade Route', supertype: 'line' });
    await folder.createMarker({ id: 'mn1', name: '', map_id: 'map-North', zone_id: 'trade-route', x: 50, y: 50, order: 0 });
    await folder.createMarker({ id: 'mn2', name: '', map_id: 'map-North', zone_id: 'trade-route', x: 500, y: 500, order: 1 });
    await folder.createMarker({ id: 'ms1', name: '', map_id: 'map-South', zone_id: 'trade-route', x: 50, y: 50, order: 2 });
    await folder.createMarker({ id: 'ms2', name: '', map_id: 'map-South', zone_id: 'trade-route', x: 500, y: 500, order: 3 });

    expect((await folder.listMarkers({ zoneId: 'trade-route' })).map(m => m.id).sort())
      .toEqual(['mn1', 'mn2', 'ms1', 'ms2']);
    expect((await folder.listMarkers({ mapId: 'map-North', zoneId: 'trade-route' })).map(m => m.id).sort())
      .toEqual(['mn1', 'mn2']);
    expect((await folder.listMarkers({ mapId: 'map-South', zoneId: 'trade-route' })).map(m => m.id).sort())
      .toEqual(['ms1', 'ms2']);
  });

  it('deleting one of two maps preserves the zone and the markers on the other map', async () => {
    await folder.createMap({ id: 'map-A', name: 'A' });
    await folder.createMap({ id: 'map-B', name: 'B' });
    await folder.createZone({ id: 'z1', name: 'Span', supertype: 'polygon' });
    await folder.createMarker({ id: 'ma', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'mb', name: '', map_id: 'map-B', zone_id: 'z1', x: 1, y: 1, order: 0 });

    await folder.deleteMap('map-A');

    // Zone survives.
    expect(await folder.getZone('z1')).not.toBeNull();
    // Marker on the deleted map is gone.
    expect(await folder.getMarker('ma')).toBeNull();
    // Marker on the surviving map persists.
    expect(await folder.getMarker('mb')).not.toBeNull();
  });

  it('orphan zone (all maps deleted) survives as metadata', async () => {
    await folder.createMap({ id: 'map-A', name: 'A' });
    await folder.createZone({ id: 'z1', name: 'Will be orphaned', supertype: 'polygon' });
    await folder.createMarker({ id: 'm1', name: '', map_id: 'map-A', zone_id: 'z1', x: 0, y: 0, order: 0 });

    await folder.deleteMap('map-A');

    // Zone preserved with no spatial existence anywhere.
    const z = await folder.getZone('z1');
    expect(z).not.toBeNull();
    expect(await folder.listMarkers({ zoneId: 'z1' })).toEqual([]);
  });
});
