/**
 * The map tree orders siblings by the standard's groups (Map.hierarchy,
 * serial 124): the number orders the maps with the same parent_map; without
 * one, the maps of the same location; without either, the maps of the world
 * itself. The tree also places maps by location inference, so inside a node
 * the maps with that parent_map come first, then the maps placed there by
 * location, one set per location; at the top, the world's own maps, then
 * located maps that found no map up their chain, then broken parents.
 *
 * The first three cases are the three worlds run on 2026-11-13 against
 * 1.124.0's buildMapTree, where one flat hierarchy sort mixed the groups.
 */
import { describe, it, expect } from 'vitest';
import { buildMapTree, type LocationLike, type MapTreeNode } from '../../src/tabs/right/map-tree';
import type { WorldMap } from '../../src/core/types';

const map = (id: string, extra: Partial<WorldMap> = {}): WorldMap =>
  ({ id, type: 'map', name: id, ...extra }) as WorldMap;

function shape(nodes: MapTreeNode[], depth = 0): string[] {
  return nodes.flatMap((n) => [
    `${'  '.repeat(depth)}${n.map.name}${n.inferred ? ' (inferred)' : ''}${n.brokenParent ? ' (broken)' : ''}`,
    ...shape(n.children, depth + 1),
  ]);
}

describe('buildMapTree orders by the standard groups', () => {
  it('world 1: a map of the world itself stands before a located map at the top, whatever their numbers', () => {
    const tree = buildMapTree(
      [map('A', { hierarchy: 5 }), map('M1', { parent_map: 'A', location: 'L', hierarchy: 1 }), map('M2', { location: 'L', hierarchy: 0 })],
      [{ id: 'L', name: 'Lowmarsh' }],
    );
    expect(shape(tree)).toEqual(['A', '  M1', 'M2']);
  });

  it('world 2: under a region map, its parent_map children come before a map placed there by location', () => {
    const tree = buildMapTree(
      [map('A', { location: 'P' }), map('M1', { parent_map: 'A', location: 'L', hierarchy: 1 }), map('M2', { location: 'L', hierarchy: 0 })],
      [{ id: 'P', name: 'Province' }, { id: 'L', parent_location: 'P', name: 'Lowmarsh' }],
    );
    expect(shape(tree)).toEqual(['A', '  M1', '  M2 (inferred)']);
  });

  it('world 3: the world\'s own map first, then each location\'s maps as a set, by the location\'s name', () => {
    const tree = buildMapTree(
      [map('W', { hierarchy: 2 }), map('M3', { location: 'L', hierarchy: 1 }), map('M4', { location: 'Q', hierarchy: 0 })],
      [{ id: 'L', name: 'Lowmarsh' }, { id: 'Q', name: 'Quarry' }],
    );
    expect(shape(tree)).toEqual(['W', 'M3', 'M4']);
  });

  it('two locations\' inferred maps under one node stay in their own sets, each by hierarchy', () => {
    const locations: LocationLike[] = [
      { id: 'R', name: 'Region' },
      { id: 'C', parent_location: 'R', name: 'Castle' },
      { id: 'T', parent_location: 'R', name: 'Tower' },
    ];
    const tree = buildMapTree(
      [
        map('Region map', { location: 'R' }),
        map('Castle 0', { location: 'C', hierarchy: 0 }),
        map('Tower 1', { location: 'T', hierarchy: 1 }),
        map('Castle 2', { location: 'C', hierarchy: 2 }),
      ],
      locations,
    );
    expect(shape(tree)).toEqual([
      'Region map',
      '  Castle 0 (inferred)',
      '  Castle 2 (inferred)',
      '  Tower 1 (inferred)',
    ]);
  });

  it('broken parents stand last at the top, one set per parent_map', () => {
    const tree = buildMapTree(
      [
        map('Z dangling', { parent_map: 'gone', hierarchy: 0 }),
        map('Own', { hierarchy: 9 }),
        map('Located', { location: 'L', hierarchy: 9 }),
      ],
      [{ id: 'L', name: 'Lowmarsh' }],
    );
    expect(shape(tree)).toEqual(['Own', 'Located', 'Z dangling (broken)']);
  });

  for (const size of [2, 3]) {
    it(`a location chain that loops (${size} places) keeps every map in the list exactly once`, () => {
      const ids = Array.from({ length: size }, (_, i) => `L${i}`);
      const locations: LocationLike[] = ids.map((l, i) => ({ id: l, parent_location: ids[(i + 1) % size], name: l }));
      const maps = ids.map((l, i) => map(`M${i}`, { location: l }));
      const seen = shape(buildMapTree(maps, locations)).map((s) => s.trim().replace(' (inferred)', ''));
      expect([...seen].sort()).toEqual(maps.map((m) => m.id).sort());
    });
  }

  it('a name that is not a string orders as none and throws nothing, in the order and in inference', () => {
    const tree = buildMapTree([map('b', { name: 5 as unknown as string }), map('a', { name: 'Alpha' })], []);
    expect(tree.map((n) => n.map.id)).toEqual(['b', 'a']);
    const inferred = buildMapTree(
      [map('A', { location: 'P', name: 5 as unknown as string }), map('B', { location: 'P', name: 6 as unknown as string }), map('C', { location: 'K' })],
      [{ id: 'P' }, { id: 'K', parent_location: 'P' }],
    );
    expect(inferred.map((n) => n.map.id)).toEqual(['A', 'B']);
    expect(inferred[0].children.map((n) => n.map.id)).toEqual(['C']);
  });

  it('two maps of one place tied on name: a map inside it infers under the same one whatever the input order', () => {
    const maps = [map('R1', { location: 'P', name: 'Region' }), map('R2', { location: 'P', name: 'Region' }), map('C', { location: 'K' })];
    const locs: LocationLike[] = [{ id: 'P' }, { id: 'K', parent_location: 'P' }];
    const forward = shape(buildMapTree(maps, locs));
    expect(shape(buildMapTree([...maps].reverse(), [...locs].reverse()))).toEqual(forward);
    expect(forward).toEqual(['Region', '  C (inferred)', 'Region']);
    expect(buildMapTree(maps, locs)[0].map.id).toBe('R1');
  });

  it('a hierarchy that is not a finite number reads 0; ties fall to name, then id by code point', () => {
    const tree = buildMapTree(
      [
        map('b', { hierarchy: Number.NaN as unknown as number }),
        map('a', { hierarchy: 1 }),
        map('same-2', { name: 'Same', hierarchy: 0 }),
        map('same-1', { name: 'Same', hierarchy: 0 }),
      ],
      [],
    );
    expect(tree.map((n) => n.map.id)).toEqual(['b', 'same-1', 'same-2', 'a']);
  });
});
