/**
 * A background tick (a sync publish, the writing room's own
 * prose save) rebuilt the header under a focused rename input. Chromium blurs
 * a removed focused input and the blur commits, so "Strahd von Zarovich"
 * saved as "Strahd von" mid-word. jsdom does not fire that removal blur, so
 * the tests assert the input is never removed, which is the whole cause, and
 * then finish the rename to prove the full name lands.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { mountElementDetail } from '../../src/middle/element-detail';
import { mountWritingWorkspace } from '../../src/middle/writing-workspace';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const WID = 'w-rename';
const settle = () => new Promise(r => setTimeout(r, 50));

async function world(): Promise<MockFolderStore> {
  const store = new MockFolderStore();
  await store.open(null as never);
  setActiveStore(store as unknown as FsFolderStore);
  const entry = { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: WID, meta: await store.readWorldMeta(), opened: true } as never);
  return store;
}

async function startRename(host: HTMLElement): Promise<HTMLInputElement> {
  host.querySelector<HTMLElement>('.atlas-element-name')!.click();
  await Promise.resolve();
  const input = host.querySelector<HTMLInputElement>('.atlas-element-name-input')!;
  expect(input).toBeTruthy();
  expect(document.activeElement).toBe(input);
  return input;
}

describe('an inline rename survives background re-renders', () => {
  it('element detail: a sync publish mid-rename keeps the input and the full name saves', async () => {
    const store = await world();
    const el = await store.createElement('character', { name: 'Strahd' });
    patchSlice('data', { elements: await store.listElements() });
    window.location.hash = `#/w/${WID}/element/${el.id}`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountElementDetail(host);

    const input = await startRename(host);
    input.value = 'Strahd von';
    // What publishSyncState does on every engine transition.
    patchSlice('sync', { ...getState().sync, activeSync: { kind: 'syncing', phase: 'push' } as never });
    expect(input.isConnected).toBe(true);

    input.value = 'Strahd von Zarovich';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect((await store.getElement(el.id))?.name).toBe('Strahd von Zarovich');
    // The deferred render ran once focus left: the header shows the new name.
    await settle();
    expect(host.querySelector('.atlas-element-name-input')).toBeNull();
    unmount();
    host.remove();
  });

  it('writing room: the prose save landing mid-rename keeps the input and the full title saves', async () => {
    const store = await world();
    const scene = await store.createElement('narrative', { name: 'Scene', story: 'Hello.' } as Partial<Element>);
    patchSlice('data', { elements: await store.listElements() });
    window.location.hash = `#/w/${WID}/writing/${scene.id}`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountWritingWorkspace(host);
    await new Promise(r => setTimeout(r, 100));

    const input = await startRename(host);
    input.value = 'The Bu';
    // The debounced prose save lands: refreshElementsAfterWrite swaps the array.
    patchSlice('data', { ...getState().data, elements: [...getState().data.elements] });
    expect(input.isConnected).toBe(true);

    input.value = 'The Burning of Vallaki';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect((await store.getElement(scene.id))?.name).toBe('The Burning of Vallaki');
    unmount();
    host.remove();
  });
});
