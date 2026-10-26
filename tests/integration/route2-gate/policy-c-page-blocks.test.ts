/**
 * Policy c and page blocks, after Titus's ruling (2026-10-04).
 *
 * The finding: policy c ("keep the online version") gave up a page's local
 * rich text but KEPT its local blocks. A page's `story` is compiled from its
 * blocks on every save (`pageBlocksPatch`), so the next save put the local
 * page back over the server's text.
 *
 * The ruling: "keep online" drops the page's local blocks too, and the page
 * takes the online text: its blocks are rebuilt from the server's `story`
 * (one prose block), so the next save compiles that same text back. Pages
 * only, policy c only.
 */
import { describe, it, expect } from 'vitest';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { blocksOf, pageBlocksPatch } from '../../../src/core/sharing';
import type { FsFolderStore } from '../../../src/store/folder-store-fs';
import { freshServer, world, putEl, open, srv } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const O = '00000000-0000-4000-8000-00000000e001'; // the local page
const N = '00000000-0000-4000-8000-00000000f001'; // the server page, same name
const A = '00000000-0000-4000-8000-00000000e002'; // a character the local page cards
const SAME = '00000000-0000-4000-8000-00000000e003'; // a page with one id on both sides

const localPage = (id: string) => ({
  id, type: 'narrative', name: id === SAME ? 'Notes' : 'Home', subtype: 'page',
  story: '# Local\n\nlocal text',
  atlas_page_intent: 'show',
  atlas_page_blocks: [
    { id: 'b1', kind: 'heading', text: 'Local', level: 1 },
    { id: 'b2', kind: 'prose', markdown: 'local text', richtextJson: null },
    { id: 'b3', kind: 'element-card', elementId: A, variant: 'compact', fields: [] },
  ],
  atlas_page_refs: [A],
});

/** What the share room does on a blocks save. */
async function savePage(s: FsFolderStore, id: string): Promise<void> {
  const page = (await s.getElement(id))!;
  await s.updateElement(id, pageBlocksPatch(blocksOf(page), () => null));
}

describe('policy c on a page: the local blocks go with the local text (A9)', () => {
  it('a name-matched page takes the online text, and its next save does not overwrite it', async () => {
    const { server, adapter } = freshServer();
    await adapter.createElement('narrative', { id: N, name: 'Home', subtype: 'page', story: 'The online page.\n\nSecond paragraph.' });
    const root = world();
    putEl(root, { id: A, type: 'character', name: 'Alice' });
    putEl(root, localPage(O));
    const s = await open(root);
    const m = await mergeLocalIntoApi(s, adapter, 'c', { worldId: 'w1' });
    expect(m.failures).toEqual([]);
    expect(m.rekeyed.get(O)).toBe(N);

    const page = (await s.getElement(N))! as unknown as Record<string, unknown>;
    // Soft, so a failure also shows what the next save does to the server.
    expect.soft(page.story).toBe('The online page.\n\nSecond paragraph.');
    expect.soft(page.atlas_page_refs, 'the refs mirror goes with the blocks').toEqual([]);
    const blocks = blocksOf(page as never);
    expect.soft(blocks.map(b => b.kind), 'no local block survives').toEqual(['prose']);
    expect.soft((blocks[0] as { markdown: string }).markdown).toBe('The online page.\n\nSecond paragraph.');
    expect.soft(page.atlas_page_intent, 'the page stays a page').toBe('show');

    await savePage(s, N);
    await new SyncEngine({ folder: s, client: adapter }).syncNow();
    expect.soft((await s.getElement(N))!.story).toBe('The online page.\n\nSecond paragraph.');
    expect(srv(server, 'narrative').get(N)?.story, 'the server keeps its text').toBe('The online page.\n\nSecond paragraph.');
  });

  it('an id-matched page with an empty online story is left with no blocks', async () => {
    const { adapter } = freshServer();
    await adapter.createElement('narrative', { id: SAME, name: 'Notes', subtype: 'page', story: '' });
    const root = world();
    putEl(root, { id: A, type: 'character', name: 'Alice' });
    putEl(root, localPage(SAME));
    const s = await open(root);
    const m = await mergeLocalIntoApi(s, adapter, 'c', { worldId: 'w1' });
    expect(m.failures).toEqual([]);
    const page = (await s.getElement(SAME))! as unknown as Record<string, unknown>;
    expect(page.atlas_page_blocks).toEqual([]);
    expect(page.atlas_page_refs).toEqual([]);
  });

  it('policy b keeps the local blocks and sends the local text (unchanged)', async () => {
    const { server, adapter } = freshServer();
    await adapter.createElement('narrative', { id: N, name: 'Home', subtype: 'page', story: 'The online page.' });
    const root = world();
    putEl(root, { id: A, type: 'character', name: 'Alice' });
    putEl(root, localPage(O));
    const s = await open(root);
    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures).toEqual([]);
    const page = (await s.getElement(N))! as unknown as Record<string, unknown>;
    expect(blocksOf(page as never).map(b => b.id)).toEqual(['b1', 'b2', 'b3']);
    expect(page.atlas_page_refs).toEqual([A]);
    expect(srv(server, 'narrative').get(N)?.story).toBe('# Local\n\nlocal text');
  });

  it('policy c on a narrative that is not a page leaves its atlas fields alone', async () => {
    const { adapter } = freshServer();
    await adapter.createElement('narrative', { id: N, name: 'Home', story: 'online scene' });
    const root = world();
    putEl(root, { id: O, type: 'narrative', name: 'Home', story: 'local scene', atlas_aliases: ['Hearth'] });
    const s = await open(root);
    await mergeLocalIntoApi(s, adapter, 'c', { worldId: 'w1' });
    const el = (await s.getElement(N))! as unknown as Record<string, unknown>;
    expect(el.story).toBe('online scene');
    expect(el.atlas_aliases).toEqual(['Hearth']);
    expect(el.atlas_page_blocks).toBeUndefined();
  });
});
