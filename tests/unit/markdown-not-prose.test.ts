/**
 * A name inside markdown that is not prose is never found (the SDK's finder
 * read as markdown, `MARKDOWN_TEXT`): a code span, a fenced code block, an HTML
 * tag, a reference definition's line, a bare address or an autolink. Each was
 * linked before, and the link broke the markup (`see http://[Kira](ow://...)`).
 * The hints, the count, Link all's write and the Featured badge read one rule,
 * so the number shown is the number written. A Kira in prose beside each case
 * is the control: it is still found, once.
 */
import { describe, it, expect } from 'vitest';
import { findUnlinkedMentions } from '../../src/core/unlinked-mentions';
import {
  autolinkMarkdown, buildAutolinkIndex, elementSpans, linkSpansMarkdown, mentionsByName,
  MARKDOWN_TEXT, MENTIONS_MARKDOWN,
} from '../../src/core/prose-autolink';
import type { Element } from '../../src/core/types';

const kira = { id: '0192b000-0000-7000-8000-00000000c001', type: 'character', name: 'Kira' } as unknown as Element;

const NOT_PROSE: Array<[string, string]> = [
  ['a code span', 'The spell is `Kira` in the old tongue.'],
  ['a fenced code block', '```\nKira = 3\n```'],
  ['an HTML attribute', '<span title="Kira">a name</span>'],
  ['an HTML comment', '<!-- Kira goes here -->'],
  ['a reference definition', '[Kira]: http://example.com/kira'],
  ['a bare address', 'see http://Kira.example/path'],
  ['an autolink', 'see <http://Kira.example/path>'],
];

describe('a name inside markdown that is not prose', () => {
  for (const [what, markup] of NOT_PROSE) {
    const story = `${markup}\n\nKira walked in.`;
    const narrative = { id: '0192b000-0000-7000-8000-00000000a001', type: 'narrative', name: 'Scene', story } as unknown as Element;

    it(`${what}: the hints, the count and the write each find only the Kira in prose`, () => {
      const hinted = autolinkMarkdown(story, buildAutolinkIndex([kira]));
      expect(hinted.linked).toHaveLength(1);
      expect(hinted.story.startsWith(markup)).toBe(true);

      expect(findUnlinkedMentions(kira, [kira, narrative]).total).toBe(1);

      const written = linkSpansMarkdown(story, elementSpans(kira)!, { id: kira.id, type: 'character' }, MENTIONS_MARKDOWN);
      expect(written.linked).toBe(1);
      expect(written.story.startsWith(markup)).toBe(true);
    });

    it(`${what}: alone, it is no mention for the Featured badge`, () => {
      expect(mentionsByName(kira, markup, MARKDOWN_TEXT)).toBe(false);
    });
  }

  it('rich text keeps its literal backticks as prose (the option is for markdown only)', () => {
    expect(mentionsByName(kira, 'The spell is `Kira`.')).toBe(true);
  });
});
