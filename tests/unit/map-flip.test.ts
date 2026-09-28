/**
 * S361: "flip this map", the remedy for a map placed in Atlas before 1.8
 * (y stored top-down). y' = height - y for every pin and marker on THAT map;
 * pressing it again restores the original.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { flipMapVertically } from '../../src/core/map-flip';

let store: MockFolderStore;

beforeEach(async () => {
  store = new MockFolderStore();
  await store.open(null);
});

async function ys(type: 'pin' | 'marker', mapId: string): Promise<number[]> {
  return (await store.listElements(type))
    .filter(e => (e as unknown as { map_id?: string }).map_id === mapId)
    .map(e => (e as unknown as { y: number }).y)
    .sort((a, b) => a - b);
}

describe('flipMapVertically', () => {
  it('mirrors this map\'s pins and zone points, leaves other maps alone, and undoes itself', async () => {
    const map = await store.createElement('map', { name: 'Old', width: 800, height: 1000 } as never);
    const other = await store.createElement('map', { name: 'Other', width: 800, height: 1000 } as never);
    const loc = await store.createElement('location', { name: 'Keep' });
    await store.createElement('pin', { map_id: map.id, element_id: loc.id, element_type: 'location', x: 10, y: 100 } as never);
    await store.createElement('pin', { map_id: other.id, element_id: loc.id, element_type: 'location', x: 10, y: 100 } as never);
    const zone = await store.createElement('zone', { name: 'Marsh' });
    await store.createElement('marker', { map_id: map.id, zone_id: zone.id, x: 1, y: 250, order: 1 } as never);
    await store.createElement('marker', { map_id: map.id, zone_id: zone.id, x: 2, y: 900, order: 2 } as never);

    const first = await flipMapVertically(store, map.id);
    expect(first).toEqual({ pins: 1, points: 2 });
    expect(await ys('pin', map.id)).toEqual([900]);
    expect(await ys('marker', map.id)).toEqual([100, 750]);
    expect(await ys('pin', other.id)).toEqual([100]);

    await flipMapVertically(store, map.id);
    expect(await ys('pin', map.id)).toEqual([100]);
    expect(await ys('marker', map.id)).toEqual([250, 900]);
  });

  it('refuses a map with no height, touching nothing', async () => {
    const map = await store.createElement('map', { name: 'Sizeless' });
    const loc = await store.createElement('location', { name: 'Keep' });
    await store.createElement('pin', { map_id: map.id, element_id: loc.id, element_type: 'location', x: 10, y: 100 } as never);
    await expect(flipMapVertically(store, map.id)).rejects.toThrow(/no size/);
    expect(await ys('pin', map.id)).toEqual([100]);
  });
});
