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
    await folder.createPin({ id: 'pin-1', name: 'Alice@home', element_id: char.id, map_id: map.id, x: 0, y: 0 });
    await folder.createPin({ id: 'pin-2', name: 'Alice@inn', element_id: char.id, map_id: map.id, x: 1, y: 1 });
    // Decoy: pin for a different element.
    await folder.createPin({ id: 'pin-3', name: 'other', element_id: 'someone-else', map_id: map.id, x: 0, y: 0 });

    const deps = await folder.findDependents(char.id);
    expect(deps.map(d => d.id).sort()).toEqual(['pin-1', 'pin-2']);
  });

  it('returns pins, zones, and markers on a deleted map', async () => {
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    const other = await folder.createMap({ id: 'map-2', name: 'Other' });
    await folder.createPin({ id: 'pin-1', name: 'p', element_id: 'el-1', map_id: map.id, x: 0, y: 0 });
    await folder.createZone({ id: 'zone-1', name: 'z', map_id: map.id });
    await folder.createMarker({ id: 'mark-1', name: 'm', map_id: map.id, x: 0, y: 0 });
    // Decoy on a different map.
    await folder.createPin({ id: 'pin-other', name: 'p', element_id: 'el-2', map_id: other.id, x: 0, y: 0 });

    const deps = await folder.findDependents(map.id);
    expect(deps.map(d => d.id).sort()).toEqual(['mark-1', 'pin-1', 'zone-1']);
  });

  it('returns empty for leaf types (pin, zone, marker)', async () => {
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    const pin = await folder.createPin({ id: 'pin-1', name: 'p', element_id: 'el-1', map_id: map.id, x: 0, y: 0 });
    expect(await folder.findDependents(pin.id)).toEqual([]);
  });

  it('returns empty for missing ids', async () => {
    expect(await folder.findDependents('nonexistent')).toEqual([]);
  });
});

describe('FolderStore.deleteElement cascade behavior', () => {
  it('cascade-deletes pins when a character is removed', async () => {
    const char = await folder.createElement('character', { id: 'char-1', name: 'Alice' });
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createPin({ id: 'pin-1', name: 'p1', element_id: char.id, map_id: map.id, x: 0, y: 0 });
    await folder.createPin({ id: 'pin-2', name: 'p2', element_id: char.id, map_id: map.id, x: 1, y: 1 });

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

  it('cascade-deletes pins/zones/markers when a map is removed', async () => {
    const map = await folder.createMap({ id: 'map-1', name: 'Atlas' });
    await folder.createPin({ id: 'pin-1', name: 'p', element_id: 'el-1', map_id: map.id, x: 0, y: 0 });
    await folder.createZone({ id: 'zone-1', name: 'z', map_id: map.id });
    await folder.createMarker({ id: 'mark-1', name: 'm', map_id: map.id, x: 0, y: 0 });

    const { tombstones } = await folder.deleteMap(map.id);
    expect(tombstones).toHaveLength(4);
    expect(tombstones[tombstones.length - 1].id).toBe(map.id);
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
