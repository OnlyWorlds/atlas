/**
 * Unit tests for writing-compiled — narrative tree assembly + the mini
 * markdown renderer used for read-only compiled-view rendering.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { buildCompiledTree, compiledIds, compiledWordCount, renderProseFragment, narrativeHasChildren } from '../../src/middle/writing-compiled';
import { getState, patchSlice } from '../../src/core/state';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

/** A world with no registry row: the default writing labels (Book, Chapter, Scene, Draft). */
const WID = 'w-compiled';

/** A narrative in the writing tree unless told otherwise (a Scene by default: the tree links any tier under any tier). */
function makeNarrative(id: string, name: string, opts: { parent?: string; story?: string; order?: number; supertype?: string | null } = {}): Element {
  return {
    id,
    type: 'narrative',
    name,
    supertype: opts.supertype === undefined ? 'Scene' : opts.supertype,
    local_updated_at: '2026-05-23T00:00:00.000Z',
    story: opts.story ?? '',
    parent_narrative: opts.parent,
    order: opts.order ?? 0,
  } as Element;
}

describe('writing-compiled / buildCompiledTree', () => {
  it('returns a leaf section for a narrative with no children', () => {
    const root = makeNarrative('a', 'Book', { story: 'opening line' });
    const tree = buildCompiledTree(root, [root], WID);
    expect(tree.el.id).toBe('a');
    expect(tree.prose).toBe('opening line');
    expect(tree.children).toEqual([]);
  });

  it('nests children in order, respecting the order field', () => {
    const book = makeNarrative('book', 'Book', { story: 'preface' });
    const ch1 = makeNarrative('ch1', 'Chapter 1', { parent: 'book', order: 1, story: 'ch1 prose' });
    const ch2 = makeNarrative('ch2', 'Chapter 2', { parent: 'book', order: 2, story: 'ch2 prose' });
    // Pass children in reverse order; the helper should sort them.
    const tree = buildCompiledTree(book, [book, ch2, ch1], WID);
    expect(tree.children.map(c => c.el.id)).toEqual(['ch1', 'ch2']);
    expect(tree.children[0].prose).toBe('ch1 prose');
    expect(tree.children[1].prose).toBe('ch2 prose');
  });

  it('recurses across multiple depths', () => {
    const book = makeNarrative('book', 'Book');
    const ch1 = makeNarrative('ch1', 'Chapter 1', { parent: 'book' });
    const sc1 = makeNarrative('sc1', 'Scene 1', { parent: 'ch1', story: 'bar fight' });
    const sc2 = makeNarrative('sc2', 'Scene 2', { parent: 'ch1', story: 'aftermath', order: 1 });
    const tree = buildCompiledTree(book, [book, ch1, sc1, sc2], WID);
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
    const tree = buildCompiledTree(book, [book, ch1, char], WID);
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].el.id).toBe('ch1');
  });
});

describe('writing-compiled / narrativeHasChildren', () => {
  it('returns false for a leaf', () => {
    const root = makeNarrative('a', 'A');
    expect(narrativeHasChildren(root, [root], WID)).toBe(false);
  });

  it('returns true when at least one narrative child exists', () => {
    const root = makeNarrative('a', 'A');
    const child = makeNarrative('b', 'B', { parent: 'a' });
    expect(narrativeHasChildren(root, [root, child], WID)).toBe(true);
  });
});

/**
 * The compiled view prints the tree, nothing beside it (1.123.1). Blood
 * Meridian's shape as keel serves it: Chapter I's scenes, and under its
 * second scene "The father's telling" (supertype Telling), which the tree
 * leaves out. Its text repeats lines the scene holds, so printing it doubled
 * them in Chapter I's compiled view and its count.
 */
describe('writing-compiled / the tree, nothing beside it', () => {
  const before = getState().registry;
  afterEach(() => { patchSlice('registry', before); });

  const book = makeNarrative('book', 'Blood Meridian (the novel)', { supertype: 'Book' });
  const ch1 = makeNarrative('ch1', 'Chapter I', { parent: 'book', order: 1, supertype: 'Chapter', story: 'The chapter.' });
  const child = makeNarrative('s1', 'The child', { parent: 'ch1', order: 1, story: 'See the child.' });
  const night = makeNarrative('s2', 'The night he was born', { parent: 'ch1', order: 2, story: 'Night of your birth. Thirty-three.' });
  const south = makeNarrative('s3', 'The way south', { parent: 'ch1', order: 3, story: 'He wanders west.' });
  const telling = makeNarrative('t', "The father's telling", { parent: 's2', order: 1, supertype: 'Telling', story: 'Night of your birth. Thirty-three. The Leonids they were called.' });
  const memoir = makeNarrative('m', 'My Confession', { supertype: 'Memoir', story: 'Not in the book at all.' });
  const all = [book, memoir, telling, south, ch1, night, child];

  it('a Narrative the tree leaves out is not a section, at any depth', () => {
    const tree = buildCompiledTree(ch1, all, WID);
    expect(tree.children.map(c => c.el.id)).toEqual(['s1', 's2', 's3']);
    expect(tree.children[1].children).toEqual([]);
    expect(compiledIds(book, all, WID)).toEqual(['book', 'ch1', 's1', 's2', 's3']);
  });

  it('nor counted: Chapter I counts its own words and its three scenes, not the telling', () => {
    // 2 + 3 + 5 + 3
    expect(compiledWordCount(ch1, all, WID)).toBe(13);
  });

  it('a Scene whose only child is outside the tree is a leaf: it opens to write', () => {
    expect(narrativeHasChildren(night, all, WID)).toBe(false);
    expect(narrativeHasChildren(ch1, all, WID)).toBe(true);
  });

  it('a writer who gives that narrative a tier gets it in both, by their own choice', () => {
    patchSlice('registry', {
      ...before,
      worlds: [{ id: WID, name: 'Blood Meridian', writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Telling' } } as unknown as WorldRegistryEntry],
    });
    const tree = buildCompiledTree(ch1, all, WID);
    expect(tree.children[1].children.map(c => c.el.id)).toEqual(['t']);
    expect(compiledWordCount(ch1, all, WID)).toBe(13 + 10);
    expect(narrativeHasChildren(night, all, WID)).toBe(true);
  });

  it('a root outside the tree prints its own prose only (its tiered children are roots of their own there)', () => {
    const under = makeNarrative('u', 'A scene under the memoir', { parent: 'm', story: 'Tiered.' });
    const tree = buildCompiledTree(memoir, [...all, under], WID);
    expect(tree.prose).toBe('Not in the book at all.');
    expect(tree.children).toEqual([]);
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

  it('escapes HTML-special chars in inline code exactly once (preview ≡ served)', () => {
    // Regression (2026-07-10 sweep): the code-span replacer re-escaped
    // content captured from the ALREADY-escaped string, so `<div>` rendered
    // as the literal text "&lt;div&gt;" in atlas previews while show's
    // renderer showed "<div>" — a preview-vs-served divergence.
    const html = renderProseFragment('wrap it in `<div>` first', elementsMap).outerHTML;
    expect(html).toContain('<code>&lt;div&gt;</code>');
    expect(html).not.toContain('&amp;lt;');
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

  it('converts ow:// links to element chips and KEEPS THE WRITER\'S LABEL (the label law)', () => {
    const map = new Map<string, Element>();
    map.set('char-1', {
      id: 'char-1', type: 'character', name: 'Drizzle',
      local_updated_at: '2026-01-01T00:00:00Z',
    } as Element);
    const html = renderProseFragment('hello [annoying guy](ow://character/char-1) end', map).outerHTML;
    // Titus: a link must NEVER be shown as the element's name. The
    // rendering used to print "Drizzle" here, so a book compiled differently
    // from the scene it contained.
    expect(html).toContain('class="atlas-element-chip"');
    expect(html).toContain('data-id="char-1"');
    expect(html).toContain('data-type="character"');
    expect(html).toContain('>annoying guy<');
    expect(html).not.toContain('Drizzle');
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
