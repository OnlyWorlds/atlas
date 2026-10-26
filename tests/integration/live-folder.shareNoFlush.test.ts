// Promoted from a gate probe `b-share-flush.probe.test.ts`: it asserts the fixed behaviour.
/**
 * Lens B probe: the share room's leave-flush writes the page whenever a text
 * block is open, typed or not. The live folder runs that flush on every
 * focus pass, so an untouched open block rewrites the page (fresh
 * local_updated_at, a push on linked worlds) and an outside edit to the page
 * made meanwhile is overwritten before the rescan can see it.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountShareRoom } from '../../src/middle/share-room';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { flushBeforeLeavingWorld } from '../../src/core/leave-flush';
import { defaultRegistry } from '../../src/core/types';
import { ToastManager } from '../../src/ui/toast-manager';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const WID = 'w-share';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('share room flush-first', () => {
  it('an open, untouched text block: a focus-pass flush rewrites the page over an outside edit', async () => {
    const store = new MockFolderStore();
    await store.open(null as never);
    setActiveStore(store as unknown as FsFolderStore);
    const entry = { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
    patchSlice('active', { worldId: WID, meta: await store.readWorldMeta(), opened: true } as never);
    const pageEl = await store.createElement('narrative', {
      name: 'Page', subtype: 'page', story: 'Hello.', atlas_page_intent: 'show',
      atlas_page_blocks: [{ id: 'b1', kind: 'prose', markdown: 'Hello.' }], atlas_page_refs: [],
    } as Partial<Element>);
    patchSlice('data', { elements: await store.listElements(), loading: false } as never);
    window.location.hash = `#/w/${WID}/share/${pageEl.id}`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountShareRoom(host, new ToastManager());
    await wait(200);
    // Open the text block for editing (click its content).
    const content = host.querySelector<HTMLElement>('[data-block-id="b1"] .atlas-share-block-content, .atlas-share-block-content, .atlas-share-prose');
    content?.click();
    await wait(200);
    const open = !!host.querySelector('.atlas-share-prose-rich .ProseMirror, .ProseMirror');
    const before = (await store.getElement(pageEl.id)) as Record<string, unknown>;
    // An outside tool rewrites the page's story (the synced field) meanwhile.
    await store.updateElement(pageEl.id, { story: 'OUTSIDE EDIT' } as Partial<Element>);
    const stampBefore = ((await store.getElement(pageEl.id)) as Record<string, unknown>).local_updated_at;
    await flushBeforeLeavingWorld();
    await wait(50);
    const after = (await store.getElement(pageEl.id)) as Record<string, unknown>;
    console.log(`[probe S1] editor open=${open} story before=${JSON.stringify(before.story)} after flush=${JSON.stringify(after.story)} stamp moved=${stampBefore !== after.local_updated_at}`);
    unmount();
    host.remove();
    expect(after.story).toBe('OUTSIDE EDIT');
  });
});
