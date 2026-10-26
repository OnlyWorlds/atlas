/**
 * FolderStore cascade-delete contract.
 *
 * Run against the in-memory MockFolderStore. The real FS Access-backed impl
 * (Phase 1 remaining) must honor the same contract — Bout 3 will lift this
 * into a parameterized contract suite that runs against both.
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

describe('FolderStore.findDependents', () => {
  it('returns pins whose element_id references a content element', async () => {
    const char = await folder.createElement('character', { id: 'char-1', name: 'Alice' });
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    // Alice is pinned on TWO maps. She cannot be pinned twice on ONE map
    // (the uniqueness rule), and two maps is the real shape anyway: the
    // dependents sweep has to cross maps, which a same-map pair never tested.
    const map2 = await folder.createMap({ id: 'map-2', name: 'The Inn' });
    await folder.createPin({ id: 'pin-1', name: 'Alice@home', element_id: char.id, map_id: map.id, x: 0, y: 0 });
    await folder.createPin({ id: 'pin-2', name: 'Alice@inn', element_id: char.id, map_id: map2.id, x: 1, y: 1 });
    // Decoy: pin for a different element.
    await folder.createPin({ id: 'pin-3', name: 'other', element_id: 'someone-else', map_id: map.id, x: 0, y: 0 });

    const deps = await folder.findDependents(char.id);
    expect(deps.map(d => d.id).sort()).toEqual(['pin-1', 'pin-2']);
  });

  it('returns pins and markers on a deleted map (zones are NOT cascaded)', async () => {
    // Per DESIGN_ZONES.md §6.1: Zones have no map relationship.
    // Markers carry the map. A map delete tombstones pins + markers; zones
    // whose only markers were on the deleted map become orphan metadata.
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    const other = await folder.createMap({ id: 'map-2', name: 'Other' });
    await folder.createPin({ id: 'pin-1', name: 'p', element_id: 'el-1', map_id: map.id, x: 0, y: 0 });
    await folder.createZone({ id: 'zone-1', name: 'z' });
    await folder.createMarker({ id: 'mark-1', name: 'm', map_id: map.id, zone_id: 'zone-1', x: 0, y: 0, order: 0 });
    // Decoy on a different map.
    await folder.createPin({ id: 'pin-other', name: 'p', element_id: 'el-2', map_id: other.id, x: 0, y: 0 });

    const deps = await folder.findDependents(map.id);
    expect(deps.map(d => d.id).sort()).toEqual(['mark-1', 'pin-1']);
  });

  it('returns markers belonging to a deleted zone', async () => {
    await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createZone({ id: 'zone-1', name: 'z' });
    await folder.createMarker({ id: 'm1', name: 'm', map_id: 'map-1', zone_id: 'zone-1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm2', name: 'm', map_id: 'map-1', zone_id: 'zone-1', x: 1, y: 1, order: 1 });
    // Decoy: marker on a different zone.
    await folder.createZone({ id: 'zone-2', name: 'z2' });
    await folder.createMarker({ id: 'm3', name: 'm', map_id: 'map-1', zone_id: 'zone-2', x: 2, y: 2, order: 0 });

    const deps = await folder.findDependents('zone-1');
    expect(deps.map(d => d.id).sort()).toEqual(['m1', 'm2']);
  });

  it('returns empty for leaf types (pin, marker)', async () => {
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    const pin = await folder.createPin({ id: 'pin-1', name: 'p', element_id: 'el-1', map_id: map.id, x: 0, y: 0 });
    expect(await folder.findDependents(pin.id)).toEqual([]);
    const marker = await folder.createMarker({ id: 'mk-1', name: 'm', map_id: map.id, x: 0, y: 0 });
    expect(await folder.findDependents(marker.id)).toEqual([]);
  });

  it('returns empty for missing ids', async () => {
    expect(await folder.findDependents('nonexistent')).toEqual([]);
  });
});

describe('FolderStore.deleteElement cascade behavior', () => {
  it('cascade-deletes pins when a character is removed', async () => {
    const char = await folder.createElement('character', { id: 'char-1', name: 'Alice' });
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    // Two maps, not two pins on one — see the sibling test above.
    const map2 = await folder.createMap({ id: 'map-2', name: 'The Inn' });
    await folder.createPin({ id: 'pin-1', name: 'p1', element_id: char.id, map_id: map.id, x: 0, y: 0 });
    await folder.createPin({ id: 'pin-2', name: 'p2', element_id: char.id, map_id: map2.id, x: 1, y: 1 });

    const { tombstones } = await folder.deleteElement(char.id);
    expect(tombstones).toHaveLength(3);

    // Primary is LAST so server DELETEs execute in dependency-safe order.
    expect(tombstones[tombstones.length - 1].id).toBe(char.id);
    expect(tombstones.slice(0, -1).map(t => t.id).sort()).toEqual(['pin-1', 'pin-2']);

    // Elements actually gone.
    expect(await folder.getElement('char-1')).toBeNull();
    expect(await folder.getElement('pin-1')).toBeNull();
    expect(await folder.getElement('pin-2')).toBeNull();
  });

  it('cascade-deletes pins and markers when a map is removed (zones survive)', async () => {
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createPin({ id: 'pin-1', name: 'p', element_id: 'el-1', map_id: map.id, x: 0, y: 0 });
    await folder.createZone({ id: 'zone-1', name: 'z' });
    await folder.createMarker({ id: 'mark-1', name: 'm', map_id: map.id, zone_id: 'zone-1', x: 0, y: 0, order: 0 });

    const { tombstones } = await folder.deleteMap(map.id);
    // 3 tombstones: pin + marker + map (zone is NOT cascaded — pure metadata survives)
    expect(tombstones).toHaveLength(3);
    expect(tombstones[tombstones.length - 1].id).toBe(map.id);
    expect(tombstones.slice(0, -1).map(t => t.id).sort()).toEqual(['mark-1', 'pin-1']);

    // Zone is preserved (orphan metadata, no spatial existence).
    expect(await folder.getElement('zone-1')).not.toBeNull();
  });

  it('cascade-deletes markers when a zone is removed', async () => {
    await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createZone({ id: 'zone-1', name: 'Forest' });
    await folder.createMarker({ id: 'm1', name: 'm', map_id: 'map-1', zone_id: 'zone-1', x: 0, y: 0, order: 0 });
    await folder.createMarker({ id: 'm2', name: 'm', map_id: 'map-1', zone_id: 'zone-1', x: 1, y: 1, order: 1 });
    await folder.createMarker({ id: 'm3', name: 'm', map_id: 'map-1', zone_id: 'zone-1', x: 2, y: 2, order: 2 });

    const { tombstones } = await folder.deleteZone('zone-1');
    // 4 tombstones: 3 markers + the zone itself, zone is primary (last).
    expect(tombstones).toHaveLength(4);
    expect(tombstones[tombstones.length - 1].id).toBe('zone-1');
    expect(tombstones.slice(0, -1).map(t => t.id).sort()).toEqual(['m1', 'm2', 'm3']);

    // All gone.
    expect(await folder.getElement('zone-1')).toBeNull();
    expect(await folder.getElement('m1')).toBeNull();
    expect(await folder.getElement('m2')).toBeNull();
    expect(await folder.getElement('m3')).toBeNull();
  });

  it('cascade: false skips dependents (escape hatch)', async () => {
    const char = await folder.createElement('character', { id: 'char-1', name: 'Alice' });
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createPin({ id: 'pin-1', name: 'p1', element_id: char.id, map_id: map.id, x: 0, y: 0 });

    const { tombstones } = await folder.deleteElement(char.id, { cascade: false });
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].id).toBe(char.id);
    // Pin still there (orphaned — caller's choice).
    expect(await folder.getElement('pin-1')).not.toBeNull();
  });

  it('returns empty tombstones when the id is unknown', async () => {
    const { tombstones } = await folder.deleteElement('nonexistent');
    expect(tombstones).toEqual([]);
  });

  it('no cascade for leaf types', async () => {
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createPin({ id: 'pin-1', name: 'p', element_id: 'el-1', map_id: map.id, x: 0, y: 0 });

    const { tombstones } = await folder.deletePin('pin-1');
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].id).toBe('pin-1');
  });

  it('cascaded tombstones are durable in listTombstonesSince(null)', async () => {
    const char = await folder.createElement('character', { id: 'char-1', name: 'Alice' });
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createPin({ id: 'pin-1', name: 'p1', element_id: char.id, map_id: map.id, x: 0, y: 0 });

    await folder.deleteElement(char.id);
    const all = await folder.listTombstonesSince(null);
    expect(all.map(t => t.id).sort()).toEqual(['char-1', 'pin-1']);
  });
});
