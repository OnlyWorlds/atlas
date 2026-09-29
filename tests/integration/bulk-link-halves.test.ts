/**
 * The bulk writers keep ONE truth (S365 gate lens A H3). "Link mentions in
 * all scenes" and "Link to element" used to rewrite `story` and the rich-text
 * sidecar separately; on a first mention in italics or bold, or a name inside
 * a web link, the halves parted, and the sidecar rule at open then reported
 * "changed outside Atlas" about a scene nobody touched. The writers now
 * transform the sidecar and derive `story` from it, so what lands on disk
 * always satisfies `story === serialize(sidecar)`; and when `story` already
 * outranks a stale sidecar, they transform `story` and drop the sidecar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/sync/sync-attach', () => ({
  refreshElementsAfterWrite: async () => {},
  requestPushIfLinked: () => {},
}));

import type { JSONContent } from '@tiptap/core';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { bulkLinkNarratives, bulkLinkTerm } from '../../src/middle/writing-bulk-link';
import { serializeDocToMarkdown } from '../../src/middle/writing-workspace-markdown';
import { storyOutranksSidecar } from '../../src/middle/story-sidecar';
import type { Element } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const p = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const t = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'text', text, ...(marks ? { marks } : {}) });

let store: MockFolderStore;
let gil: Element;

async function scene(doc: JSONContent, storyOverride?: string): Promise<string> {
  const el = await store.createElement('narrative', {
    name: 'scene', supertype: 'Book',
    story: storyOverride ?? serializeDocToMarkdown(doc),
    atlas_richtext_json: doc,
  } as Partial<Element>);
  return el.id;
}
async function halves(id: string): Promise<{ story: string; sidecar: JSONContent | null }> {
  const el = await store.getElement(id) as Record<string, unknown>;
  return { story: String(el.story ?? ''), sidecar: (el.atlas_richtext_json as JSONContent | null) ?? null };
}

beforeEach(async () => {
  store = new MockFolderStore();
  await store.open(null);
  setActiveStore(store as unknown as FsFolderStore);
  gil = await store.createElement('character', { name: 'Gilgamesh' });
  patchSlice('data', { elements: await store.listElements(), loading: false } as never);
});

describe('what lands on disk keeps story === serialize(sidecar)', () => {
  for (const mark of ['italic', 'bold'] as const) {
    it(`link mentions, first mention in ${mark}`, async () => {
      const id = await scene({ type: 'doc', content: [p(t('At dawn '), t('Gilgamesh', [{ type: mark }]), t(' crossed.'), { type: 'hardBreak' }, t('Second line.'))] });
      const r = await bulkLinkNarratives([id], 'link');
      expect(r.count).toBe(1);
      const { story, sidecar } = await halves(id);
      expect(story).toBe(serializeDocToMarkdown(sidecar!));
      expect(storyOutranksSidecar(sidecar, story)).toBe(false);
      expect(story).toContain(`ow://character/${gil.id}`);
    });
  }

  it('link to element, the term in italics', async () => {
    const id = await scene({ type: 'doc', content: [p(t('At dawn '), t('Gilgamesh', [{ type: 'italic' }]), t(' crossed.'))] });
    const r = await bulkLinkTerm([id], 'Gilgamesh', { id: gil.id, type: 'character' } as never, {});
    expect(r.count).toBe(1);
    const { story, sidecar } = await halves(id);
    expect(story).toBe(serializeDocToMarkdown(sidecar!));
  });

  it('a name inside a web link is left alone; the plain mention after it is linked', async () => {
    const id = await scene({ type: 'doc', content: [p(t('See '), t('Gilgamesh wiki', [{ type: 'link', attrs: { href: 'https://example.org/g' } }]), t('. Later Gilgamesh left.'))] });
    await bulkLinkNarratives([id], 'link');
    const { story, sidecar } = await halves(id);
    expect(story).toBe(serializeDocToMarkdown(sidecar!));
    expect(story).toContain('(https://example.org/g)');
    expect(story).toContain(`[Gilgamesh](ow://character/${gil.id}) left`);
  });

  it('unlink keeps the halves together too', async () => {
    const id = await scene({ type: 'doc', content: [p(t('Gilgamesh', [{ type: 'italic' }]), t(' crossed.'))] });
    await bulkLinkNarratives([id], 'link');
    await bulkLinkNarratives([id], 'unlink');
    const { story, sidecar } = await halves(id);
    expect(story).toBe(serializeDocToMarkdown(sidecar!));
  });
});

describe('a story edited outside outranks the stale sidecar', () => {
  it('the writer links the STORY and drops the stale sidecar', async () => {
    const doc: JSONContent = { type: 'doc', content: [p(t('Old text.'))] };
    const id = await scene(doc, 'An agent wrote: Gilgamesh returned.');
    await bulkLinkNarratives([id], 'link');
    const { story, sidecar } = await halves(id);
    expect(story).toBe(`An agent wrote: [Gilgamesh](ow://character/${gil.id}) returned.`);
    expect(sidecar).toBeNull();
  });
});
