/**
 * Unlinked mentions — the count behind the context pane's
 * "Mentioned, unlinked (N in M scenes) · Link all" line and the create
 * modal's nudge. The count and the link share one span finder, so the
 * number shown is the number written.
 */

import { describe, it, expect } from 'vitest';
import {
  findUnlinkedMentions, mentionTermsFor, mentionsPhrase, createdToastText, MENTION_MATCH,
} from '../../src/core/unlinked-mentions';
import { buildTermScanner, linkTermMarkdown } from '../../src/core/prose-autolink';
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

  it('agrees with the link it offers: linking every listed narrative with the same terms writes exactly total chips', () => {
    const m = findUnlinkedMentions(chief, WORLD);
    let written = 0;
    for (const n of m.narratives) {
      const story = WORLD.find(e => e.id === n.id)!.story as string;
      written += linkTermMarkdown(story, m.terms, { id: chief.id, type: chief.type }, MENTION_MATCH).linked;
    }
    expect(written).toBe(m.total);
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
