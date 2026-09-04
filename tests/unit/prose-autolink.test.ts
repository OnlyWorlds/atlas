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
  autolinkRichtext, unlinkRichtext, isValidChipLabel,
  linkTermMarkdown, linkTermRichtext, buildTermScanner,
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

  it('matches aliases and KEEPS THE WRITER\'S TEXT as the label (S309)', () => {
    // Captain's ruling, S309: creating a link NEVER changes the text in a
    // writing room — for every match kind. The S307 half-rule (case variants
    // keep the writer's text, different aliases snap to the canonical name)
    // is superseded: link-all rewrote the tour's own sentence with it.
    const index = buildAutolinkIndex(WORLD);
    const r = autolinkMarkdown('They bowed to the duchess.', index);
    expect(r.story).toBe('They bowed to [the duchess](ow://character/c1).');
  });

  it("a CASE-VARIANT alias keeps the writer own casing (S307)", () => {
    // Captain, S307: do not change capitalization when linking in the writing
    // room. A link is a relationship, not a spelling correction.
    const world = [el('c9', 'character', 'Consul', ['consul'])];
    const index = buildAutolinkIndex(world);
    const r = autolinkMarkdown('The old consul waited.', index);
    expect(r.story).toBe('The old [consul](ow://character/c9) waited.');
  });

  it("a GENUINELY different alias keeps its text AND resolves to the canonical ELEMENT", () => {
    // The boundary, restated for the S309 rule: the writer's text is the
    // LABEL, the canonical element is the TARGET. Widening the writer's-text
    // rule must never drift into linking the wrong element — "the duchess"
    // still points at Aralia's id, it just keeps saying "the duchess".
    const index = buildAutolinkIndex(WORLD);
    const r = autolinkMarkdown('They bowed to the duchess.', index);
    expect(r.linked.map(c => c.id)).toEqual(['c1']);
    expect(r.story).toContain('(ow://character/c1)');
    expect(r.story).not.toContain('Aralia');
  });

  it("THE GUARANTEE: linking never edits the writer text, in any form", () => {
    // Captain, S307 then S309, named as the highest-priority property of this
    // feature: creating a link NEVER changes the text. Case variants AND
    // aliases — every surface form survives promotion verbatim.
    //
    // Driven as a sweep over surface forms rather than one example, so a
    // regression in any shape fails here rather than in someone's manuscript.
    const index = buildAutolinkIndex(WORLD);
    const forms = ['Aralia', 'aralia', 'ARALIA', 'ArAlIa', 'the duchess', 'The Duchess'];
    for (const form of forms) {
      const r = autolinkMarkdown(`Then ${form} spoke.`, index);
      expect(r.linked.map(c => c.id), `${form} should link`).toEqual(['c1']);
      expect(r.story, `${form} must survive linking unchanged`)
        .toBe(`Then [${form}](ow://character/c1) spoke.`);
    }
  });

  it("THE GUARANTEE, strongest form: link-then-unlink is the identity", () => {
    // If linking never changes the text, stripping the links back off must
    // reproduce the original document byte-for-byte. This property covers
    // every label rule at once — any future path that rewrites a label
    // breaks the round trip loudly.
    const index = buildAutolinkIndex(WORLD);
    const originals = [
      'Then aralia spoke to the duchess.',
      'Bram met ARALIA in Vallaki. The Duchess smiled.',
      'The old consul waited below.',
    ];
    for (const original of originals) {
      const linked = autolinkMarkdown(original, index);
      const restored = unlinkMarkdown(linked.story);
      expect(restored.story, `round trip must restore: ${original}`).toBe(original);
    }
  });

  it("THE GUARANTEE holds for the richtext path too, not just markdown", () => {
    // Two engines share the index but have separate promotion sites; a fix
    // applied to one is exactly the asymmetry the S257 law warns about.
    const index = buildAutolinkIndex(WORLD);
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'Then aralia spoke.' },
    ] }] };
    const out = autolinkRichtext(doc as never, index);
    const para = (out.doc as { content: Array<{ content: Array<Record<string, unknown>> }> }).content[0];
    const chip = para.content.find(n => n.type === 'elementChip') as { attrs: { label: string } } | undefined;
    expect(chip, 'the lowercase mention linked').toBeTruthy();
    expect(chip!.attrs.label, 'and kept the writer casing').toBe('aralia');
  });

  it("THE GUARANTEE holds for ALIASES in richtext (S309)", () => {
    const index = buildAutolinkIndex(WORLD);
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
      { type: 'text', text: 'They bowed to the duchess.' },
    ] }] };
    const out = autolinkRichtext(doc as never, index);
    const para = (out.doc as { content: Array<{ content: Array<Record<string, unknown>> }> }).content[0];
    const chip = para.content.find(n => n.type === 'elementChip') as { attrs: { id: string; label: string } } | undefined;
    expect(chip, 'the alias mention linked').toBeTruthy();
    expect(chip!.attrs.label, 'and kept the writer text').toBe('the duchess');
    expect(chip!.attrs.id, 'while resolving to the canonical element').toBe('c1');
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

  it('is CASE-INSENSITIVE but still word-bounded (S307)', () => {
    const index = buildAutolinkIndex(WORLD);
    // Lowercase now links (Captain's ask) ...
    const lower = autolinkMarkdown('aralia walked home.', index);
    expect(lower.linked.map(c => c.id)).toEqual(['c1']);
    // ... and the writer's casing SURVIVES it. This is the guarantee the
    // whole change rests on: folding case without preserving the surface
    // form would turn every lowercase mention into a silent edit of the
    // prose.
    expect(lower.story).toBe('[aralia](ow://character/c1) walked home.');
    // Word boundaries still hold: "Bramble" is not "Bram".
    expect(autolinkMarkdown('Bramble is a shrub.', index).linked).toHaveLength(0);
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

describe('isValidChipLabel (the chip-label sync predicate)', () => {
  it('ignores stray whitespace on the label (S355: a padded label was being "corrected" to the name)', () => {
    expect(isValidChipLabel('orc ', { name: 'Orc Chief', aliases: ['orc'] })).toBe(true);
    expect(isValidChipLabel(' Orc Chief', { name: 'Orc Chief', aliases: [] })).toBe(true);
  });

  // The editors' rename sync rewrites any label that fails this check. It
  // MUST fold case, or one tick after a promotion it would quietly undo the
  // writer's-text rule the tests above lock in (the S309 pairing: promotion
  // preserves, sync tolerates — two halves of one decision).
  const surface = { name: 'Aralia', aliases: ['the duchess'] };

  it('accepts the canonical name in any casing', () => {
    for (const label of ['Aralia', 'aralia', 'ARALIA', 'ArAlIa']) {
      expect(isValidChipLabel(label, surface), label).toBe(true);
    }
  });

  it('accepts aliases in any casing', () => {
    for (const label of ['the duchess', 'The Duchess', 'THE DUCHESS']) {
      expect(isValidChipLabel(label, surface), label).toBe(true);
    }
  });

  it('rejects a stale pre-rename label, empty labels, and non-strings', () => {
    expect(isValidChipLabel('Old Name', surface)).toBe(false);
    expect(isValidChipLabel('', surface)).toBe(false);
    expect(isValidChipLabel(null, surface)).toBe(false);
    expect(isValidChipLabel(undefined, surface)).toBe(false);
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

// ---------------------------------------------------------------------------
// Term linking (S355): the find bar's "Link to element" — every match, one
// chosen target, the writer's text as label, links and chips never entered.
// ---------------------------------------------------------------------------

describe('linkTermMarkdown', () => {
  const target = { id: 'c2', type: 'character' };

  it('links EVERY match, not just the first, keeping the matched text as label', () => {
    const r = linkTermMarkdown('the orc met the Orc and another orc left', 'orc', target);
    expect(r.linked).toBe(3);
    expect(r.story).toBe(
      'the [orc](ow://character/c2) met the [Orc](ow://character/c2) and another [orc](ow://character/c2) left',
    );
  });

  it('respects the case-sensitive and whole-word flags exactly as the find bar does', () => {
    const cs = linkTermMarkdown('orc Orc orcs', 'orc', target, { caseSensitive: true });
    expect(cs.linked).toBe(2); // "orc" and the prefix of "orcs"; "Orc" skipped
    const ww = linkTermMarkdown('orc Orc orcs', 'orc', target, { wholeWord: true });
    expect(ww.linked).toBe(2); // "orc" and "Orc"; "orcs" skipped
    const both = linkTermMarkdown('orc Orc orcs', 'orc', target, { caseSensitive: true, wholeWord: true });
    expect(both.linked).toBe(1);
    expect(both.story).toBe('[orc](ow://character/c2) Orc orcs');
  });

  it('never enters an existing link, ow:// or plain', () => {
    const story = 'orc [orc](ow://character/c1) and [an orc](https://x.y) plus orc';
    const r = linkTermMarkdown(story, 'orc', target);
    expect(r.linked).toBe(2);
    expect(r.story).toBe(
      '[orc](ow://character/c2) [orc](ow://character/c1) and [an orc](https://x.y) plus [orc](ow://character/c2)',
    );
  });

  it('is a no-op for an empty term, an empty story, or no matches', () => {
    expect(linkTermMarkdown('', 'orc', target)).toEqual({ story: '', linked: 0 });
    expect(linkTermMarkdown('no match here', '', target)).toEqual({ story: 'no match here', linked: 0 });
    expect(linkTermMarkdown('no match here', 'orc', target)).toEqual({ story: 'no match here', linked: 0 });
  });

  it('treats the term as a literal, not a regex', () => {
    const r = linkTermMarkdown('a.c abc a.c', 'a.c', target);
    expect(r.linked).toBe(2);
  });

  it('never lets whitespace into a label: a padded term links its core and leaves the spaces as prose', () => {
    // Captain, S355: "orc " typed into the find box was becoming the chip.
    const r = linkTermMarkdown('an orc came; an orc.', 'orc ', target);
    expect(r.linked).toBe(1); // only "orc " (with the trailing space) matches; "orc." does not
    expect(r.story).toBe('an [orc](ow://character/c2) came; an orc.');
    const ws = linkTermMarkdown('a  b', ' ', target);
    expect(ws.linked).toBe(0);
    expect(ws.story).toBe('a  b');
  });
});

describe('linkTermRichtext', () => {
  const target = { id: 'c2', type: 'character' };
  const doc = (content: unknown[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });

  it('splits text nodes around every match and never enters a chip', () => {
    const input = doc([
      { type: 'text', text: 'the orc met ' },
      { type: 'elementChip', attrs: { id: 'c1', type: 'character', label: 'orc' } },
      { type: 'text', text: ' and an orc left', marks: [{ type: 'bold' }] },
    ]);
    const r = linkTermRichtext(input, 'orc', target);
    expect(r.linked).toBe(2);
    const para = (r.doc as any).content[0].content;
    expect(para).toEqual([
      { type: 'text', text: 'the ' },
      { type: 'elementChip', attrs: { id: 'c2', type: 'character', label: 'orc' } },
      { type: 'text', text: ' met ' },
      { type: 'elementChip', attrs: { id: 'c1', type: 'character', label: 'orc' } },
      { type: 'text', text: ' and an ', marks: [{ type: 'bold' }] },
      { type: 'elementChip', attrs: { id: 'c2', type: 'character', label: 'orc' } },
      { type: 'text', text: ' left', marks: [{ type: 'bold' }] },
    ]);
    // Input untouched.
    expect((input as any).content[0].content).toHaveLength(3);
  });

  it('trims whitespace off each match the same way the markdown half does', () => {
    const r = linkTermRichtext(doc([{ type: 'text', text: 'an orc came; an orc.' }]), 'orc ', target);
    expect(r.linked).toBe(1);
    expect((r.doc as any).content[0].content).toEqual([
      { type: 'text', text: 'an ' },
      { type: 'elementChip', attrs: { id: 'c2', type: 'character', label: 'orc' } },
      { type: 'text', text: ' came; an orc.' },
    ]);
  });

  it('agrees with the markdown half on the count under every flag combination', () => {
    const text = 'Orc orc orcs ORC';
    for (const caseSensitive of [false, true]) {
      for (const wholeWord of [false, true]) {
        const md = linkTermMarkdown(text, 'orc', target, { caseSensitive, wholeWord });
        const rt = linkTermRichtext(doc([{ type: 'text', text }]), 'orc', target, { caseSensitive, wholeWord });
        expect(rt.linked).toBe(md.linked);
      }
    }
  });
});

describe('buildTermScanner', () => {
  it('is the one scanner shape: literal, optional word bounds, optional case', () => {
    expect(buildTermScanner('')).toBeNull();
    expect(buildTermScanner('a.b')!.source).toBe('(?:a\\.b)');
    expect(buildTermScanner('ab', { wholeWord: true })!.source).toBe('\\b(?:ab)\\b');
    expect(buildTermScanner('ab')!.flags).toBe('gi');
    expect(buildTermScanner('ab', { caseSensitive: true })!.flags).toBe('g');
  });
});
