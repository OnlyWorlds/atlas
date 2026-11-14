// The context pane's readers of a story's addresses (1.124.2): mention counts
// and Featured read an address as the SDK does (core/ow-links), never by a
// pattern or a substring of their own.
import { afterEach, describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { buildMentionCounts } from '../../src/tabs/right/context-pane-lists';
import { isElementFeatured } from '../../src/tabs/right/context-pane-preview';
import { computeRelationPatch, linkTargetsIn } from '../../src/middle/writing-workspace-derive';
import { convertLinkMarksToChips } from '../../src/middle/writing-workspace-load';
import { renderProseFragment } from '../../src/middle/writing-compiled';
import { mountWorkspaceEditor } from '../../src/middle/writing-workspace-editor';
import { autolinkMarkdown, buildAutolinkIndex } from '../../src/core/prose-autolink';
import { scrubMarkdownForPayload } from '../../src/core/share-payload';
import { lookupHeldId, proseNamesId } from '../../src/core/ow-links';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

const ID = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
const OTHER = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a72';
const el = (id: string, name = 'Zq'): Element => ({ id, type: 'character', name } as unknown as Element);
const scene = (story: string): Element => ({ id: 'n1', type: 'narrative', name: 'S', story } as unknown as Element);

describe('mention counts', () => {
  it('count every address naming an element, a moment and a lens included', () => {
    const counts = buildMentionCounts(`[a](ow://character/${ID}) [b](ow://character/${ID}@3) ow://character/${ID}?lens=${OTHER}.`);
    expect(counts.get(ID)).toBe(3);
  });
  it('an id in capitals counts for the lowercase element', () => {
    expect(buildMentionCounts(`[a](ow://character/${ID.toUpperCase()})`).get(ID)).toBe(1);
  });
  it('a type word in capitals, or an id run on into letters, is no mention of a longer id', () => {
    const counts = buildMentionCounts(`ow://Character/${OTHER} and ow://character/${ID}abc`);
    expect(counts.get(OTHER)).toBeUndefined();
    expect(counts.get(`${ID}abc`)).toBeUndefined();
    expect(counts.get(ID)).toBe(1);
  });
});

describe('the chip resolver: as held, then lowercase', () => {
  it('a sidecar chip saved with an id in capitals resolves to the lowercase element', async () => {
    const { mountWorkspaceEditor } = await import('../../src/middle/writing-workspace-editor');
    const chip = { type: 'elementChip', attrs: { id: ID.toUpperCase(), type: 'character', label: 'Old name' } };
    const h = mountWorkspaceEditor({
      target: document.createElement('div'),
      initialJson: { type: 'doc', content: [{ type: 'paragraph', content: [chip] }] },
      onUpdate: () => {},
    });
    const held = new Map([[ID, { name: 'Ireena', aliases: [] as string[] }]]);
    expect(h.syncChipLabels(id => held.get(id) ?? null)).toBe(1);
    h.destroy();
  });
});

describe('Featured', () => {
  it('a bare address, or one with a moment, features its element', () => {
    expect(isElementFeatured(el(ID), scene(`see ow://character/${ID}.`))).toBe(true);
    expect(isElementFeatured(el(ID), scene(`[a](ow://character/${ID}@12)`))).toBe(true);
  });
  it('an id in capitals features the lowercase element', () => {
    expect(isElementFeatured(el(ID), scene(`[a](ow://character/${ID.toUpperCase()})`))).toBe(true);
  });
  it('a type word in capitals, or any text ending in the id and a bracket, does not', () => {
    expect(isElementFeatured(el(ID), scene(`[a](ow://Character/${ID})`))).toBe(false);
    expect(isElementFeatured(el(ID), scene(`[a](https://example.com/${ID})`))).toBe(false);
  });
});

// THE RULE for an id in capitals (1.124.2), asked of every reader: an address names the element whose
// id equals its id as written; failing that, the element whose id equals its lowercase reading. Atlas
// never re-spells an id in prose. Each row gives one answer from every reader, and the editor keeps the
// id's bytes before and after an unrelated keystroke.
describe('one rule for an id in capitals, every reader', () => {
  const LO = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';
  const UP = LO.toUpperCase();
  const charOf = (id: string, name: string): Element => ({ id, type: 'character', name } as unknown as Element);
  // [row, the world's characters, the id as the prose writes it, the element it names (null: none)]
  const ROWS: Array<[string, Element[], string, string | null]> = [
    ['held lowercase, written in capitals', [charOf(LO, 'Drizzle')], UP, LO],
    ['held in capitals, written in capitals', [charOf(UP, 'Drizzle')], UP, UP],
    ['held in capitals, written lowercase', [charOf(UP, 'Drizzle')], LO, null],
    ['both held, written in capitals', [charOf(UP, 'Drizzle'), charOf(LO, 'Hal')], UP, UP],
    ['both held, written lowercase', [charOf(UP, 'Drizzle'), charOf(LO, 'Hal')], LO, LO],
  ];
  afterEach(() => { patchSlice('data', { elements: [] } as never); });

  for (const [row, world, written, named] of ROWS) {
    it(row, () => {
      patchSlice('data', { elements: world } as never);
      const story = `See [Driz](ow://character/${written}) now.`;
      const scene = { id: 'n1', type: 'narrative', name: 'S', story } as unknown as Element;
      const has = (id: string): boolean => world.some(e => e.id === id);
      const target = named ?? world[0].id;
      const expectNamed = named !== null;

      // the derive
      const patch = computeRelationPatch(scene, story, linkTargetsIn(world)) as Record<string, unknown>;
      expect(patch.characters ?? [], 'derive').toEqual(expectNamed ? [named] : []);
      // mentions and Featured, still mentioned
      expect(buildMentionCounts(story, has).get(target) ?? 0, 'mentions').toBe(expectNamed ? 1 : 0);
      for (const el of world) {
        expect(isElementFeatured(el, scene), `featured ${el.id}`).toBe(el.id === named);
        expect(proseNamesId(story, el.id, has), `still mentioned ${el.id}`).toBe(el.id === named);
      }
      // the autolink set: a named element is already linked, so its name is not linked again
      const index = buildAutolinkIndex(world);
      const linkedIds = autolinkMarkdown(`${story} Drizzle again. Hal again.`, index).linked.map(c => c.id);
      if (expectNamed) expect(linkedIds, 'autolink').not.toContain(named);
      // the chip load keeps the bytes; the chip resolves by the rule
      const doc = convertLinkMarksToChips({ type: 'doc', content: [{ type: 'paragraph', content: [
        { type: 'text', text: 'Driz', marks: [{ type: 'link', attrs: { href: `ow://character/${written}` } }] },
      ] }] });
      const chip = ((doc.content as JSONContent[])[0].content as JSONContent[])[0];
      expect(chip.attrs?.id, 'chip bytes').toBe(written);
      expect(lookupHeldId(written, id => world.find(e => e.id === id))?.id ?? null, 'chip resolves').toBe(named);
      // the compiled view and the public page
      const html = renderProseFragment(story, new Map(world.map(e => [e.id, e] as const)), { unresolved: 'text' }).outerHTML;
      if (expectNamed) expect(html, 'compiled').toContain(`data-id="${named}"`);
      else expect(html, 'compiled').not.toContain('atlas-element-chip');
      // the share scrub: on the page when the named element is
      const onPage = scrubMarkdownForPayload(story, new Set(expectNamed ? [named] : []), new Map(world.map(e => [e.id, e] as const)));
      expect(onPage, 'scrub keeps a disclosed link').toBe(expectNamed ? story : 'See Driz now.');
      // the editor keeps the id's bytes, before and after a keystroke elsewhere
      const h = mountWorkspaceEditor({ target: document.createElement('div'), initialMarkdown: story, onUpdate: () => {} });
      expect(h.getMarkdown(), 'editor before').toContain(`ow://character/${written})`);
      h.editor.commands.insertContentAt(1, 'X');
      expect(h.getMarkdown(), 'editor after').toContain(`ow://character/${written})`);
      h.destroy();
    });
  }
});
