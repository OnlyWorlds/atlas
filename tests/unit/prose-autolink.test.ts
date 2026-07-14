/**
 * Prose autolink kernel (S265) — the pure transforms behind the link-all
 * icon, selection linking, and the tree-level bulk over closed narratives.
 * The markdown and richtext halves are tested against the same rules the
 * live plugin enforces: first mention only, ambiguity skipped, case-sensitive
 * word-bounded match, existing links respected.
 */

import { describe, it, expect } from 'vitest';
import {
  buildAutolinkIndex, autolinkMarkdown, unlinkMarkdown,
  autolinkRichtext, unlinkRichtext,
} from '../../src/core/prose-autolink';
import type { Element } from '../../src/core/types';

function el(id: string, type: string, name: string, aliases?: string[]): Element {
  return { id, type, name, ...(aliases ? { atlas_aliases: aliases } : {}) } as unknown as Element;
}

const WORLD = [
  el('c1', 'character', 'Aralia', ['the duchess']),
  el('c2', 'character', 'Bram'),
  el('l1', 'location', 'Vallaki'),
  // Ambiguous pair — same name, two elements.
  el('x1', 'object', 'Echo'),
  el('x2', 'creature', 'Echo'),
];

describe('autolinkMarkdown', () => {
  it('links the first mention only, leaves later occurrences as text', () => {
    const index = buildAutolinkIndex(WORLD);
    const r = autolinkMarkdown('Aralia rode out. Later Aralia returned.', index);
    expect(r.story).toBe('[Aralia](ow://character/c1) rode out. Later Aralia returned.');
    expect(r.linked.map(c => c.id)).toEqual(['c1']);
  });

  it('matches aliases and labels the chip with the canonical name (mirrors Tab)', () => {
    const index = buildAutolinkIndex(WORLD);
    const r = autolinkMarkdown('They bowed to the duchess.', index);
    expect(r.story).toBe('They bowed to [Aralia](ow://character/c1).');
  });

  it('skips ambiguous names entirely', () => {
    const index = buildAutolinkIndex(WORLD);
    const r = autolinkMarkdown('An Echo sounded.', index);
    expect(r.story).toBe('An Echo sounded.');
    expect(r.linked).toHaveLength(0);
  });

  it('respects existing ow:// links (id counts as mentioned) and protected link spans', () => {
    const index = buildAutolinkIndex(WORLD);
    const story = 'See [Aralia](ow://character/c1). Aralia smiled. [Vallaki gates](https://x.test) held. Vallaki fell.';
    const r = autolinkMarkdown(story, index);
    // Aralia already linked → second mention untouched. "Vallaki" inside the
    // external link's label is protected; the bare "Vallaki" after it links.
    expect(r.story).toBe(
      'See [Aralia](ow://character/c1). Aralia smiled. [Vallaki gates](https://x.test) held. [Vallaki](ow://location/l1) fell.',
    );
  });

  it('is case-sensitive and word-bounded', () => {
    const index = buildAutolinkIndex(WORLD);
    expect(autolinkMarkdown('aralia is lowercase; Bramble is a shrub.', index).linked).toHaveLength(0);
  });

  it('links multiple distinct candidates in one pass', () => {
    const index = buildAutolinkIndex(WORLD);
    const r = autolinkMarkdown('Bram met Aralia in Vallaki.', index);
    expect(r.linked.map(c => c.id).sort()).toEqual(['c1', 'c2', 'l1']);
    expect(r.story).toBe(
      '[Bram](ow://character/c2) met [Aralia](ow://character/c1) in [Vallaki](ow://location/l1).',
    );
  });
});

describe('unlinkMarkdown', () => {
  it('strips ow links to bare labels, leaves external links alone', () => {
    const r = unlinkMarkdown('See [Aralia](ow://character/c1) at [the site](https://x.test).');
    expect(r.story).toBe('See Aralia at [the site](https://x.test).');
    expect(r.unlinked).toBe(1);
  });
});

describe('autolinkRichtext', () => {
  const doc = (content: unknown[]): unknown => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

  it('splits a text node around the first mention and inserts a chip', () => {
    const index = buildAutolinkIndex(WORLD);
    const input = doc([{ type: 'text', text: 'Then Aralia spoke. Aralia left.' }]);
    const r = autolinkRichtext(input, index);
    const para = (r.doc as any).content[0];
    expect(para.content).toEqual([
      { type: 'text', text: 'Then ' },
      { type: 'elementChip', attrs: { id: 'c1', type: 'character', label: 'Aralia' } },
      { type: 'text', text: ' spoke. Aralia left.' },
    ]);
    expect(r.linked.map(c => c.id)).toEqual(['c1']);
    // Input untouched (pure).
    expect((input as any).content[0].content).toHaveLength(1);
  });

  it('preserves marks on the split text halves', () => {
    const index = buildAutolinkIndex(WORLD);
    const bold = [{ type: 'bold' }];
    const input = doc([{ type: 'text', text: 'brave Bram indeed', marks: bold }]);
    const r = autolinkRichtext(input, index);
    const para = (r.doc as any).content[0];
    expect(para.content[0]).toEqual({ type: 'text', text: 'brave ', marks: bold });
    expect(para.content[1].type).toBe('elementChip');
    expect(para.content[2]).toEqual({ type: 'text', text: ' indeed', marks: bold });
  });

  it('treats existing chips as mentioned — first-mention holds across nodes', () => {
    const index = buildAutolinkIndex(WORLD);
    const input = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'elementChip', attrs: { id: 'c1', type: 'character', label: 'Aralia' } }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Aralia again, and Vallaki.' }] },
      ],
    };
    const r = autolinkRichtext(input, index);
    const p2 = (r.doc as any).content[1];
    expect(p2.content.map((n: any) => n.type)).toEqual(['text', 'elementChip', 'text']);
    expect(p2.content[1].attrs.id).toBe('l1');
  });
});

describe('unlinkRichtext', () => {
  it('replaces chips with their label text and counts them', () => {
    const input = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'See ' },
          { type: 'elementChip', attrs: { id: 'c1', type: 'character', label: 'Aralia' } },
          { type: 'text', text: ' now.' },
        ],
      }],
    };
    const r = unlinkRichtext(input);
    const para = (r.doc as any).content[0];
    expect(para.content).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'text', text: 'Aralia' },
      { type: 'text', text: ' now.' },
    ]);
    expect(r.unlinked).toBe(1);
  });
});
