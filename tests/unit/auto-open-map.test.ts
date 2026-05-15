/**
 * getAssociatedMaps — pure logic from auto-open-map.ts (DESIGN_MAPS.md §3.6).
 *
 * Verifies:
 *   - Location element → maps anchored to it (via map.location === id)
 *   - Non-location element → maps with pins targeting it
 *   - Hierarchy DESC sort for picker default-highlight
 *   - Locked-active flag is passed through faithfully
 *   - Unknown element id → empty maps
 */

import { describe, it, expect } from 'vitest';
import { getAssociatedMaps, getLocationMapPresence } from '../../src/tabs/right/auto-open-map';
import type { Element } from '../../src/core/types';
import { mkMap, mkLocation } from '../fixtures/map-worlds/shared';

function mkPin(partial: { id: string; element_id: string; map_id: string }): Element {
  return {
    id: partial.id,
    type: 'pin',
    name: '',
    local_updated_at: new Date().toISOString(),
    element_id: partial.element_id,
    map_id: partial.map_id,
    x: 0,
    y: 0,
  };
}

function mkChar(partial: { id: string; name: string }): Element {
  return {
    id: partial.id,
    type: 'character',
    name: partial.name,
    local_updated_at: new Date().toISOString(),
  };
}

describe('getAssociatedMaps — Location elements', () => {
  it('returns maps where map.location === locationId', () => {
    const loc = mkLocation({ id: 'loc-1', name: 'Eldoria' });
    const m1 = mkMap({ id: 'm1', name: 'Eldoria City', location: 'loc-1', hierarchy: 0 });
    const m2 = mkMap({ id: 'm2', name: 'Eldoria Castle', location: 'loc-1', hierarchy: 1 });
    const other = mkMap({ id: 'm3', name: 'Some Other', location: 'loc-2', hierarchy: 0 });

    const result = getAssociatedMaps('loc-1', [loc, m1, m2, other], false);
    expect(result.maps.map(m => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('hierarchy DESC sort places highest-hierarchy first', () => {
    const loc = mkLocation({ id: 'loc-1', name: 'Castle' });
    const lowH = mkMap({ id: 'low', name: 'Castle (overview)', location: 'loc-1', hierarchy: 0 });
    const midH = mkMap({ id: 'mid', name: 'Castle Floor 1', location: 'loc-1', hierarchy: 1 });
    const highH = mkMap({ id: 'high', name: 'Throne Room', location: 'loc-1', hierarchy: 2 });

    const result = getAssociatedMaps('loc-1', [loc, lowH, midH, highH], false);
    expect(result.maps.map(m => m.id)).toEqual(['high', 'mid', 'low']);
  });

  it('hierarchy ties break alphabetically', () => {
    const loc = mkLocation({ id: 'loc-1', name: 'Place' });
    const a = mkMap({ id: 'a', name: 'Apple', location: 'loc-1', hierarchy: 0 });
    const z = mkMap({ id: 'z', name: 'Zebra', location: 'loc-1', hierarchy: 0 });

    const result = getAssociatedMaps('loc-1', [loc, z, a], false);
    expect(result.maps.map(m => m.id)).toEqual(['a', 'z']);
  });

  it('no associated maps → empty list', () => {
    const loc = mkLocation({ id: 'lonely-loc', name: 'Lonely' });
    const m = mkMap({ id: 'm1', name: 'Other Map', location: 'other-loc' });
    const result = getAssociatedMaps('lonely-loc', [loc, m], false);
    expect(result.maps).toEqual([]);
  });
});

describe('getAssociatedMaps — non-location elements (via pins)', () => {
  it('returns distinct maps targeted by pins for this element', () => {
    const char = mkChar({ id: 'char-1', name: 'Bob' });
    const m1 = mkMap({ id: 'm1', name: 'Map One' });
    const m2 = mkMap({ id: 'm2', name: 'Map Two' });
    const m3 = mkMap({ id: 'm3', name: 'Map Three' });
    const pinA = mkPin({ id: 'pA', element_id: 'char-1', map_id: 'm1' });
    const pinB = mkPin({ id: 'pB', element_id: 'char-1', map_id: 'm2' });
    const pinC = mkPin({ id: 'pC', element_id: 'other-char', map_id: 'm3' });

    const result = getAssociatedMaps('char-1', [char, m1, m2, m3, pinA, pinB, pinC], false);
    expect(result.maps.map(m => m.id).sort()).toEqual(['m1', 'm2']);
  });

  it('multiple pins on the same map count as one association', () => {
    const char = mkChar({ id: 'c1', name: 'Bob' });
    const m1 = mkMap({ id: 'm1', name: 'M' });
    const pinA = mkPin({ id: 'pA', element_id: 'c1', map_id: 'm1' });
    const pinB = mkPin({ id: 'pB', element_id: 'c1', map_id: 'm1' });
    const result = getAssociatedMaps('c1', [char, m1, pinA, pinB], false);
    expect(result.maps.map(m => m.id)).toEqual(['m1']);
  });

  it('character with no pins → empty list', () => {
    const char = mkChar({ id: 'c1', name: 'Bob' });
    const m1 = mkMap({ id: 'm1', name: 'M' });
    expect(getAssociatedMaps('c1', [char, m1], false).maps).toEqual([]);
  });
});

describe('getAssociatedMaps — defensive', () => {
  it('unknown element id → empty list', () => {
    const result = getAssociatedMaps('ghost', [], false);
    expect(result.maps).toEqual([]);
  });

  it('lockedActive flag passes through', () => {
    expect(getAssociatedMaps('ghost', [], false).lockedActive).toBe(false);
    expect(getAssociatedMaps('ghost', [], true).lockedActive).toBe(true);
  });
});

describe('getLocationMapPresence — Location subtree map collection', () => {
  it('returns direct maps (anchored to this location)', () => {
    const loc = mkLocation({ id: 'loc-1', name: 'City' });
    const m1 = mkMap({ id: 'm1', name: 'City Overview', location: 'loc-1' });
    const m2 = mkMap({ id: 'm2', name: 'City Detail', location: 'loc-1' });
    const other = mkMap({ id: 'm3', name: 'Other', location: 'loc-2' });

    const { direct, descendants } = getLocationMapPresence('loc-1', [loc, m1, m2, other]);
    expect(direct.map(m => m.id).sort()).toEqual(['m1', 'm2']);
    expect(descendants).toEqual([]);
  });

  it('returns descendant maps (via parent_location chain)', () => {
    const country = mkLocation({ id: 'country', name: 'Country' });
    const city = mkLocation({ id: 'city', name: 'City', parent_location: 'country' });
    const district = mkLocation({ id: 'district', name: 'District', parent_location: 'city' });
    const tavern = mkLocation({ id: 'tavern', name: 'Tavern', parent_location: 'district' });
    const countryMap = mkMap({ id: 'm-country', name: 'Country Map', location: 'country' });
    const cityMap = mkMap({ id: 'm-city', name: 'City Map', location: 'city' });
    const tavernMap = mkMap({ id: 'm-tavern', name: 'Tavern Map', location: 'tavern' });

    const elements = [country, city, district, tavern, countryMap, cityMap, tavernMap];
    const { direct, descendants } = getLocationMapPresence('country', elements);
    expect(direct.map(m => m.id)).toEqual(['m-country']);
    expect(descendants.map(m => m.id).sort()).toEqual(['m-city', 'm-tavern']);
  });

  it('intermediate locations without maps are still walked through', () => {
    // City → District (no map) → Tavern (map)
    const city = mkLocation({ id: 'city', name: 'City' });
    const district = mkLocation({ id: 'district', name: 'District', parent_location: 'city' });
    const tavern = mkLocation({ id: 'tavern', name: 'Tavern', parent_location: 'district' });
    const tavernMap = mkMap({ id: 'm-tavern', name: 'Tavern Interior', location: 'tavern' });

    const result = getLocationMapPresence('city', [city, district, tavern, tavernMap]);
    expect(result.direct).toEqual([]);
    expect(result.descendants.map(m => m.id)).toEqual(['m-tavern']);
  });

  it('descendants sorted by hierarchy DESC, alpha-tied', () => {
    const root = mkLocation({ id: 'root', name: 'Root' });
    const child = mkLocation({ id: 'child', name: 'Child', parent_location: 'root' });
    const lowH = mkMap({ id: 'low', name: 'Low', location: 'child', hierarchy: 0 });
    const highH = mkMap({ id: 'high', name: 'High', location: 'child', hierarchy: 2 });
    const midH_a = mkMap({ id: 'mid-a', name: 'Apple', location: 'child', hierarchy: 1 });
    const midH_z = mkMap({ id: 'mid-z', name: 'Zebra', location: 'child', hierarchy: 1 });

    const { descendants } = getLocationMapPresence('root', [root, child, lowH, highH, midH_a, midH_z]);
    expect(descendants.map(m => m.id)).toEqual(['high', 'mid-a', 'mid-z', 'low']);
  });

  it('lonely location (no maps anywhere in subtree) returns empty', () => {
    const loc = mkLocation({ id: 'loc', name: 'Empty' });
    const child = mkLocation({ id: 'c', name: 'Child', parent_location: 'loc' });
    const result = getLocationMapPresence('loc', [loc, child]);
    expect(result.direct).toEqual([]);
    expect(result.descendants).toEqual([]);
  });

  it('handles pathological parent_location cycle without infinite loop', () => {
    // Cycle: A → B → A. The algorithm uses a visited-set so this terminates.
    const A = mkLocation({ id: 'A', name: 'A', parent_location: 'B' });
    const B = mkLocation({ id: 'B', name: 'B', parent_location: 'A' });
    const result = getLocationMapPresence('A', [A, B]);
    expect(result.direct).toEqual([]);
    // No maps exist; descendants are also empty.
    expect(result.descendants).toEqual([]);
  });
});
