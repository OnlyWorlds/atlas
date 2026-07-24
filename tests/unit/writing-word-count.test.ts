/**
 * Word counting across the two writing surfaces.
 *
 * The bug this locks: the compiled view had no editor handle, so the ambient
 * widget read `?? 0` and displayed "0 words" under a fully assembled
 * manuscript. The fix counts the compiled tree — and the invariant that keeps
 * it honest is that a LEAF reports the same number in both views, which is
 * only true while both sides share one counting rule.
 */

import { describe, it, expect } from 'vitest';
import { countWords, countMarkdownWords, markdownToPlainText } from '../../src/middle/writing-word-count';
import { compiledWordCount } from '../../src/middle/writing-compiled';
import type { Element } from '../../src/core/types';

function narrative(id: string, name: string, story: string, parent?: string): Element {
  return {
    id,
    name,
    type: 'narrative',
    story,
    ...(parent ? { parent_narrative: parent } : {}),
  } as unknown as Element;
}

describe('countWords', () => {
  it('counts whitespace-delimited words', () => {
    expect(countWords('one two three')).toBe(3);
  });

  it('is zero for empty and whitespace-only text', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
  });

  it('collapses runs of whitespace', () => {
    expect(countWords('  one   two \n\n three  ')).toBe(3);
  });
});

describe('markdownToPlainText', () => {
  it('keeps an ow:// chip label and drops its target', () => {
    const md = 'The [Hegemony Consul](ow://character/abc-123) sat on the balcony.';
    expect(markdownToPlainText(md)).toBe('The Hegemony Consul sat on the balcony.');
    expect(countMarkdownWords(md)).toBe(7);
  });

  it('keeps a plain link label and drops the url', () => {
    expect(markdownToPlainText('see [the docs](https://example.com/a_b)')).toBe('see the docs');
  });

  it('strips emphasis, code, and line-level syntax', () => {
    const md = [
      '# A heading',
      '',
      '> quoted words here',
      '',
      '- first item',
      '2. second item',
      '',
      '---',
      '',
      '**bold** and *italic* and `code`',
    ].join('\n');
    const plain = markdownToPlainText(md);
    expect(plain).not.toMatch(/[#>*`]/);
    expect(plain).not.toContain('---');
    expect(countMarkdownWords(md)).toBe(14);
  });

  it('does not count markdown syntax as words', () => {
    // The naive count (split the raw markdown) would read 4 here.
    expect(countMarkdownWords('**a** *b*')).toBe(2);
  });
});

describe('compiledWordCount', () => {
  const book = narrative('book', 'The Book', 'Opening words of the book.');
  const chapter = narrative('chap', 'Chapter One', 'Three more words.', 'book');
  const scene = narrative('scene', 'A Scene', 'Two words.', 'chap');
  const other = narrative('other', 'Unrelated', 'Not part of this tree at all.');
  const all = [book, chapter, scene, other];

  it('sums the root prose and every descendant', () => {
    // 5 + 3 + 2
    expect(compiledWordCount(book, all)).toBe(10);
  });

  it('excludes narratives outside the tree', () => {
    expect(compiledWordCount(chapter, all)).toBe(5);
  });

  it('is not zero for a parent whose own prose is empty', () => {
    const emptyParent = narrative('p', 'Parent', '');
    const child = narrative('c', 'Child', 'Some real prose lives down here.', 'p');
    expect(compiledWordCount(emptyParent, [emptyParent, child])).toBe(6);
  });

  it('counts chip labels as the words a reader sees', () => {
    const withChips = narrative('w', 'W', 'He met [Admiral Fluffington](ow://character/x-1) today.');
    expect(compiledWordCount(withChips, [withChips])).toBe(5);
  });

  it('agrees with the editor rule on a leaf, so switching views cannot change the number', () => {
    const leaf = narrative('leaf', 'Leaf', 'The [Consul](ow://character/abc) waited.');
    // What the editor would count: its plain text, which renders the chip as
    // its label. Same rule, same source text, same number.
    const editorSideCount = countWords('The Consul waited.');
    expect(compiledWordCount(leaf, [leaf])).toBe(editorSideCount);
  });
});
