/**
 * The Web's links (context-pane-graph.ts) read through the SDK's graph reader,
 * `worldGraph` (since 1.117.0): schema link fields typed to their target and the
 * declared extension links, never any id-shaped value in any key. The drawing
 * choices over it (proposed and hidden drawn, one line per pair, map space as
 * what it joins, the aids where the page shows them) are Atlas's and tested
 * here too. The ring for every element of real worlds equals the reader's.
 */

import { describe, it, expect } from 'vitest';
import { worldGraph } from '@onlyworlds/sdk';
import { buildReverseIndex, buildWebLinks, readerLinksOf, ringOneOf } from '../../src/tabs/right/context-pane-graph';
import type { Element } from '../../src/core/types';
import hyperion from '../../src/demo/hyperion-world.json';
import fluffington from '../fixtures/moppetopia-fluffington-web.json';

const ID = {
  self: '068e5012-d77c-799d-8000-000000000001',
  a: '068e5012-d77c-799d-8000-000000000002',
  b: '068e5012-d77c-799d-8000-000000000003',
  loc: '068e5012-d77c-799d-8000-000000000004',
  parent: '068e5012-d77c-799d-8000-000000000005',
  sp: '068e5012-d77c-799d-8000-000000000006',
};

const mk = (id: string, type: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type, name: `${type} ${id.slice(-2)}`, local_updated_at: '2026-01-01', ...extra }) as unknown as Element;

const outOf = (els: Element[], id: string): string[] => readerLinksOf(els).get(id) ?? [];

describe('the reader decides what is a link', () => {
  const loc = mk(ID.loc, 'location');
  const sp = mk(ID.sp, 'species');
  const a = mk(ID.a, 'character');

  it('reads a schema single link and a multi link typed to their target', () => {
    const subject = mk(ID.self, 'character', { birthplace: ID.loc, species: [ID.sp] });
    expect(outOf([subject, loc, sp], ID.self).sort()).toEqual([ID.loc, ID.sp].sort());
  });

  it('draws nothing for a link to an element of another type than its field names', () => {
    const subject = mk(ID.self, 'character', { birthplace: ID.a });
    expect(outOf([subject, a], ID.self)).toEqual([]);
  });

  it('draws nothing for an id in a key that is no link: Atlas’s own fields, an undeclared x_ key', () => {
    // The real worlds' cases (the census of 2026-11-01): a page's blocks, a dismissed suggestion, an import's reference.
    const subject = mk(ID.self, 'narrative', {
      atlas_page_refs: [ID.a], atlas_page_blocks: [{ kind: 'element', id: ID.a }],
      atlas_dismissed_suggestions: [ID.loc], x_azgaar_location_ref: ID.loc,
    });
    expect(outOf([subject, a, loc], ID.self)).toEqual([]);
  });

  it('5. leaves the writing tree undrawn: parent_narrative is the sidebar’s', () => {
    const chapter = mk(ID.parent, 'narrative');
    const loc = mk(ID.loc, 'location');
    const scene = mk(ID.self, 'narrative', { parent_narrative: ID.parent, locations: [ID.loc] });
    const links = buildWebLinks([scene, chapter, loc], ID.self);
    expect(ringOneOf(links, ID.self).cast).toEqual([ID.loc]);
    expect(ringOneOf(links, ID.parent)).toEqual({ cast: [], back: [] });
  });

  it('never links an element to itself, and names a target once across fields', () => {
    const subject = mk(ID.self, 'character', { friends: [ID.self, ID.a], rivals: [ID.a] });
    expect(outOf([subject, a], ID.self)).toEqual([ID.a]);
  });

  it('ignores plain text', () => {
    const subject = mk(ID.self, 'character', { description: 'a plain sentence, not an id' });
    expect(outOf([subject], ID.self)).toEqual([]);
  });

  it('remembers per elements array and reads a new array afresh', () => {
    const subject = mk(ID.self, 'character', { birthplace: ID.loc });
    const world = [subject, loc];
    expect(readerLinksOf(world)).toBe(readerLinksOf(world));
    const edited = [mk(ID.self, 'character', {}), loc];
    expect(outOf(edited, ID.self)).toEqual([]);
  });
});

describe('the drawing choices over the reader', () => {
  it('1. reads the links of proposed, hidden and room elements (drawn, marked by the paint)', () => {
    const loc = mk(ID.loc, 'location');
    const proposed = mk(ID.a, 'character', { birthplace: ID.loc, x_review_proposed: { by: 'someone' } });
    const hidden = mk(ID.b, 'character', { birthplace: ID.loc, hidden: true });
    const links = buildWebLinks([proposed, hidden, loc], ID.loc);
    expect(ringOneOf(links, ID.loc).back.sort()).toEqual([ID.a, ID.b].sort());
  });

  it('2. one line per pair: a link held at both ends is one neighbour each way', () => {
    const a = mk(ID.a, 'character', { friends: [ID.b] });
    const b = mk(ID.b, 'character', { friends: [ID.a] });
    const links = buildWebLinks([a, b], ID.a);
    expect(ringOneOf(links, ID.a)).toEqual({ cast: [ID.b], back: [] });
  });

  it('3. map space as what it joins: a pin joins its map to its element, in either spelling', () => {
    const map = mk(ID.parent, 'map');
    const loc = mk(ID.loc, 'location');
    const zone = mk(ID.sp, 'zone');
    const pin = mk(ID.a, 'pin', { map_id: ID.parent, element_id: ID.loc, element_type: 'location', x: 1, y: 1 });
    const marker = mk(ID.b, 'marker', { map: ID.parent, zone: ID.sp, x: 1, y: 1 });
    const links = buildWebLinks([map, loc, zone, pin, marker], ID.parent);
    expect(ringOneOf(links, ID.parent).cast.sort()).toEqual([ID.loc, ID.sp].sort());
    expect(links.markerCounts.get(`${ID.parent}|${ID.sp}`)).toBe(1);
    // The pin as the center keeps what it joins.
    const asCenter = buildWebLinks([map, loc, pin], ID.a);
    expect(ringOneOf(asCenter, ID.a).cast.sort()).toEqual([ID.loc, ID.parent].sort());
  });

  it('4. a marked reading aid’s links are read like any other (the reader alone keeps aids out)', () => {
    const domain = mk(ID.a, 'construct', { supertype: 'Domain', x_charter_of: 'mark' });
    const guide = mk(ID.self, 'construct', { supertype: 'Guide', x_charter_of: 'mark', constructs: [ID.a] });
    expect(outOf([guide, domain], ID.self)).toEqual([ID.a]);
  });
});

describe('buildReverseIndex', () => {
  it('is the exact mirror of the reader’s links', () => {
    const loc = mk(ID.loc, 'location');
    const a = mk(ID.a, 'character', { birthplace: ID.loc });
    const b = mk(ID.b, 'family', { estates: [ID.loc], ancestors: [ID.a] });
    const world = [loc, a, b];
    const reverse = buildReverseIndex(world);
    let count = 0;
    for (const [src, targets] of readerLinksOf(world)) for (const t of targets) { count++; expect(reverse.get(t)?.has(src)).toBe(true); }
    expect(count).toBe(3);
    expect(Array.from(reverse.get(ID.loc) ?? []).sort()).toEqual([ID.a, ID.b].sort());
  });
});

describe('the ring equals the reader on real worlds (map space and the writing tree aside)', () => {
  const worlds: Array<[string, Element[]]> = [
    ['Hyperion', (hyperion as unknown as { elements: Element[] }).elements],
    ['Moppetopia, Fluffington', fluffington as unknown as Element[]],
  ];
  for (const [name, els] of worlds) {
    it(name, () => {
      const g = worldGraph({ elements: els as unknown as object[] }, { rung: 'owner' }, { rooms: true, hidden: true, proposed: true, mapSpace: true });
      const spatial = new Set(els.filter(e => e.type === 'pin' || e.type === 'marker').map(e => e.id));
      const ref = new Map<string, Set<string>>();
      const put = (a: string, b: string): void => { (ref.get(a) ?? ref.set(a, new Set()).get(a)!).add(b); };
      for (const e of g.edges) {
        // Choice 5 aside: the writing tree is undrawn.
        if (e.source === e.target || e.field === 'parent_narrative' || spatial.has(e.source) || spatial.has(e.target)) continue;
        put(e.source, e.target); put(e.target, e.source);
      }
      const links = buildWebLinks(els, '');
      // What only map space joins: Atlas's own drawing (choice 3), taken out before comparing.
      const folded = new Set<string>();
      for (const e of els) {
        if (e.type !== 'pin' && e.type !== 'marker') continue;
        const r = e as unknown as Record<string, string>;
        const m = r.map_id ?? r.map; const o = e.type === 'pin' ? r.element_id : (r.zone_id ?? r.zone);
        folded.add(`${m}|${o}`); folded.add(`${o}|${m}`);
      }
      let compared = 0;
      for (const el of els) {
        if (spatial.has(el.id)) continue;
        const { cast, back } = ringOneOf(links, el.id);
        const ring = [...cast, ...back].filter(id => !folded.has(`${el.id}|${id}`) || ref.get(el.id)?.has(id)).sort();
        expect(ring, el.name).toEqual(Array.from(ref.get(el.id) ?? []).sort());
        compared++;
      }
      expect(compared).toBeGreaterThan(10);
    });
  }
});
