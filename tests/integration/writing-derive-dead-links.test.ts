/**
 * S364 lane A2: the 1.9 delete scrub (conv. 101) empties a scene's link
 * fields and deliberately leaves its prose chips alone. Opening the scene ran
 * the prose derive (conv. 50) as a self-heal, which unioned every chip's id
 * back into the fields with no existence check: the deleted character came
 * back on disk, and on a linked world keel refused the scene every round.
 * Real writing room, no keystroke.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountWritingWorkspace } from '../../src/middle/writing-workspace';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { findDanglingLinks } from '../../src/store/scrub-links';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const WID = 'w-dead-links';

describe('opening a scene after a delete', () => {
  it('does not write the deleted character back into the scene\'s links', async () => {
    const store = new MockFolderStore();
    await store.open(null as never);
    setActiveStore(store as unknown as FsFolderStore);
    const ann = await store.createElement('character', { name: 'Ann' });
    const bo = await store.createElement('character', { name: 'Bo' });
    const scene = await store.createElement('narrative', {
      name: 'Scene 1',
      // Bo is chipped but not yet in the field: the self-heal must still add him.
      story: `[Ann](ow://character/${ann.id}) walks in. [Bo](ow://character/${bo.id}) waits.`,
      characters: [ann.id],
    } as Partial<Element>);
    await store.deleteElement(ann.id);
    expect(((await store.getElement(scene.id)) as Record<string, unknown>).characters).toEqual([]);

    const entry = { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
    patchSlice('active', { worldId: WID, meta: await store.readWorldMeta(), opened: true } as never);
    patchSlice('data', { elements: await store.listElements() });
    window.location.hash = `#/w/${WID}/writing/${scene.id}`;

    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountWritingWorkspace(host);
    await new Promise(r => setTimeout(r, 300));
    const onDisk = (await store.getElement(scene.id)) as Record<string, unknown>;
    const dangling = findDanglingLinks(await store.listElements());
    unmount();
    host.remove();
    expect(onDisk.characters).toEqual([bo.id]);
    expect(dangling).toEqual([]);
  });
});
