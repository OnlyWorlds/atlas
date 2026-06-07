/**
 * core/sharing + core/narrative-kind unit tests (DESIGN_SHARING.md).
 *
 * Covers: page classification, intent fallback, defensive block parsing,
 * the refs-mirror heal in blocksOf (id-swap correctness), the derived story
 * compilation, and the three-kind narrative seam.
 */

import { describe, it, expect } from 'vitest';
import {
  PAGE_SUBTYPE, isPageNarrative, listPages, pageIntentOf,
  parsePageBlocks, blocksOf, pageRefsFor, pageBlocksPatch,
  compilePageStory, blockSummary, findUniquePageName,
  type PageBlock,
} from '../../src/core/sharing';
import { narrativeKindOf, isStoryNarrative } from '../../src/core/narrative-kind';
import { populatedCardFields } from '../../src/middle/share-page-render';
import type { Element } from '../../src/core/types';

function el(partial: Partial<Element> & Record<string, unknown>): Element {
  return { id: 'x', type: 'narrative', name: 'n', ...partial } as Element;
}

describe('page classification', () => {
  it('isPageNarrative matches narrative subtype "page" (case-insensitive)', () => {
    expect(isPageNarrative(el({ subtype: 'page' }))).toBe(true);
    expect(isPageNarrative(el({ subtype: 'Page' }))).toBe(true);
    expect(isPageNarrative(el({ subtype: 'knowledge' }))).toBe(false);
    expect(isPageNarrative(el({ subtype: '' }))).toBe(false);
    expect(isPageNarrative(el({ type: 'character', subtype: 'page' }))).toBe(false);
    expect(isPageNarrative(null)).toBe(false);
  });

  it('listPages filters to pages only', () => {
    const els = [
      el({ id: 'a', subtype: PAGE_SUBTYPE }),
      el({ id: 'b', subtype: 'knowledge' }),
      el({ id: 'c' }),
    ];
    expect(listPages(els).map(e => e.id)).toEqual(['a']);
  });

  it('narrativeKindOf distinguishes the three kinds; story is the default', () => {
    expect(narrativeKindOf(el({ subtype: 'page' }))).toBe('page');
    expect(narrativeKindOf(el({ subtype: 'knowledge' }))).toBe('knowledge');
    expect(narrativeKindOf(el({ subtype: 'vision' }))).toBe('story');
    expect(narrativeKindOf(el({}))).toBe('story');
    expect(narrativeKindOf(el({ type: 'character' }))).toBe(null);
    expect(isStoryNarrative(el({ subtype: 'page' }))).toBe(false);
    expect(isStoryNarrative(el({}))).toBe(true);
  });
});

describe('page intent', () => {
  it('reads a valid intent; falls back to "show" for missing/unknown', () => {
    expect(pageIntentOf(el({ atlas_page_intent: 'reference' }))).toBe('reference');
    expect(pageIntentOf(el({ atlas_page_intent: 'publish' }))).toBe('publish');
    expect(pageIntentOf(el({}))).toBe('show');
    expect(pageIntentOf(el({ atlas_page_intent: 'bogus' }))).toBe('show');
  });
});

describe('parsePageBlocks (defensive)', () => {
  it('accepts well-formed blocks of every v1 kind', () => {
    const raw = [
      { id: 'h1', kind: 'heading', text: 'Barovia', level: 1 },
      { id: 'p1', kind: 'prose', markdown: 'The mists…' },
      { id: 'c1', kind: 'element-card', elementId: 'e-1', variant: 'full', fields: ['description'] },
    ];
    const blocks = parsePageBlocks(raw);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toEqual({ id: 'h1', kind: 'heading', text: 'Barovia', level: 1 });
    expect(blocks[1]).toEqual({ id: 'p1', kind: 'prose', markdown: 'The mists…', richtextJson: null });
    expect(blocks[2]).toEqual({ id: 'c1', kind: 'element-card', elementId: 'e-1', variant: 'full', fields: ['description'] });
  });

  it('drops malformed entries and unknown kinds; never throws', () => {
    const raw = [
      null,
      'garbage',
      { kind: 'heading', text: 'no id' },
      { id: 'h2', kind: 'heading' },                        // missing text
      { id: 'c2', kind: 'element-card' },                   // missing elementId
      { id: 'f1', kind: 'future-block', anything: true },   // unknown kind
      { id: 'ok', kind: 'prose', markdown: 'kept' },
    ];
    const blocks = parsePageBlocks(raw);
    expect(blocks.map(b => b.id)).toEqual(['ok']);
    expect(parsePageBlocks(undefined)).toEqual([]);
    expect(parsePageBlocks('not-an-array')).toEqual([]);
  });

  it('normalizes invalid heading level + element-card variant to defaults', () => {
    const blocks = parsePageBlocks([
      { id: 'h', kind: 'heading', text: 't', level: 9 },
      { id: 'c', kind: 'element-card', elementId: 'e', variant: 'weird' },
    ]);
    expect((blocks[0] as { level: number }).level).toBe(1);
    expect((blocks[1] as { variant: string }).variant).toBe('compact');
  });
});

describe('blocksOf — refs-mirror heal (id-swap correctness)', () => {
  const blocks: PageBlock[] = [
    { id: 'h', kind: 'heading', text: 'Cast', level: 1 },
    { id: 'c1', kind: 'element-card', elementId: 'old-a', variant: 'compact', fields: [] },
    { id: 'p', kind: 'prose', markdown: 'between cards' },
    { id: 'c2', kind: 'element-card', elementId: 'old-b', variant: 'full', fields: ['description'] },
  ];

  it('heals element-card ids from atlas_page_refs positionally', () => {
    // Simulates post-id-swap state: rewriteIdReferences rewrote the flat
    // refs array but couldn't reach the ids nested inside block objects.
    const page = el({
      atlas_page_blocks: blocks,
      atlas_page_refs: ['new-a', 'new-b'],
    });
    const healed = blocksOf(page);
    expect((healed[1] as { elementId: string }).elementId).toBe('new-a');
    expect((healed[3] as { elementId: string }).elementId).toBe('new-b');
  });

  it('falls back to the block id when the mirror is missing or short', () => {
    const noMirror = blocksOf(el({ atlas_page_blocks: blocks }));
    expect((noMirror[1] as { elementId: string }).elementId).toBe('old-a');
    const shortMirror = blocksOf(el({ atlas_page_blocks: blocks, atlas_page_refs: ['new-a'] }));
    expect((shortMirror[1] as { elementId: string }).elementId).toBe('new-a');
    expect((shortMirror[3] as { elementId: string }).elementId).toBe('old-b');
  });

  it('pageRefsFor mirrors element-card ids in block order', () => {
    expect(pageRefsFor(blocks)).toEqual(['old-a', 'old-b']);
  });

  it('pageBlocksPatch keeps blocks + refs + derived story in lockstep', () => {
    const patch = pageBlocksPatch(blocks, (id) => (id === 'old-a' ? 'Aralia' : null));
    expect(patch.atlas_page_blocks).toBe(blocks);
    expect(patch.atlas_page_refs).toEqual(['old-a', 'old-b']);
    expect(patch.story).toContain('# Cast');
    expect(patch.story).toContain('[ Aralia — element card ]');
    expect(patch.story).toContain('[ old-b — element card ]'); // unresolvable → id fallback
  });
});

describe('compilePageStory — the derived mirror', () => {
  it('compiles headings, prose, and cards into plain markdown', () => {
    const blocks: PageBlock[] = [
      { id: '1', kind: 'heading', text: 'Barovia', level: 1 },
      { id: '2', kind: 'prose', markdown: 'The mists never lift.' },
      { id: '3', kind: 'heading', text: 'The Count', level: 2 },
      { id: '4', kind: 'element-card', elementId: 'e-strahd', variant: 'full', fields: [] },
    ];
    const story = compilePageStory(blocks, (id) => (id === 'e-strahd' ? 'Strahd' : null));
    expect(story).toBe('# Barovia\n\nThe mists never lift.\n\n## The Count\n\n[ Strahd — element card ]');
  });

  it('skips empty prose; empty stack compiles to empty string', () => {
    expect(compilePageStory([{ id: 'p', kind: 'prose', markdown: '   ' }], () => null)).toBe('');
    expect(compilePageStory([], () => null)).toBe('');
  });
});

describe('list helpers', () => {
  it('blockSummary counts blocks', () => {
    expect(blockSummary([])).toBe('empty');
    expect(blockSummary([{ id: 'p', kind: 'prose', markdown: 'x' }])).toBe('1 block');
    expect(blockSummary([
      { id: 'p', kind: 'prose', markdown: 'x' },
      { id: 'h', kind: 'heading', text: 't', level: 1 },
    ])).toBe('2 blocks');
  });

  it('findUniquePageName avoids collisions among existing pages', () => {
    expect(findUniquePageName([])).toBe('new page');
    const pages = [
      el({ id: 'a', subtype: 'page', name: 'new page' }),
      el({ id: 'b', subtype: 'page', name: 'new page (2)' }),
      el({ id: 'c', name: 'new page (3)' }), // a STORY named like a page — ignored
    ];
    expect(findUniquePageName(pages)).toBe('new page (3)');
  });
});

describe('populatedCardFields — the card field checklist source', () => {
  it('offers populated content fields; skips meta, sync stamps, atlas-local, and empties', () => {
    const char = el({
      type: 'character',
      description: 'A masked rebel.',
      birthplace: 'loc-1',
      species: ['sp-1'],
      titles: [],                          // empty array → skipped
      age: 31,
      physicality: '   ',                  // whitespace-only → skipped
      image_url: 'https://x/img.png',      // rendered as the card image, not a field
      local_updated_at: '2026-01-01',      // sync stamp → skipped
      atlas_aliases: ['The Mask'],         // atlas-local → skipped
      image_media_id: 'm-1',               // atlas-local → skipped
    });
    expect(populatedCardFields(char)).toEqual(['description', 'birthplace', 'species', 'age']);
  });
});
