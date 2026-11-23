import { describe, it, expect } from 'vitest';
import { buildAutolinkIndex } from '../../src/middle/writing-workspace-autolink';
import type { AutolinkIndex } from '../../src/middle/writing-workspace-autolink';
import { candidateIds } from '../../src/core/prose-autolink';
import type { Element } from '../../src/core/types';

function mk(partial: Partial<Element> & { id: string; type: Element['type']; name: string }): Element {
  return {
    local_updated_at: '2026-05-20T00:00:00.000Z',
    ...partial,
  } as Element;
}

/** What the index answers in a text: each found span as `text@start>id`. */
function found(idx: AutolinkIndex, text: string): string[] {
  return idx.find(text).map(f => `${text.slice(f.start, f.end)}@${f.start}>${f.candidate.id}`);
}

describe('buildAutolinkIndex', () => {
  it('returns an empty index for no elements', () => {
    const idx = buildAutolinkIndex([]);
    expect(idx.ids.size).toBe(0);
    expect(idx.find('Drizzle and anything else')).toEqual([]);
  });

  it('finds element names CASE-INSENSITIVELY', () => {
    // Titus: prose that writes "the consul" should link to the
    // element named "Consul" without anyone registering a lowercase alias.
    // The writer's own casing is the span found, never the name.
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Drizzle' }),
    ]);
    expect(found(idx, 'drizzle and DRIZZLE and Drizzle')).toEqual(['drizzle@0>c1', 'DRIZZLE@12>c1', 'Drizzle@24>c1']);
    expect(idx.find('the drizzle')[0].candidate.displayName).toBe('Drizzle');
  });

  it('skips names shorter than 3 chars', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Al' }),
      mk({ id: 'c2', type: 'character', name: 'Bo' }),
      mk({ id: 'c3', type: 'character', name: 'Cal' }),
    ]);
    expect(found(idx, 'Al, Bo and Cal.')).toEqual(['Cal@11>c3']);
    expect([...idx.ids]).toEqual(['c3']);
  });

  it('finds atlas_aliases alongside name', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Lyra', atlas_aliases: ['Lady Vareth', 'the duchess'] }),
    ]);
    expect(found(idx, 'Lyra, Lady Vareth, the duchess.')).toEqual(['Lyra@0>c1', 'Lady Vareth@6>c1', 'the duchess@19>c1']);
    expect(idx.find('Lady Vareth')[0].candidate.displayName).toBe('Lyra');
  });

  it('answers nothing for a name two elements share', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'John' }),
      mk({ id: 'c2', type: 'character', name: 'John' }),
    ]);
    expect(idx.find('John left.')).toEqual([]);
    // Both are still elements the index holds: an address naming either is named against them.
    expect([...idx.ids].sort()).toEqual(['c1', 'c2']);
  });

  it('excludes narrative, pin, marker, map types from the index', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'n1', type: 'narrative', name: 'Book One' }),
      mk({ id: 'p1', type: 'pin', name: 'Pin Alpha' }),
      mk({ id: 'm1', type: 'marker', name: 'Marker Alpha' }),
      mk({ id: 'mp1', type: 'map', name: 'World Map' }),
      mk({ id: 'c1', type: 'character', name: 'Drizzle' }),
    ]);
    expect(found(idx, 'Book One, Pin Alpha, Marker Alpha, World Map, Drizzle')).toEqual(['Drizzle@46>c1']);
    expect([...idx.ids]).toEqual(['c1']);
  });

  it('finds whole names only: "Drizzle" is not found inside "drizzling" or "Drizzles"', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Drizzle' }),
    ]);
    // Matches "Drizzle" surrounded by spaces / punctuation, not inside "Drizzles".
    expect(found(idx, 'the Drizzle ran')).toEqual(['Drizzle@4>c1']);
    expect(idx.find('drizzling')).toEqual([]);
    expect(idx.find('Drizzles')).toEqual([]);
  });

  it('the longer name wins where several start at one place', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Mira' }),
      mk({ id: 'c2', type: 'character', name: 'Mira Halloway' }),
    ]);
    expect(found(idx, 'Mira Halloway came home')).toEqual(['Mira Halloway@0>c2']);
  });

  it('dedupes aliases that equal the canonical name', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Lyra', atlas_aliases: ['Lyra', 'Ly'] }),
    ]);
    // 'Lyra' is one element's (never read as shared with itself), 'Ly' filtered as < 3 chars.
    expect(found(idx, 'Lyra and Ly.')).toEqual(['Lyra@0>c1']);
  });

  it('a name that is not a string is passed over, never thrown on; an element with no string id is not scanned', () => {
    const idx = buildAutolinkIndex([
      { id: 'c1', type: 'character', name: 5 } as unknown as Element,
      { id: 'c2', type: 'character', name: 'Kira', atlas_aliases: [7, 'the scout'] } as unknown as Element,
      { type: 'character', name: 'Nobody' } as unknown as Element,
      { id: '', type: 'character', name: 'Empty' } as unknown as Element,
    ]);
    expect(found(idx, 'Kira, the scout, Nobody, Empty.')).toEqual(['Kira@0>c2', 'the scout@6>c2']);
    expect([...idx.ids]).toEqual(['c2']);
  });

  it('a name is counted after the SDK\'s trim: padding neither makes it long enough nor too long', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: '  Al  ' }),
      mk({ id: 'c2', type: 'character', name: '　Iron Gate\u0085' }),
      mk({ id: 'c3', type: 'character', name: ` ${'K' + 'a'.repeat(199)}\t\t` }),
    ]);
    expect([...idx.ids]).toEqual(['c2', 'c3']);
    expect(found(idx, 'The Iron Gate.')).toEqual(['Iron Gate@4>c2']);
  });

  it('ids holds an element only for a name the finder keeps (3 to 200 code points)', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Al' }),
      mk({ id: 'c2', type: 'character', name: 'K' + 'a'.repeat(200) }),
      mk({ id: 'c3', type: 'character', name: 'K' + 'a'.repeat(199) }),
    ]);
    expect([...idx.ids]).toEqual(['c3']);
    // Held on the index, never rebuilt: it is asked on every keystroke.
    expect(candidateIds(idx)).toBe(idx.ids);
  });
});
