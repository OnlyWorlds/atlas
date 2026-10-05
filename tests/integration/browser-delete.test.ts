/**
 * Deleting a world kept in this browser (1.17, contract §1.2, §3.1, §9
 * invariant 11; gate B11): everything that could hold a writable closes
 * BEFORE the removal (a removal with one open fails whole); the entry leaves
 * the registry only after the directory is gone; a refused removal keeps
 * both the entry and the directory, and reports that the world was open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore, getActiveStore } from '../../src/core/active-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const order: string[] = [];
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncWorldId: () => 'w1',
  detachSyncEngine: () => { order.push('detach'); },
}));

import { deleteBrowserWorld } from '../../src/setup/browser-world-delete';

const DIR = 'hollow-reach-0192a000-1a2b';
const world: WorldRegistryEntry = {
  id: 'w1', name: 'Hollow Reach', state: 'api-linked', where: 'browser', created_at: '2026-10-05T00:00:00.000Z',
  api: { world_id: 'srv-1', api_key: 'k' },
  folder: { handle_key: 'world-0192a000', folder_name: DIR, last_path_hint: `browser storage/${DIR}` },
};
let root: FakeDirHandle;
let home: FakeDirHandle;
let store: MockFolderStore;

beforeEach(async () => {
  order.length = 0;
  root = new FakeDirHandle('opfs');
  home = await root.getDirectoryHandle(BROWSER_HOME, { create: true }) as unknown as FakeDirHandle;
  const dir = await home.getDirectoryHandle(DIR, { create: true });
  const w = await (await dir.getFileHandle('world.json', { create: true })).createWritable();
  await w.write('{"id":"0192a000"}');
  await w.close();
  setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
  store = new MockFolderStore();
  await store.open(null);
  const close = store.close.bind(store);
  store.close = async () => { order.push('close'); await close(); };
  setActiveStore(store as never);
  patchSlice('registry', { ...defaultRegistry(), worlds: [world] });
  patchSlice('active', { worldId: 'w1', meta: { id: '0192a000', name: 'Hollow Reach' }, opened: true } as never);
});
afterEach(() => {
  setOpfsRootForTests(null);
  setActiveStore(null);
  patchSlice('active', null);
});

describe('deleteBrowserWorld', () => {
  it('closes everything first, then removes the directory, then drops the entry', async () => {
    const realRemove = home.removeEntry.bind(home);
    home.removeEntry = async (name: string, opts?: { recursive?: boolean }) => { order.push('remove'); return realRemove(name, opts); };
    const result = await deleteBrowserWorld(world);
    expect(result).toEqual({ ok: true });
    expect(order).toEqual(['detach', 'close', 'remove']);
    expect(home.children.has(DIR)).toBe(false);
    expect(getState().registry.worlds).toHaveLength(0);
    expect(getState().active).toBeNull();
    expect(getActiveStore()).toBeNull();
  });

  it('a refused removal keeps the entry and the directory, and says the world was open', async () => {
    home.removeEntry = async () => { throw Object.assign(new Error('busy'), { name: 'NoModificationAllowedError' }); };
    const result = await deleteBrowserWorld(world);
    expect(result).toMatchObject({ ok: false, wasActive: true });
    expect(home.children.has(DIR)).toBe(true);
    expect(getState().registry.worlds.map(w => w.id)).toEqual(['w1']);
  }, 10_000);

  it('a world that is not open is removed without touching the open one', async () => {
    patchSlice('active', { worldId: 'other', meta: { id: 'o', name: 'Other' }, opened: true } as never);
    const result = await deleteBrowserWorld(world);
    expect(result).toEqual({ ok: true });
    expect(order).not.toContain('close');
    expect(getActiveStore()).toBe(store);
    expect(home.children.has(DIR)).toBe(false);
  });

  it('refuses a folder world (Delete for a folder is a different path)', async () => {
    await expect(deleteBrowserWorld({ ...world, where: undefined })).rejects.toThrow();
  });
});
