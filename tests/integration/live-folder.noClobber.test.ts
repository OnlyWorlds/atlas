// Promoted from a gate probe `b-e2e-clobber.probe.test.ts`: it asserts the fixed behaviour.
/**
 * Lens B probe, whole chain on the REAL store: an agent edits a scene twice
 * while it is open in the writing room and nobody types. The second edit is
 * overwritten by the live folder's own flush-first and never reported.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/sync/sync-attach', async () => {
  const state = await import('../../src/core/state');
  return {
    getCurrentSyncEngine: () => null,
    getCurrentSyncWorldId: () => null,
    requestPushIfLinked: () => {},
    refreshMetaCacheNow: async () => {},
    // The writing room's strand offer asks whether a story is a kept-here copy (conv. 151): none here.
    isKeptHere: () => false,
    keptSetOf: () => undefined,
    refreshElementsAfterWrite: async (store: { listElements(): Promise<unknown[]> }) => {
      const elements = await store.listElements();
      state.patchSlice('data', { ...state.getState().data, elements } as never);
      return elements;
    },
  };
});

import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { mountWritingWorkspace } from '../../src/middle/writing-workspace';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import { rescanNow, getDiskNotice, __resetLiveFolderForTests } from '../../src/core/live-folder';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('agent edits an open scene twice, nobody types', () => {
  it('the second outside edit survives the next pass', async () => {
    localStorage.clear();
    __resetLiveFolderForTests();
    const root = new FakeDirHandle('w');
    root.put('world.json', j({ id: 'w1', name: 'W' }));
    const store = new FsFolderStore({ tabId: 'probe', disableHeartbeat: true, forceTakeLock: true });
    await store.open(root as unknown as FileSystemDirectoryHandle);
    const scene = await store.createElement('narrative', { name: 'Scene', story: 'Atlas wrote this.' } as Partial<Element>);
    setActiveStore(store);
    const entry = { id: 'W', name: 'W', state: 'local', folder: { handle_key: 'k', folder_name: 'w' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
    patchSlice('active', { worldId: 'W', meta: await store.readWorldMeta(), opened: true } as never);
    patchSlice('data', { elements: await store.listElements(), loading: false } as never);
    window.location.hash = `#/w/W/writing/${scene.id}`;
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = mountWritingWorkspace(host);
    await wait(150);
    const path = root.list().find(p => p.startsWith('elements/') && p.includes(scene.id.slice(-8)))!;

    // Agent edit 1: a markdown story ending in a newline (as most writers do).
    root.put(path, j({ ...JSON.parse(root.get(path)!), story: 'Agent draft one.\n' }));
    const pass1 = await rescanNow({ force: true });
    await wait(100);
    const shown1 = host.querySelector('.ProseMirror')?.textContent;

    // Agent edit 2, then the user comes back to the window.
    root.put(path, j({ ...JSON.parse(root.get(path)!), story: 'Agent draft TWO.\n' }));
    const pass2 = await rescanNow({ force: true });
    await wait(100);
    const disk = JSON.parse(root.get(path)!).story;
    console.log(`[probe E1] pass1=${pass1.changes.map(c => c.kind).join(',')} editor shows=${JSON.stringify(shown1)} | pass2=${JSON.stringify(pass2.changes.map(c => c.kind))} disk story=${JSON.stringify(disk)} marked=${getDiskNotice()?.marked.size ?? 0}`);
    unmount();
    host.remove();
    expect(disk).toBe('Agent draft TWO.\n');
  });
});
