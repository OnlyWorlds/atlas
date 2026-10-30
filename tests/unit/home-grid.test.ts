/**
 * The home's grid, pure: arrival from the id or the stamp, holds under their
 * holder, wrapping, and the promise that being born moves nothing drawn before.
 */

import { describe, it, expect } from 'vitest';
import { arrivalOf, gridOf, type GridEdge, type GridNode } from '../../src/core/home-grid';

/** A UUIDv7 at a given millisecond, its random part from a counter (so ties are known). */
let seq = 0;
const v7 = (ms: number): string => {
  const hex = ms.toString(16).padStart(12, '0');
  const r = (++seq).toString(16).padStart(15, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${r.slice(0, 3)}-8${r.slice(3, 6)}-${r.slice(6, 15).padEnd(12, '0')}`;
};
const node = (id: string, type: string, created_at?: string): GridNode => ({ id, type, ...(created_at ? { created_at } : {}) });
const edge = (source: string, field: string, target: string, index = 0): GridEdge => ({ source, field, target, index });
const at = (g: ReturnType<typeof gridOf>, id: string) => {
  const c = g.cells.find(x => x.id === id)!;
  return { col: c.col, line: c.line, pos: c.pos, row: c.row, depth: c.depth };
};

describe('arrivalOf', () => {
  it('reads a UUIDv7 id\'s own milliseconds, whatever its created_at says (a pull rewrites the stamp, never the id)', () => {
    const id = v7(1_761_800_000_000);
    expect(arrivalOf(node(id, 'character', '2001-01-01T00:00:00Z'))).toBe(1_761_800_000_000);
  });
  it('reads the v1 server\'s draft ids (version 7, seconds first) as seconds, never as the year 2199', () => {
    // 36 bits of seconds, then 12 more bits, the version digit 7: the v1 server's shape (`06…` today).
    const secs = 1_750_000_000;
    const hex = secs.toString(16).padStart(9, '0') + 'abc';
    const v1 = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7123-8456-0123456789ab`;
    expect(v1.startsWith('06')).toBe(true);
    expect(arrivalOf(node(v1, 'character', '2001-01-01T00:00:00Z'))).toBe(secs * 1000);
    // A world of v1 elements, then one made in Atlas today: the new one is last, and moves none of them.
    const old = [0, 10, 20].map(k => {
      const h = (secs + k).toString(16).padStart(9, '0') + '000';
      return node(`${h.slice(0, 8)}-${h.slice(8, 12)}-7000-8000-00000000000${k / 10}`, 'character');
    });
    const before = gridOf(old, [], 4);
    const born = node(v7(Date.UTC(2026, 9, 30)), 'location');
    const after = gridOf([...old, born], [], 4);
    for (const n of old) expect(at(after, n.id)).toEqual(at(before, n.id));
    expect(at(after, born.id).col).toBe(3);
  });
  it('reads created_at as a time, across offsets and precisions, for any other id', () => {
    const a = arrivalOf(node('a', 'x', '2026-10-30T10:00:00.000Z'));
    const b = arrivalOf(node('b', 'x', '2026-10-30T11:00:00.000001+01:00'));
    expect(a).toBe(b);
  });
  it('an element with no stamp, or one that does not parse, arrives first', () => {
    expect(arrivalOf(node('a', 'x'))).toBe(-Infinity);
    expect(arrivalOf(node('a', 'x', 'yesterday'))).toBe(-Infinity);
  });
});

describe('gridOf: the walk (the design\'s fourth drawing)', () => {
  const mira = v7(1000), harbour = v7(2000), founding = v7(3000), story = v7(4000);
  it('an empty world has only the + square, at the first column', () => {
    const g = gridOf([], [], 4);
    expect(g.cells).toEqual([]);
    expect(g.plus).toEqual({ col: 0, line: 0, pos: 0 });
    expect(g.lineRows).toEqual([1]);
  });
  it('placed, Mira stands under The Harbour and her own column stays empty', () => {
    const g = gridOf([node(mira, 'character'), node(harbour, 'location')], [edge(mira, 'location', harbour)], 4);
    expect(at(g, harbour)).toEqual({ col: 1, line: 0, pos: 1, row: 0, depth: 0 });
    expect(at(g, mira)).toEqual({ col: 1, line: 0, pos: 1, row: 1, depth: 1 });
    expect(g.plus.col).toBe(2);
    expect(g.links).toEqual([]);
    expect(g.lineRows).toEqual([2]);
  });
  it('the whole walk: the story over its Event, and Mira\'s link to the Event a line', () => {
    const nodes = [node(mira, 'character'), node(harbour, 'location'), node(founding, 'event'), node(story, 'narrative')];
    const edges = [edge(mira, 'location', harbour), edge(founding, 'characters', mira), edge(story, 'events', founding)];
    const g = gridOf(nodes, edges, 4);
    expect(at(g, harbour)).toMatchObject({ col: 1, row: 0 });
    expect(at(g, mira)).toMatchObject({ col: 1, row: 1 });
    expect(at(g, story)).toMatchObject({ col: 3, row: 0 });
    expect(at(g, founding)).toMatchObject({ col: 3, row: 1 });
    expect(g.links).toEqual([{ source: founding, target: mira, field: 'characters' }]);
    // Four elements fill the line; the + wraps to the next.
    expect(g.plus).toEqual({ col: 4, line: 1, pos: 0 });
  });
});

describe('gridOf: the gate\'s cases', () => {
  it('a folder with no stamps sorts first, so a new element is last and moves none of them (G2)', () => {
    const old = ['d', 'b', 'c', 'a'].map(id => node(`00000000-0000-4000-8000-00000000000${id}`, 'character'));
    const before = gridOf(old, [], 4);
    const born = node(v7(Date.UTC(2026, 9, 30)), 'character');
    const after = gridOf([...old, born], [], 4);
    for (const n of old) expect(at(after, n.id)).toEqual(at(before, n.id));
    expect(at(after, born.id).col).toBe(4);
  });
  it('a holder that arrives listing an older Event takes it under it, the named exception (G3)', () => {
    const ev = v7(1000), tale = v7(2000);
    const g = gridOf([node(ev, 'event'), node(tale, 'narrative')], [edge(tale, 'events', ev)], 4);
    expect(at(g, ev)).toMatchObject({ col: 1, row: 1, depth: 1 });
  });
  it('a list holder\'s stack keeps the list\'s order, so a placing appends at the bottom (G4)', () => {
    const e1 = v7(1000), e2 = v7(2000), e3 = v7(3000), tale = v7(4000);
    const nodes = [node(e1, 'event'), node(e2, 'event'), node(e3, 'event'), node(tale, 'narrative')];
    const g = gridOf(nodes, [edge(tale, 'events', e2, 0), edge(tale, 'events', e3, 1), edge(tale, 'events', e1, 2)], 4);
    expect([e2, e3, e1].map(id => at(g, id).row)).toEqual([1, 2, 3]);
  });
  it('a Location\'s stack is by arrival: an older Character placed there inserts above the newer (G4, named)', () => {
    const mira = v7(1000), harbour = v7(2000), dan = v7(3000);
    const g = gridOf([node(mira, 'character'), node(harbour, 'location'), node(dan, 'character')],
      [edge(dan, 'location', harbour), edge(mira, 'location', harbour)], 4);
    expect(at(g, mira).row).toBe(1);
    expect(at(g, dan).row).toBe(2);
  });
  it('depth two: a Zone holds a Location that holds Mira, and a Creature in the Zone alone stands at depth one after them (G5)', () => {
    const bay = v7(1000), harbour = v7(2000), mira = v7(3000), rex = v7(4000);
    const g = gridOf(
      [node(bay, 'zone'), node(harbour, 'location'), node(mira, 'character'), node(rex, 'creature')],
      [edge(harbour, 'zone', bay), edge(mira, 'location', harbour), edge(rex, 'zone', bay)], 4);
    expect(at(g, harbour)).toMatchObject({ col: 0, row: 1, depth: 1 });
    expect(at(g, mira)).toMatchObject({ col: 0, row: 2, depth: 2 });
    expect(at(g, rex)).toMatchObject({ col: 0, row: 3, depth: 1 });
    expect(g.lineRows).toEqual([4, 1]);
  });
  it('a Creature with a Location and a Zone stands in the Location, the narrower place; the zone edge is a line', () => {
    const bay = v7(1000), harbour = v7(2000), rex = v7(3000);
    const g = gridOf([node(bay, 'zone'), node(harbour, 'location'), node(rex, 'creature')],
      [edge(rex, 'zone', bay), edge(rex, 'location', harbour)], 4);
    expect(g.cells.find(c => c.id === rex)!.holder).toBe(harbour);
    expect(g.links).toEqual([{ source: rex, target: bay, field: 'zone' }]);
  });
  it('an Event in two stories stands under the earliest; the other is a line', () => {
    const ev = v7(1000), t1 = v7(2000), t2 = v7(3000);
    const g = gridOf([node(ev, 'event'), node(t1, 'narrative'), node(t2, 'narrative')],
      [edge(t2, 'events', ev), edge(t1, 'events', ev)], 4);
    expect(g.cells.find(c => c.id === ev)!.holder).toBe(t1);
    expect(g.links).toEqual([{ source: t2, target: ev, field: 'events' }]);
  });
  it('a link to an element not in the picture holds nothing', () => {
    const mira = v7(1000);
    const g = gridOf([node(mira, 'character')], [edge(mira, 'location', 'gone')], 4);
    expect(at(g, mira)).toMatchObject({ col: 0, row: 0, depth: 0 });
  });
  it('wraps columns onto lines; a line is as tall as its deepest stack', () => {
    const ids = [1, 2, 3, 4, 5, 6].map(i => v7(i * 1000));
    const nodes = ids.map((id, i) => node(id, i === 5 ? 'location' : 'character'));
    const g = gridOf(nodes, [edge(ids[0], 'location', ids[5]), edge(ids[1], 'location', ids[5])], 4);
    expect(at(g, ids[5])).toMatchObject({ line: 1, pos: 1, row: 0 });
    expect(at(g, ids[1])).toMatchObject({ line: 1, pos: 1, row: 2 });
    expect(g.lineRows).toEqual([1, 3]);
  });
});

describe('gridOf: being born moves nothing drawn before (P2), random worlds', () => {
  const TYPES = ['character', 'location', 'event', 'narrative', 'zone', 'creature', 'object'];
  // Fields the new element may carry itself: none makes it a holder of an older one (that is G3's named exception).
  const OWN: Record<string, [string, string][]> = {
    character: [['location', 'location'], ['friends', 'character']],
    creature: [['location', 'location'], ['zone', 'zone']],
    object: [['location', 'location']],
    location: [['zone', 'zone']],
    event: [['characters', 'character'], ['locations', 'location']],
    narrative: [['characters', 'character']],
    zone: [],
  };
  let seed = 7;
  const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  it('for 300 worlds, a new element and its own links leave every earlier square where it was', () => {
    for (let w = 0; w < 300; w++) {
      const nodes: GridNode[] = [];
      const edges: GridEdge[] = [];
      const count = 1 + rnd(20);
      for (let i = 0; i < count; i++) nodes.push(node(v7(1000 * (i + 1)), TYPES[rnd(TYPES.length)]));
      for (let i = 0; i < count * 2; i++) {
        const s = nodes[rnd(count)];
        const own = OWN[s.type];
        if (s.type === 'narrative' && rnd(2)) {
          const ev = nodes.filter(n => n.type === 'event');
          if (ev.length) edges.push(edge(s.id, 'events', ev[rnd(ev.length)].id, i));
          continue;
        }
        if (!own.length) continue;
        const [field, t] = own[rnd(own.length)];
        const targets = nodes.filter(n => n.type === t && n.id !== s.id);
        if (targets.length) edges.push(edge(s.id, field, targets[rnd(targets.length)].id, i));
      }
      const per = 1 + rnd(6);
      const before = gridOf(nodes, edges, per);
      const born = node(v7(1000 * (count + 1)), TYPES[rnd(TYPES.length)]);
      const bornEdges = [...edges];
      for (const [field, t] of OWN[born.type]) {
        const targets = nodes.filter(n => n.type === t);
        if (targets.length && rnd(2)) bornEdges.push(edge(born.id, field, targets[rnd(targets.length)].id));
      }
      const after = gridOf([...nodes, born], bornEdges, per);
      for (const n of nodes) expect(at(after, n.id), `world ${w}`).toEqual(at(before, n.id));
    }
  });
});
