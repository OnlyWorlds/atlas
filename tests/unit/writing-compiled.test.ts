/**
 * Unit tests for writing-compiled — narrative tree assembly + the mini
 * markdown renderer used for read-only compiled-view rendering.
 */

import { describe, it, expect } from 'vitest';
import { buildCompiledTree, renderProseFragment, narrativeHasChildren } from '../../src/middle/writing-compiled';
import type { Element } from '../../src/core/types';

function makeNarrative(id: string, name: string, opts: { parent?: string; story?: string; order?: number } = {}): Element {
  return {
    id,
    type: 'narrative',
    name,
    local_updated_at: '2026-05-23T00:00:00.000Z',
    story: opts.story ?? '',
    parent_narrative: opts.parent,
    order: opts.order ?? 0,
  } as Element;
}

describe('writing-compiled / buildCompiledTree', () => {
  it('returns a leaf section for a narrative with no children', () => {
    const root = makeNarrative('a', 'Book', { story: 'opening line' });
    const tree = buildCompiledTree(root, [root]);
    expect(tree.el.id).toBe('a');
    expect(tree.prose).toBe('opening line');
    expect(tree.children).toEqual([]);
  });

  it('nests children in order, respecting the order field', () => {
    const book = makeNarrative('book', 'Book', { story: 'preface' });
    const ch1 = makeNarrative('ch1', 'Chapter 1', { parent: 'book', order: 1, story: 'ch1 prose' });
    const ch2 = makeNarrative('ch2', 'Chapter 2', { parent: 'book', order: 2, story: 'ch2 prose' });
    // Pass children in reverse order; the helper should sort them.
    const tree = buildCompiledTree(book, [book, ch2, ch1]);
    expect(tree.children.map(c => c.el.id)).toEqual(['ch1', 'ch2']);
    expect(tree.children[0].prose).toBe('ch1 prose');
    expect(tree.children[1].prose).toBe('ch2 prose');
  });

  it('recurses across multiple depths', () => {
    const book = makeNarrative('book', 'Book');
    const ch1 = makeNarrative('ch1', 'Chapter 1', { parent: 'book' });
    const sc1 = makeNarrative('sc1', 'Scene 1', { parent: 'ch1', story: 'bar fight' });
    const sc2 = makeNarrative('sc2', 'Scene 2', { parent: 'ch1', story: 'aftermath', order: 1 });
    const tree = buildCompiledTree(book, [book, ch1, sc1, sc2]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].children.map(c => c.el.id)).toEqual(['sc1', 'sc2']);
  });

  it('ignores non-narrative siblings of the children', () => {
    const book = makeNarrative('book', 'Book');
    const ch1 = makeNarrative('ch1', 'Chapter', { parent: 'book' });
    const char: Element = {
      id: 'char',
      type: 'character',
      name: 'Drizzle',
      local_updated_at: '2026-05-23T00:00:00Z',
    } as Element;
    const tree = buildCompiledTree(book, [book, ch1, char]);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].el.id).toBe('ch1');
  });
});

describe('writing-compiled / narrativeHasChildren', () => {
  it('returns false for a leaf', () => {
    const root = makeNarrative('a', 'A');
    expect(narrativeHasChildren(root, [root])).toBe(false);
  });

  it('returns true when at least one narrative child exists', () => {
    const root = makeNarrative('a', 'A');
    const child = makeNarrative('b', 'B', { parent: 'a' });
    expect(narrativeHasChildren(root, [root, child])).toBe(true);
  });
});

describe('writing-compiled / renderProseFragment', () => {
  const elementsMap = new Map<string, Element>();

  it('renders paragraphs separated by blank lines', () => {
    const html = renderProseFragment('first paragraph\n\nsecond paragraph', elementsMap).outerHTML;
    expect(html).toContain('<p>first paragraph</p>');
    expect(html).toContain('<p>second paragraph</p>');
  });

  it('renders headings of multiple depths', () => {
    const html = renderProseFragment('# H1\n\n## H2\n\n### H3', elementsMap).outerHTML;
    expect(html).toContain('<h1>H1</h1>');
    expect(html).toContain('<h2>H2</h2>');
    expect(html).toContain('<h3>H3</h3>');
  });

  it('renders bold and italic inline', () => {
    const html = renderProseFragment('a **bold** word and *italic* one', elementsMap).outerHTML;
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
  });

  it('renders inline code', () => {
    const html = renderProseFragment('use `git log` to inspect', elementsMap).outerHTML;
    expect(html).toContain('<code>git log</code>');
  });

  it('renders unordered lists', () => {
    const html = renderProseFragment('- one\n- two\n- three', elementsMap).outerHTML;
    expect(html).toContain('<ul>');
    expect(html.match(/<li>/g)).toHaveLength(3);
  });

  it('renders ordered lists', () => {
    const html = renderProseFragment('1. one\n2. two', elementsMap).outerHTML;
    expect(html).toContain('<ol>');
    expect(html.match(/<li>/g)).toHaveLength(2);
  });

  it('renders blockquotes', () => {
    const html = renderProseFragment('> a quoted line', elementsMap).outerHTML;
    expect(html).toContain('<blockquote>a quoted line</blockquote>');
  });

  it('renders horizontal rules', () => {
    const html = renderProseFragment('text\n\n---\n\nmore', elementsMap).outerHTML;
    expect(html).toContain('<hr>');
  });

  it('converts ow:// links to element chips, resolving display label from elements map', () => {
    const map = new Map<string, Element>();
    map.set('char-1', {
      id: 'char-1', type: 'character', name: 'Drizzle',
      local_updated_at: '2026-01-01T00:00:00Z',
    } as Element);
    const html = renderProseFragment('hello [annoying guy](ow://character/char-1) end', map).outerHTML;
    // The chip uses the canonical name from the elements map, not the markdown label.
    expect(html).toContain('class="atlas-element-chip"');
    expect(html).toContain('data-id="char-1"');
    expect(html).toContain('data-type="character"');
    expect(html).toContain('>Drizzle<');
  });

  it('renders standard links as anchor tags', () => {
    const html = renderProseFragment('see [docs](https://example.com) here', elementsMap).outerHTML;
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('>docs</a>');
  });

  it('escapes HTML in raw text', () => {
    const html = renderProseFragment('<script>alert(1)</script>', elementsMap).outerHTML;
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('returns an empty container when given empty markdown', () => {
    const el = renderProseFragment('', elementsMap);
    expect(el.children.length).toBe(0);
  });
});
