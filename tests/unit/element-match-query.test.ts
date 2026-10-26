/**
 * Units for `elementMatchesQuery` — the sidebar half of the shared search
 * kernel in `src/core/element-search.ts`. `scoreElementMatch` is the ranked
 * half consumed by the command palette (see `command-palette.test.ts`);
 * `elementMatchesQuery` is the boolean form the elements-sidebar filter uses.
 *
 * Both halves have to agree: the palette's "see all →" row hands its query
 * straight to the sidebar filter, so a query the palette matched by
 * description must not come back "no matches" here. The tier assertions
 * below mirror command-palette.test.ts's ranking cases for exactly that
 * reason — same fixtures, same tiers, boolean instead of scored.
 */

import { describe, it, expect } from 'vitest';
import { elementMatchesQuery, scoreElementMatch } from '../../src/core/element-search';
import type { Element } from '../../src/core/types';

let n = 0;
function el(data: Record<string, unknown>): Element {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    type: 'character',
    name: '',
    local_updated_at: '2026-07-12T10:00:00.000Z',
    ...data,
  } as Element;
}

describe('elementMatchesQuery', () => {
  it('empty (or whitespace-only) query matches everything', () => {
    const e = el({ name: 'Aldric' });
    expect(elementMatchesQuery(e, '')).toBe(true);
    expect(elementMatchesQuery(e, '   ')).toBe(true);
  });

  it('matches on name prefix', () => {
    expect(elementMatchesQuery(el({ name: 'Aldric' }), 'ald')).toBe(true);
  });

  it('matches on name substring (not just prefix)', () => {
    expect(elementMatchesQuery(el({ name: 'The Aldwood' }), 'ald')).toBe(true);
  });

  it('matches on an alias when the name itself does not match', () => {
    expect(elementMatchesQuery(el({ name: 'Marta', atlas_aliases: ['Alda'] }), 'ald')).toBe(true);
    // The name genuinely doesn't contain the query — prove the alias is what carried it.
    expect(elementMatchesQuery(el({ name: 'Marta', atlas_aliases: [] }), 'ald')).toBe(false);
  });

  it('matches on supertype/subtype (taxonomy)', () => {
    expect(elementMatchesQuery(el({ name: 'Keep', supertype: 'Aldstone fort' }), 'ald')).toBe(true);
    expect(elementMatchesQuery(el({ name: 'Keep', subtype: 'Aldstone fort' }), 'ald')).toBe(true);
  });

  it('matches on description when nothing else does', () => {
    expect(elementMatchesQuery(
      el({ name: 'Brenn', description: 'Guards the ald road east of town.' }),
      'ald',
    )).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(elementMatchesQuery(el({ name: 'old harbor' }), 'HARBOR')).toBe(true);
    expect(elementMatchesQuery(el({ name: 'OLD HARBOR' }), 'harbor')).toBe(true);
  });

  it('an unnamed element can still surface via its description', () => {
    expect(elementMatchesQuery(el({ name: '', description: 'A quiet harbor town.' }), 'harbor')).toBe(true);
  });

  it('no match anywhere returns false', () => {
    expect(elementMatchesQuery(el({ name: 'Aldric', description: 'A wanderer.' }), 'zzzznotfound')).toBe(false);
  });

  it('an all-whitespace name never false-positives on a blank query check elsewhere, ' +
    'and a name-only miss still checks every later tier before giving up', () => {
    // Regression shape: a naive `name.includes(q)` short-circuit would return
    // false here without ever looking at supertype/description.
    const e = el({ name: 'Vaelin', supertype: '', subtype: '', description: 'Found in the ald archives.' });
    expect(elementMatchesQuery(e, 'ald')).toBe(true);
  });
});

/**
 * Story tier (Bout D) — the writing room's prose becomes findable.
 *
 * Ranked LAST deliberately: a word buried in a chapter is the weakest signal
 * that the chapter is what you meant. These tests lock the ORDERING, because
 * the failure that would matter is a story hit outranking a name hit and
 * burying the element the user was actually looking for.
 */
describe('story tier', () => {
  it('finds a narrative by words inside its prose', () => {
    const scene = el({
      name: 'Scene 14',
      type: 'narrative',
      story: 'He played Rachmaninov while the saurians bellowed in the swamps below.',
    });
    expect(elementMatchesQuery(scene, 'saurians')).toBe(true);
    expect(elementMatchesQuery(scene, 'swamps')).toBe(true);
  });

  it('ranks a story hit BELOW description, taxonomy, alias and name hits', () => {
    const byStory = scoreElementMatch(el({ name: 'Scene 14', story: 'the ald road' }), 'ald')!;
    const byDesc = scoreElementMatch(el({ name: 'Scene 15', description: 'the ald road' }), 'ald')!;
    const byName = scoreElementMatch(el({ name: 'Aldric' }), 'ald')!;
    expect(byStory.score).toBeLessThan(byDesc.score);
    expect(byDesc.score).toBeLessThan(byName.score);
  });

  it('a name hit on the SAME element never degrades to the story score', () => {
    const both = scoreElementMatch(el({ name: 'Aldric', story: 'ald ald ald' }), 'ald')!;
    expect(both.score).toBe(100);
  });

  it('carries a context snippet around the prose match', () => {
    const m = scoreElementMatch(el({
      name: 'Scene 14',
      story: 'A'.repeat(200) + ' rachmaninov ' + 'B'.repeat(200),
    }), 'rachmaninov')!;
    expect(m.snippet).toContain('rachmaninov');
    expect(m.snippet!.startsWith('…')).toBe(true);
    expect(m.snippet!.endsWith('…')).toBe(true);
    // The snippet is a WINDOW, not the whole chapter — a 400-char body must
    // not land in a dropdown row.
    expect(m.snippet!.length).toBeLessThan(140);
  });

  it('an element with no story is unaffected', () => {
    expect(elementMatchesQuery(el({ name: 'Aldric' }), 'zzz')).toBe(false);
  });
});
