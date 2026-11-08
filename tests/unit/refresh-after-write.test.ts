/**
 * refreshElementsAfterWrite after a world switch: a write that finishes once another world is open
 * hands back its own world's elements but never puts them into the open world's state (they would
 * show in its lists and pickers until the next refresh; the S521 strand gate's D4).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { refreshElementsAfterWrite } from '../../src/sync/sync-attach';
import { getState, patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import type { Element } from '../../src/core/types';

const el = (id: string, name: string) => ({ id, type: 'character', name }) as unknown as Element;

afterEach(() => {
  setActiveStore(null);
  patchSlice('data', { elements: [] });
});

describe('refreshElementsAfterWrite', () => {
  it('a write in the open world refreshes its elements', async () => {
    const w1 = new MockFolderStore();
    await w1.createElement('character', { name: 'Ada' });
    setActiveStore(w1 as unknown as FsFolderStore);
    const got = await refreshElementsAfterWrite(w1);
    expect(got.map(e => e.name)).toEqual(['Ada']);
    expect(getState().data.elements.map(e => e.name)).toEqual(['Ada']);
  });

  it('a write that finishes after a switch to another world leaves the open world\'s elements alone', async () => {
    const w1 = new MockFolderStore();
    const w2 = new MockFolderStore();
    await w1.createElement('character', { name: 'Ada' });
    setActiveStore(w2 as unknown as FsFolderStore);
    patchSlice('data', { elements: [el('b', 'Bea')] });
    const got = await refreshElementsAfterWrite(w1);
    expect(got.map(e => e.name)).toEqual(['Ada']);
    expect(getState().data.elements.map(e => e.name)).toEqual(['Bea']);
  });
});
