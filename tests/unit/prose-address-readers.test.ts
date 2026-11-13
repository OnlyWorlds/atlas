// The context pane's readers of a story's addresses (1.124.2): mention counts
// and Featured read an address as the SDK does (core/ow-links), never by a
// pattern or a substring of their own.
import { describe, expect, it } from 'vitest';
import { buildMentionCounts } from '../../src/tabs/right/context-pane-lists';
import { isElementFeatured } from '../../src/tabs/right/context-pane-preview';
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
