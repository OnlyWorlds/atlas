/**
 * Tests for the JSON → markdown serializer + the load-time link-mark → chip
 * converter (conventions #47, #48).
 */

import { describe, it, expect } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { serializeDocToMarkdown } from '../../src/middle/writing-workspace-markdown';
import { convertLinkMarksToChips } from '../../src/middle/writing-workspace-load';

function doc(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content };
}
function p(...content: JSONContent[]): JSONContent {
  return { type: 'paragraph', content };
}
function text(s: string, marks?: any[]): JSONContent {
  return marks ? { type: 'text', text: s, marks } : { type: 'text', text: s };
}
function chip(attrs: { id: string; type: string; label: string }): JSONContent {
  return { type: 'elementChip', attrs };
}

describe('serializeDocToMarkdown', () => {
  it('serializes plain paragraph text', () => {
    const out = serializeDocToMarkdown(doc(p(text('Hello world.'))));
    expect(out).toBe('Hello world.');
  });

  it('separates paragraphs with blank line', () => {
    const out = serializeDocToMarkdown(doc(p(text('First.')), p(text('Second.'))));
    expect(out).toBe('First.\n\nSecond.');
  });

  it('serializes headings 1-3', () => {
    const out = serializeDocToMarkdown(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [text('H1')] },
        { type: 'heading', attrs: { level: 2 }, content: [text('H2')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('H3')] },
      ),
    );
    expect(out).toBe('# H1\n\n## H2\n\n### H3');
  });

  it('serializes bold + italic marks', () => {
    const out = serializeDocToMarkdown(
      doc(
        p(
          text('Plain '),
          text('bold', [{ type: 'bold' }]),
          text(' and '),
          text('italic', [{ type: 'italic' }]),
          text('.'),
        ),
      ),
    );
    expect(out).toBe('Plain **bold** and *italic*.');
  });

  it('serializes element chip as ow:// markdown link', () => {
    const out = serializeDocToMarkdown(
      doc(p(text('Hello '), chip({ id: 'abc-123', type: 'character', label: 'Drizzle' }), text('.'))),
    );
    expect(out).toBe('Hello [Drizzle](ow://character/abc-123).');
  });

  it('serializes chip with type other than character', () => {
    const out = serializeDocToMarkdown(
      doc(p(chip({ id: 'l-1', type: 'location', label: 'The Loft' }))),
    );
    expect(out).toBe('[The Loft](ow://location/l-1)');
  });

  it('serializes unordered list', () => {
    const list: JSONContent = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [p(text('one'))] },
        { type: 'listItem', content: [p(text('two'))] },
      ],
    };
    const out = serializeDocToMarkdown(doc(list));
    expect(out).toBe('- one\n- two');
  });

  it('serializes ordered list', () => {
    const list: JSONContent = {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [
        { type: 'listItem', content: [p(text('one'))] },
        { type: 'listItem', content: [p(text('two'))] },
      ],
    };
    const out = serializeDocToMarkdown(doc(list));
    expect(out).toBe('1. one\n2. two');
  });

  it('serializes blockquote', () => {
    const out = serializeDocToMarkdown(
      doc({ type: 'blockquote', content: [p(text('Quoted prose.'))] }),
    );
    expect(out).toBe('> Quoted prose.');
  });

  it('serializes horizontal rule', () => {
    const out = serializeDocToMarkdown(doc({ type: 'horizontalRule' }));
    expect(out).toBe('---');
  });

  it('escapes closing bracket in chip label', () => {
    const out = serializeDocToMarkdown(
      doc(p(chip({ id: 'c-1', type: 'character', label: 'Bracket]Name' }))),
    );
    expect(out).toBe('[Bracket\\]Name](ow://character/c-1)');
  });
});

describe('convertLinkMarksToChips', () => {
  it('passes through doc with no link marks unchanged', () => {
    const input = doc(p(text('Plain.')));
    const out = convertLinkMarksToChips(input);
    // Function may shallow-copy; content should be equivalent
    expect(out.content).toBeDefined();
    expect(JSON.stringify(out)).toEqual(JSON.stringify(input));
  });

  it('converts ow:// link marks to elementChip nodes', () => {
    const input = doc(
      p(
        text('Hello '),
        text('Drizzle', [{ type: 'link', attrs: { href: 'ow://character/abc-123' } }]),
        text('.'),
      ),
    );
    const out = convertLinkMarksToChips(input);
    const paragraph = (out.content as JSONContent[])[0];
    const chipNode = (paragraph.content as JSONContent[])[1];
    expect(chipNode.type).toBe('elementChip');
    expect(chipNode.attrs?.id).toBe('abc-123');
    expect(chipNode.attrs?.type).toBe('character');
    expect(chipNode.attrs?.label).toBe('Drizzle');
  });

  it('leaves non-ow:// link marks untouched (e.g. https://)', () => {
    const input = doc(
      p(
        text('Visit '),
        text('site', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        text('.'),
      ),
    );
    const out = convertLinkMarksToChips(input);
    const paragraph = (out.content as JSONContent[])[0];
    const linkText = (paragraph.content as JSONContent[])[1];
    expect(linkText.type).toBe('text');
    expect(linkText.marks?.[0]?.type).toBe('link');
    expect(linkText.marks?.[0]?.attrs?.href).toBe('https://example.com');
  });

  it('preserves other marks (bold/italic) when converting a chip', () => {
    const input = doc(
      p(
        text('Drizzle', [
          { type: 'link', attrs: { href: 'ow://character/abc-123' } },
          { type: 'bold' },
        ]),
      ),
    );
    const out = convertLinkMarksToChips(input);
    const paragraph = (out.content as JSONContent[])[0];
    const chipNode = (paragraph.content as JSONContent[])[0];
    expect(chipNode.type).toBe('elementChip');
    expect(chipNode.marks?.find(m => m.type === 'bold')).toBeTruthy();
    expect(chipNode.marks?.find(m => m.type === 'link')).toBeUndefined();
  });

  it('handles multiple chips in a single paragraph', () => {
    const input = doc(
      p(
        text('A', [{ type: 'link', attrs: { href: 'ow://character/c-1' } }]),
        text(' and '),
        text('B', [{ type: 'link', attrs: { href: 'ow://location/l-1' } }]),
      ),
    );
    const out = convertLinkMarksToChips(input);
    const para = (out.content as JSONContent[])[0];
    const kids = para.content as JSONContent[];
    expect(kids[0].type).toBe('elementChip');
    expect(kids[0].attrs?.type).toBe('character');
    expect(kids[2].type).toBe('elementChip');
    expect(kids[2].attrs?.type).toBe('location');
  });
});

describe('round-trip: serialize → parse markdown links', () => {
  // Note: full markdown → JSON parse uses @tiptap/markdown which is harder to
  // exercise outside a real Editor. Here we just sanity-check that serialized
  // markdown can be re-parsed by extracting the ow:// links manually.
  it('serialized chip can be re-detected as ow:// link', () => {
    const md = serializeDocToMarkdown(
      doc(p(chip({ id: 'abc-123', type: 'character', label: 'Drizzle' }))),
    );
    expect(md).toMatch(/\[Drizzle\]\(ow:\/\/character\/abc-123\)/);
  });

  it('serialized then matched by the auto-derive regex', () => {
    const md = serializeDocToMarkdown(
      doc(
        p(chip({ id: 'c-1', type: 'character', label: 'A' })),
        p(chip({ id: 'l-1', type: 'location', label: 'B' })),
      ),
    );
    const matches = Array.from(md.matchAll(/ow:\/\/([a-z_]+)\/([\w-]+)/gi));
    expect(matches.length).toBe(2);
  });
});
