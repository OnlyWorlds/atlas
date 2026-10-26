import { describe, it, expect } from 'vitest';
import { buildAutolinkIndex } from '../../src/middle/writing-workspace-autolink';
import type { Element } from '../../src/core/types';

function mk(partial: Partial<Element> & { id: string; type: Element['type']; name: string }): Element {
  return {
    local_updated_at: '2026-05-20T00:00:00.000Z',
    ...partial,
  } as Element;
}

describe('buildAutolinkIndex', () => {
  it('returns an empty index for no elements', () => {
    const idx = buildAutolinkIndex([]);
    expect(idx.byName.size).toBe(0);
    expect(idx.scanner).toBeNull();
  });

  it('indexes element names CASE-INSENSITIVELY', () => {
    // Titus: prose that writes "the consul" should link to the
    // element named "Consul" without anyone registering a lowercase alias.
    // Keys are folded; the writer's own casing is restored at promotion time
    // from the matched text, never from the key.
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Drizzle' }),
    ]);
    expect(idx.byName.get('drizzle')).toBeTruthy();
    expect(idx.byName.get('drizzle')![0].displayName).toBe('Drizzle');
    // The folded key is the ONLY key — callers must fold before lookup.
    expect(idx.byName.get('Drizzle')).toBeUndefined();
  });

  it('skips names shorter than 3 chars', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Al' }),
      mk({ id: 'c2', type: 'character', name: 'Bo' }),
      mk({ id: 'c3', type: 'character', name: 'Cal' }),
    ]);
    expect(idx.byName.get('al')).toBeUndefined();
    expect(idx.byName.get('bo')).toBeUndefined();
    expect(idx.byName.get('cal')).toBeTruthy();
  });

  it('indexes atlas_aliases alongside name', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Lyra', atlas_aliases: ['Lady Vareth', 'the duchess'] }),
    ]);
    expect(idx.byName.get('lyra')).toBeTruthy();
    expect(idx.byName.get('lady vareth')).toBeTruthy();
    expect(idx.byName.get('the duchess')).toBeTruthy();
    expect(idx.byName.get('lyra')![0].displayName).toBe('Lyra');
  });

  it('marks ambiguous names with multiple candidates', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'John' }),
      mk({ id: 'c2', type: 'character', name: 'John' }),
    ]);
    expect(idx.byName.get('john')!.length).toBe(2);
  });

  it('excludes narrative, pin, marker, map types from the index', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'n1', type: 'narrative', name: 'Book One' }),
      mk({ id: 'p1', type: 'pin', name: 'Pin Alpha' }),
      mk({ id: 'm1', type: 'marker', name: 'Marker Alpha' }),
      mk({ id: 'mp1', type: 'map', name: 'World Map' }),
      mk({ id: 'c1', type: 'character', name: 'Drizzle' }),
    ]);
    expect(idx.byName.get('book one')).toBeUndefined();
    expect(idx.byName.get('pin alpha')).toBeUndefined();
    expect(idx.byName.get('marker alpha')).toBeUndefined();
    expect(idx.byName.get('world map')).toBeUndefined();
    expect(idx.byName.get('drizzle')).toBeTruthy();
  });

  it('compiles a scanner regex that matches indexed names with word boundaries', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Drizzle' }),
    ]);
    expect(idx.scanner).toBeTruthy();
    // Word boundary: matches "Drizzle" surrounded by spaces / punctuation, not inside "Drizzles".
    expect('the Drizzle ran'.match(idx.scanner!)).not.toBeNull();
    expect('drizzling'.match(idx.scanner!)).toBeNull();
    expect('Drizzles'.match(idx.scanner!)).toBeNull();
  });

  it('scanner sorts longer keys first so multi-word matches win greedily', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Mira' }),
      mk({ id: 'c2', type: 'character', name: 'Mira Halloway' }),
    ]);
    // First match scanning "Mira Halloway came" should be the longer key.
    // Scanner's own flags — restating 'g' would drop the case-insensitivity
    // the index now depends on.
    const re = new RegExp(idx.scanner!.source, idx.scanner!.flags);
    const m = re.exec('Mira Halloway came home');
    expect(m).not.toBeNull();
    expect(m![0]).toBe('Mira Halloway');
  });

  it('dedupes aliases that equal the canonical name', () => {
    const idx = buildAutolinkIndex([
      mk({ id: 'c1', type: 'character', name: 'Lyra', atlas_aliases: ['Lyra', 'Ly'] }),
    ]);
    // 'Lyra' should appear with one candidate (not two), 'Ly' filtered as < 3 chars.
    expect(idx.byName.get('lyra')!.length).toBe(1);
    expect(idx.byName.get('ly')).toBeUndefined();
  });
});
