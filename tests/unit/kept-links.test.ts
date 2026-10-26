/**
 * Links to elements this key no longer sees (conv. 151).
 * keel, probed live: a guest's PATCH that leaves a hidden link out keeps it;
 * a guest's read of its own element leaves the hidden link out.
 */
import { describe, it, expect } from 'vitest';
import { withKeptLinks, withoutKeptLinks } from '../../src/sync/kept-links';

const ANA = '00000000-0000-4000-8000-00000000a0a1';
const BO = '00000000-0000-4000-8000-00000000b0b1';
const FERRY = '00000000-0000-4000-8000-00000000f0f1';
const kept = new Set([ANA, FERRY]);

describe('withoutKeptLinks: what goes out', () => {
  it('a multi link loses only the kept ids', () => {
    expect(withoutKeptLinks('event', { name: 'x', characters: [ANA, BO] }, kept)).toEqual({ name: 'x', characters: [BO] });
  });

  it('a single link to a kept element leaves the field out, never null (H4)', () => {
    const out = withoutKeptLinks('character', { name: 'Cy', location: FERRY }, kept);
    expect(out).toEqual({ name: 'Cy' });
    expect('location' in out).toBe(false);
  });

  it('a pin\'s element goes with its type, never half (H4)', () => {
    const out = withoutKeptLinks('pin', { name: 'p', map: BO, element_id: ANA, element_type: 'character', x: 1, y: 2 }, kept);
    expect(out).toEqual({ name: 'p', map: BO, x: 1, y: 2 });
  });

  it('nothing kept, or no kept id named: the same body back', () => {
    const body = { name: 'x', characters: [BO] };
    expect(withoutKeptLinks('event', body, new Set())).toBe(body);
    expect(withoutKeptLinks('event', body, kept)).toBe(body);
  });
});

describe('withKeptLinks: what the copy keeps from keel\'s redacted read', () => {
  it('a multi link gets its kept ids back', () => {
    expect(withKeptLinks('event', { characters: [BO] }, { characters: [ANA, BO] }, kept)).toEqual({ characters: [BO, ANA] });
  });

  it('a single link keel read as empty keeps the copy\'s kept id', () => {
    expect(withKeptLinks('character', { name: 'Cy', location: null }, { location: FERRY }, kept)).toEqual({ name: 'Cy', location: FERRY });
    expect(withKeptLinks('character', { name: 'Cy' }, { location: FERRY }, kept)).toEqual({ name: 'Cy', location: FERRY });
  });

  it('a single link keel names wins; an id not kept is never put back', () => {
    expect(withKeptLinks('character', { location: BO }, { location: FERRY }, kept)).toEqual({ location: BO });
    const remote = { characters: [] as string[] };
    expect(withKeptLinks('event', remote, { characters: [BO] }, kept)).toBe(remote);
  });
});
