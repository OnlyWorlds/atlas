/**
 * buildMapTree — unit tests against World A/B/C fixtures (DESIGN_MAPS.md §6).
 *
 * Asserts structural correctness of the tree-building algorithm:
 *   - Explicit parent_map edges (World A)
 *   - Location-inferred placement with parent-chain hopping (World B)
 *   - Mixed: override, orphan, dangling, multi-sibling (World C)
 *   - Cycle defense
 *   - Sort stability
 */

import { describe, it, expect } from 'vitest';
import { buildMapTree, filterTreeByName, type MapTreeNode } from '../../src/tabs/right/map-tree';
import { WORLD_A } from '../fixtures/map-worlds/world-a';
import { WORLD_B } from '../fixtures/map-worlds/world-b';
import { WORLD_C } from '../fixtures/map-worlds/world-c';
import { mkMap, mkLocation } from '../fixtures/map-worlds/shared';

/** Helper: flatten the tree into a name-indented list for readable assertions. */
function shape(nodes: readonly MapTreeNode[], depth = 0): string {
  const out: string[] = [];
  for (const n of nodes) {
    const flags: string[] = [];
    if (n.brokenParent) flags.push('!broken');
    if (n.inferred) flags.push('@inferred');
    const suffix = flags.length ? ` [${flags.join(',')}]` : '';
    out.push(`${'  '.repeat(depth)}${n.map.name}${suffix}`);
    out.push(shape(n.children, depth + 1));
  }
  return out.filter(s => s.length > 0).join('\n');
}

describe('buildMapTree — World A (pure parent_map nesting)', () => {
  const tree = buildMapTree(WORLD_A.maps, WORLD_A.locations);

  it('has exactly one root: Multiverse', () => {
    expect(tree).toHaveLength(1);
    expect(tree[0].map.name).toBe('Multiverse');
  });

  it('Multiverse has two universes sorted by hierarchy (Alpha=0, Beta=1)', () => {
    const universes = tree[0].children;
    expect(universes.map(n => n.map.name)).toEqual(['Universe Alpha', 'Universe Beta']);
  });

  it('Universe Alpha has continents sorted by hierarchy (Aurora=0, Borealis=1)', () => {
    const continents = tree[0].children[0].children;
    expect(continents.map(n => n.map.name)).toEqual(['Continent Aurora', 'Continent Borealis']);
  });

  it('Aurora contains Eldoria + Twin City; Eldoria contains Castle Interior', () => {
    const aurora = tree[0].children[0].children[0];
    expect(aurora.children.map(n => n.map.name)).toEqual(['Eldoria City', 'Twin City']);
    expect(aurora.children[0].children.map(n => n.map.name)).toEqual(['Castle Interior']);
  });

  it('no nodes flagged as inferred or broken (pure parent_map path)', () => {
    function flagged(nodes: readonly MapTreeNode[]): MapTreeNode[] {
      const out: MapTreeNode[] = [];
      for (const n of nodes) {
        if (n.brokenParent || n.inferred) out.push(n);
        out.push(...flagged(n.children));
      }
      return out;
    }
    expect(flagged(tree)).toEqual([]);
  });

  it('full shape snapshot', () => {
    expect(shape(tree)).toBe(
      [
        'Multiverse',
        '  Universe Alpha',
        '    Continent Aurora',
        '      Eldoria City',
        '        Castle Interior',
        '      Twin City',
        '    Continent Borealis',
        '  Universe Beta',
        '    Continent Caelum',
      ].join('\n'),
    );
  });
});

describe('buildMapTree — World B (pure location-based)', () => {
  const tree = buildMapTree(WORLD_B.maps, WORLD_B.locations);

  it('has exactly one root: Region Overview', () => {
    expect(tree).toHaveLength(1);
    expect(tree[0].map.name).toBe('Region Overview');
  });

  it('City Map is inferred under Region Overview', () => {
    const city = tree[0].children.find(n => n.map.name === 'City Map');
    expect(city).toBeDefined();
    expect(city!.inferred).toBe(true);
  });

  it('Tavern Interior is inferred under City Map (skipping intermediate locations)', () => {
    const city = tree[0].children.find(n => n.map.name === 'City Map')!;
    const tavern = city.children.find(n => n.map.name === 'Tavern Interior');
    expect(tavern).toBeDefined();
    expect(tavern!.inferred).toBe(true);
  });

  it('Castle Map is inferred under City Map', () => {
    const city = tree[0].children.find(n => n.map.name === 'City Map')!;
    const castle = city.children.find(n => n.map.name === 'Castle Map');
    expect(castle).toBeDefined();
    expect(castle!.inferred).toBe(true);
  });

  it('full shape snapshot', () => {
    expect(shape(tree)).toBe(
      [
        'Region Overview',
        '  City Map [@inferred]',
        '    Castle Map [@inferred]',
        '    Tavern Interior [@inferred]',
      ].join('\n'),
    );
  });
});

describe('buildMapTree — World C (messy mix)', () => {
  const tree = buildMapTree(WORLD_C.maps, WORLD_C.locations);

  it('has four roots', () => {
    expect(tree).toHaveLength(4);
  });

  it('roots are alpha-sorted at same hierarchy', () => {
    expect(tree.map(n => n.map.name)).toEqual([
      'Broken Child',
      'Eldoria City',
      'Orphan Map',
      'World Overview',
    ]);
  });

  it('Broken Child is flagged as brokenParent', () => {
    const broken = tree.find(n => n.map.name === 'Broken Child');
    expect(broken?.brokenParent).toBe(true);
    expect(broken?.children).toEqual([]);
  });

  it('Eldoria City surfaces at root (Aurora has no map) and has 4 children', () => {
    const eldoria = tree.find(n => n.map.name === 'Eldoria City')!;
    expect(eldoria.children).toHaveLength(4);
  });

  it('Castle Floor 1/2 + Throne Room are inferred under Eldoria City, sorted by hierarchy', () => {
    const eldoria = tree.find(n => n.map.name === 'Eldoria City')!;
    const castleFloor1 = eldoria.children.find(n => n.map.name === 'Castle Floor 1')!;
    const castleFloor2 = eldoria.children.find(n => n.map.name === 'Castle Floor 2')!;
    const throne = eldoria.children.find(n => n.map.name === 'Throne Room')!;
    expect(castleFloor1.inferred).toBe(true);
    expect(castleFloor2.inferred).toBe(true);
    expect(throne.inferred).toBe(true);
    // Sort order: hierarchy 0, 1, 2 within Castle siblings.
    const castleSiblings = eldoria.children.filter(n => n.map.location === 'c-loc-castle');
    expect(castleSiblings.map(n => n.map.name)).toEqual([
      'Castle Floor 1',
      'Castle Floor 2',
      'Throne Room',
    ]);
  });

  it('Free-floating Tavern is under Eldoria City via explicit parent_map (not inferred)', () => {
    const eldoria = tree.find(n => n.map.name === 'Eldoria City')!;
    const floating = eldoria.children.find(n => n.map.name === 'Free-floating Tavern');
    expect(floating).toBeDefined();
    expect(floating!.inferred).toBeFalsy();
  });

  it('Orphan Map stays at root (its location chain has no ancestor maps)', () => {
    const orphan = tree.find(n => n.map.name === 'Orphan Map');
    expect(orphan).toBeDefined();
    expect(orphan!.inferred).toBeFalsy();
    expect(orphan!.brokenParent).toBeFalsy();
  });

  it('full shape snapshot', () => {
    // Sibling sort under Eldoria City: hierarchy primary, alpha secondary.
    //   h=0: Castle Floor 1, Free-floating Tavern   (alpha-tied)
    //   h=1: Castle Floor 2
    //   h=2: Throne Room
    expect(shape(tree)).toBe(
      [
        'Broken Child [!broken]',
        'Eldoria City',
        '  Castle Floor 1 [@inferred]',
        '  Free-floating Tavern',
        '  Castle Floor 2 [@inferred]',
        '  Throne Room [@inferred]',
        'Orphan Map',
        'World Overview',
      ].join('\n'),
    );
  });
});

describe('buildMapTree — defensive behavior', () => {
  it('handles empty inputs', () => {
    expect(buildMapTree([], [])).toEqual([]);
  });

  it('cycle defense — A.parent_map=B, B.parent_map=A: both surface as broken roots', () => {
    const maps = [
      mkMap({ id: 'cyc-A', name: 'A', parent_map: 'cyc-B' }),
      mkMap({ id: 'cyc-B', name: 'B', parent_map: 'cyc-A' }),
    ];
    const tree = buildMapTree(maps, []);
    expect(tree).toHaveLength(2);
    for (const n of tree) expect(n.brokenParent).toBe(true);
  });

  it('self-referential parent_map is rejected', () => {
    const maps = [mkMap({ id: 'self', name: 'Self', parent_map: 'self' })];
    const tree = buildMapTree(maps, []);
    expect(tree).toHaveLength(1);
    expect(tree[0].brokenParent).toBe(true);
  });

  it('hierarchy ties break alphabetically', () => {
    const maps = [
      mkMap({ id: 'p', name: 'Parent' }),
      mkMap({ id: 'z', name: 'Zebra', parent_map: 'p', hierarchy: 0 }),
      mkMap({ id: 'a', name: 'Apple', parent_map: 'p', hierarchy: 0 }),
      mkMap({ id: 'm', name: 'Monkey', parent_map: 'p', hierarchy: 0 }),
    ];
    const tree = buildMapTree(maps, []);
    expect(tree[0].children.map(n => n.map.name)).toEqual(['Apple', 'Monkey', 'Zebra']);
  });

  it('hierarchy primary, alpha secondary', () => {
    const maps = [
      mkMap({ id: 'p', name: 'Parent' }),
      mkMap({ id: 'h1-zebra', name: 'Zebra', parent_map: 'p', hierarchy: 1 }),
      mkMap({ id: 'h0-monkey', name: 'Monkey', parent_map: 'p', hierarchy: 0 }),
      mkMap({ id: 'h0-apple', name: 'Apple', parent_map: 'p', hierarchy: 0 }),
    ];
    const tree = buildMapTree(maps, []);
    expect(tree[0].children.map(n => n.map.name)).toEqual(['Apple', 'Monkey', 'Zebra']);
  });

  it('undefined hierarchy treated as 0', () => {
    const maps = [
      mkMap({ id: 'p', name: 'Parent' }),
      mkMap({ id: 'h-explicit', name: 'B', parent_map: 'p', hierarchy: 0 }),
      mkMap({ id: 'h-undef', name: 'A', parent_map: 'p' /* no hierarchy */ }),
    ];
    const tree = buildMapTree(maps, []);
    expect(tree[0].children.map(n => n.map.name)).toEqual(['A', 'B']);
  });

  it('multi-map ancestor location: child loc-bound map infers under the first non-parented sibling', () => {
    // Two maps share a location; one has its own parent_map, one doesn't.
    // A new loc-bound map at a child location should prefer the un-parented
    // ancestor map for its inferred placement (cleaner tree placement).
    const locations = [
      mkLocation({ id: 'L-root', name: 'Root' }),
      mkLocation({ id: 'L-child', name: 'Child', parent_location: 'L-root' }),
    ];
    const maps = [
      mkMap({ id: 'm-root-A', name: 'RootMap A', location: 'L-root' }),
      mkMap({ id: 'm-root-B', name: 'RootMap B', location: 'L-root', parent_map: 'm-root-A' }),
      mkMap({ id: 'm-child', name: 'ChildMap', location: 'L-child' }),
    ];
    const tree = buildMapTree(maps, locations);
    // Root is RootMap A. ChildMap should be its child via inference.
    expect(tree).toHaveLength(1);
    expect(tree[0].map.name).toBe('RootMap A');
    // Children of RootMap A: RootMap B (explicit parent_map) + ChildMap (inferred).
    expect(tree[0].children.map(n => n.map.name).sort()).toEqual(['ChildMap', 'RootMap B']);
    const childMap = tree[0].children.find(n => n.map.name === 'ChildMap')!;
    expect(childMap.inferred).toBe(true);
  });

  it('is deterministic — same inputs produce equal outputs across calls', () => {
    const a = buildMapTree(WORLD_C.maps, WORLD_C.locations);
    const b = buildMapTree(WORLD_C.maps, WORLD_C.locations);
    expect(shape(a)).toEqual(shape(b));
  });
});

describe('filterTreeByName', () => {
  it('returns all nodes when the term is empty', () => {
    const tree = buildMapTree(WORLD_A.maps, []);
    expect(shape(filterTreeByName(tree, ''))).toEqual(shape(tree));
  });

  it('keeps the matching node and its ancestry intact', () => {
    const tree = buildMapTree(WORLD_A.maps, []);
    const filtered = filterTreeByName(tree, 'Castle Interior');
    // World A: Multiverse > Universe Alpha > Continent Aurora > Eldoria City > Castle Interior
    // Filter should preserve that ancestry as a single chain.
    expect(shape(filtered)).toContain('Castle Interior');
    expect(shape(filtered)).toContain('Eldoria City');
    expect(shape(filtered)).toContain('Continent Aurora');
    expect(shape(filtered)).toContain('Universe Alpha');
    expect(shape(filtered)).toContain('Multiverse');
    // Sibling branches (Universe Beta, Twin City, Continent Borealis) should drop.
    expect(shape(filtered)).not.toContain('Universe Beta');
    expect(shape(filtered)).not.toContain('Twin City');
    expect(shape(filtered)).not.toContain('Continent Borealis');
  });

  it('is case-insensitive', () => {
    const tree = buildMapTree(WORLD_A.maps, []);
    const lower = filterTreeByName(tree, 'castle');
    const upper = filterTreeByName(tree, 'CASTLE');
    expect(shape(lower)).toEqual(shape(upper));
  });

  it('returns an empty array when nothing matches', () => {
    const tree = buildMapTree(WORLD_A.maps, []);
    expect(filterTreeByName(tree, 'definitely-not-a-map-zzz')).toEqual([]);
  });

  it('matches substring, not just prefix', () => {
    const tree = buildMapTree(WORLD_A.maps, []);
    // 'interior' is in the middle of 'Castle Interior' — must still match.
    const filtered = filterTreeByName(tree, 'interior');
    expect(shape(filtered)).toContain('Castle Interior');
  });

  it('does not mutate the input tree', () => {
    const tree = buildMapTree(WORLD_A.maps, []);
    const before = shape(tree);
    filterTreeByName(tree, 'castle');
    expect(shape(tree)).toEqual(before);
  });
});
