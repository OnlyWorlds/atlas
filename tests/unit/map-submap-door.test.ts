/**
 * #139: the pure halves of the submap door. Which maps a pinned place
 * opens, which map is "up", and the tab swap that keeps one tab for the walk.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { submapsFor, parentMapFor, swapMapTab } from '../../src/tabs/right/map-submap-door';
import { getState, patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

const el = (o: Record<string, unknown>) => o as unknown as Element;
const world: Element[] = [
  el({ id: 'loc-realm', type: 'location', name: 'Realm' }),
  el({ id: 'loc-isle', type: 'location', name: 'Isle', parent_location: 'loc-realm' }),
  el({ id: 'loc-town', type: 'location', name: 'Town', parent_location: 'loc-isle' }),
  el({ id: 'map-realm', type: 'map', name: 'Realm Map', location: 'loc-realm' }),
  el({ id: 'map-isle', type: 'map', name: 'Isle Map', location: 'loc-isle', parent_map: 'map-realm' }),
  el({ id: 'map-isle-old', type: 'map', name: 'Isle, Old Survey', location: 'loc-isle', parent_map: 'map-realm', hierarchy: -1 }),
  // No parent_map: placed under the Isle's map by the location chain (DESIGN_MAPS §2).
  el({ id: 'map-town', type: 'map', name: 'Town Map', location: 'loc-town' }),
  el({ id: 'ch', type: 'character', name: 'Someone' }),
];

describe('submapsFor', () => {
  it("a place's maps, in the tree's order, without the map it is pinned on", () => {
    expect(submapsFor('loc-isle', world, 'map-realm').map(m => m.id)).toEqual(['map-isle', 'map-isle-old']);
    expect(submapsFor('loc-isle', world, 'map-isle').map(m => m.id)).toEqual(['map-isle-old']);
  });
  it('a place with no map, or anything not a place, has none', () => {
    expect(submapsFor('ch', world, 'map-realm')).toEqual([]);
    expect(submapsFor('missing', world, 'map-realm')).toEqual([]);
  });
});

describe('parentMapFor', () => {
  it('an explicit parent_map is the way up', () => {
    expect(parentMapFor('map-isle', world)?.id).toBe('map-realm');
  });
  it('without one, the parent the location chain infers', () => {
    expect(parentMapFor('map-town', world)?.id).toBe('map-isle');
  });
  it('a root map, or a map that is gone, has no way up', () => {
    expect(parentMapFor('map-realm', world)).toBeNull();
    expect(parentMapFor('missing', world)).toBeNull();
  });
});

describe('swapMapTab', () => {
  const map = (id: string) => world.find(e => e.id === id) as never;
  beforeEach(() => {
    patchSlice('ui', { ...getState().ui, rightTabs: [
      { kind: 'context' },
      { kind: 'map', mapId: 'map-realm', label: 'Realm Map' },
      { kind: 'map', mapId: 'map-town', label: 'Town Map' },
    ], rightActiveIndex: 1 });
  });
  it('replaces the tab it is called from, in place', () => {
    swapMapTab('map-realm', map('map-isle'));
    const ui = getState().ui;
    expect(ui.rightTabs.map(t => (t.kind === 'map' ? t.mapId : t.kind))).toEqual(['context', 'map-isle', 'map-town']);
    expect(ui.rightActiveIndex).toBe(1);
  });
  it('focuses a target already open elsewhere instead of opening it twice', () => {
    swapMapTab('map-realm', map('map-town'));
    const ui = getState().ui;
    expect(ui.rightTabs).toHaveLength(3);
    expect(ui.rightActiveIndex).toBe(2);
  });
});
