/**
 * Unlinked mentions — the count behind the context pane's
 * "Mentioned, unlinked (N in M scenes) · Link all" line and the create
 * modal's nudge. The count and the link share one span source (the
 * element's own name finder, as the hints read names) and one markdown
 * rule, so the number shown is the number written on the story.
 */

import { describe, it, expect } from 'vitest';
import {
  findUnlinkedMentions, mentionTermsFor, mentionsPhrase, createdToastText,
} from '../../src/core/unlinked-mentions';
import { buildTermScanner, elementSpans, linkSpansMarkdown, MENTIONS_MARKDOWN } from '../../src/core/prose-autolink';
import type { Element } from '../../src/core/types';

function el(id: string, type: string, name: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name, ...extra } as unknown as Element;
}

const chief = el('c1', 'character', 'Orc Chief', { atlas_aliases: ['orc', 'ab', ' the chief '] });
const WORLD: Element[] = [
  chief,
  el('n1', 'narrative', 'Scene A', { story: 'The orc marched. The Orc Chief watched the orcs.' }),
  el('n2', 'narrative', 'Scene B', { story: `An [orc](ow://character/c1) already linked, and the chief too.` }),
  el('n3', 'narrative', 'Scene C', { story: 'No mention here.' }),
  el('n4', 'narrative', 'Scene D', { story: '' }),
  el('l1', 'location', 'Orcgrove', { description: 'orc orc orc' }),
];

describe('mentionTermsFor', () => {
  it('is name ∪ aliases, trimmed, deduplicated case-insensitively, min length applied', () => {
    expect(mentionTermsFor(chief)).toEqual(['Orc Chief', 'orc', 'the chief']);
    expect(mentionTermsFor(el('x', 'character', 'Orc', { atlas_aliases: ['ORC', 'orc'] }))).toEqual(['Orc']);
  });
});

describe('findUnlinkedMentions', () => {
  it('counts whole-word, case-insensitive matches of any term outside existing links, per narrative', () => {
    const m = findUnlinkedMentions(chief, WORLD);
    // Scene A: "orc" + "Orc Chief" (longest wins; not double-counted as "orc") = 2; "orcs" skipped.
    // Scene B: the chip is protected; "the chief" = 1.
    expect(m.total).toBe(3);
    expect(m.narratives).toEqual([
      { id: 'n1', name: 'Scene A', count: 2 },
      { id: 'n2', name: 'Scene B', count: 1 },
    ]);
    expect(m.terms).toEqual(['Orc Chief', 'orc', 'the chief']);
  });

  it('never scans descriptions, only narrative prose; never counts the element itself', () => {
    const grove = el('l1', 'location', 'Orcgrove');
    expect(findUnlinkedMentions(grove, WORLD).total).toBe(0);
  });

  it('returns empty for types the autolink index never links', () => {
    const n = el('n9', 'narrative', 'Scene A');
    expect(findUnlinkedMentions(n, WORLD).total).toBe(0);
  });

  it('is cached per elements-array reference and recomputes on a new array', () => {
    const a = findUnlinkedMentions(chief, WORLD);
    expect(findUnlinkedMentions(chief, WORLD)).toBe(a);
    const next = [...WORLD];
    expect(findUnlinkedMentions(chief, next)).not.toBe(a);
    expect(findUnlinkedMentions(chief, next)).toEqual(a);
  });

  it('agrees with the link it offers: linking every listed narrative by the same spans writes exactly total chips', () => {
    for (const subject of [chief, eowyn]) {
      const m = findUnlinkedMentions(subject, NAMES_WORLD);
      expect(m.total).toBeGreaterThan(0);
      let written = 0;
      for (const n of m.narratives) {
        const story = NAMES_WORLD.find(e => e.id === n.id)!.story as string;
        written += linkSpansMarkdown(story, elementSpans(subject)!, { id: subject.id, type: subject.type }, MENTIONS_MARKDOWN).linked;
      }
      expect(written).toBe(m.total);
    }
  });
});

// Names as the hints read them (the SDK's nameFinder: a word edge in every script, folded case).
const eowyn = el('c2', 'character', 'Éowyn');
const ana = el('c3', 'character', 'Ana');
const NAMES_WORLD: Element[] = [
  ...WORLD,
  eowyn, ana,
  el('n5', 'narrative', 'Scene E', { story: 'Éowyn rode. They waited for ÉOWYN, and Anaïs too.' }),
];

describe('findUnlinkedMentions reads names as the hints do', () => {
  it('counts a name with an accent at its edge, in any case', () => {
    const m = findUnlinkedMentions(eowyn, NAMES_WORLD);
    expect(m.total).toBe(2);
    expect(m.narratives).toEqual([{ id: 'n5', name: 'Scene E', count: 2 }]);
  });

  it('never counts a name inside a longer word in another script', () => {
    expect(findUnlinkedMentions(ana, NAMES_WORLD).total).toBe(0);
  });

  it('passes over a name a markdown label cannot hold, in the count and in the write', () => {
    for (const [name, story] of [
      ['Kira [the elder]', 'Then Kira [the elder] came.'], ['[Old] Kira', 'Then [Old] Kira came.'],
      ['Kira\\', 'Then Kira\\ came.'], ['Ki]ra', 'Then Ki]ra came.'], ['Kira', 'Then wow!Kira came.'],
    ]) {
      const subject = el('u1', 'character', name);
      const world: Element[] = [subject, el('u2', 'narrative', 'Scene U', { story })];
      expect(findUnlinkedMentions(subject, world).total).toBe(0);
      const out = linkSpansMarkdown(story, elementSpans(subject)!, { id: 'u1', type: 'character' }, MENTIONS_MARKDOWN);
      expect(out).toEqual({ story, linked: 0 });
    }
  });

  it('has no spans for an element with no id or no name of three code points, and throws nothing', () => {
    expect(elementSpans(el('', 'character', 'Éowyn'))).toBeNull();
    expect(elementSpans(el('z1', 'character', 'Bo'))).toBeNull();
    expect(findUnlinkedMentions(el('z1', 'character', 'Bo'), NAMES_WORLD).total).toBe(0);
  });
});

describe('buildTermScanner with several terms', () => {
  it('alternates longest-first and honours whole-word', () => {
    const re = buildTermScanner(['orc', 'Orc Chief'], { wholeWord: true })!;
    expect('the Orc Chief and the orc and orcs'.match(re)).toEqual(['Orc Chief', 'orc']);
    expect(buildTermScanner([])).toBeNull();
    expect(buildTermScanner([''])).toBeNull();
  });
});

describe('phrasing', () => {
  it('reads as the pane and the toast say it', () => {
    const m = findUnlinkedMentions(chief, WORLD);
    expect(mentionsPhrase(m, 'scene')).toBe('3 in 2 scenes');
    expect(mentionsPhrase({ total: 1, narratives: [{ id: 'x', name: 'x', count: 1 }], terms: [] }, 'chapter')).toBe('1 in 1 chapter');
    expect(createdToastText('character', 'Orc Chief', m)).toBe('Created character: Orc Chief · appears in 2 narratives, unlinked');
    expect(createdToastText('character', 'Nobody', { total: 0, narratives: [], terms: [] })).toBe('Created character: Nobody');
  });
});
