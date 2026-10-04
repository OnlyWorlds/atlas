/**
 * Making a world in browser storage (1.17 bout 2, conv. 129; contract §2.2).
 * A make holds its lock and its `.atlas/making` marker until the registry
 * save; any failure leaves no directory and no entry; a full origin is fatal
 * to the whole import and says so (S370 gate A6, B1, B8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { parsePayload } from '../../src/import/parse';
import { reconcile } from '../../src/import/reconcile';
import { setActiveStore } from '../../src/core/active-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async () => null,
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
}));
vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  return { FsFolderStore: MockFolderStore };
});

import { createWorldInRoot, createWorldFromImportedData, BROWSER_STORAGE_FULL } from '../../src/setup/atlas-root-flow';
import { MockFolderStore } from '../fixtures/mock-folder-store';

let root: FakeDirHandle;
const home = () => root.children.get(BROWSER_HOME) as FakeDirHandle | undefined;

beforeEach(() => {
  root = new FakeDirHandle('opfs');
  setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [] });
});
afterEach(() => {
  setOpfsRootForTests(null);
  vi.restoreAllMocks();
});

function plan(n: number) {
  return reconcile(
    parsePayload({
      World: { name: 'Hollow Reach' },
      Character: Array.from({ length: n }, (_, i) => ({ id: `068e5012-d77c-799d-8000-95548fbae7${String(i).padStart(2, '0')}`, name: `C${i}` })),
    }),
    [],
    { genId: () => 'gen-1' },
  );
}

describe('createWorldInRoot into the browser', () => {
  it('lands a browser world in a nonced directory, marker gone, entry where: browser', async () => {
    const { entry } = await createWorldInRoot('Hollow Reach', { where: 'browser' });
    expect(entry.where).toBe('browser');
    expect(entry.folder.folder_name).toMatch(/^hollow-reach-[0-9a-f]{8}-[0-9a-f]{4}$/);
    expect(entry.folder.last_path_hint).toBe(`browser storage/${entry.folder.folder_name}`);
    const dir = home()!.children.get(entry.folder.folder_name) as FakeDirHandle;
    expect(dir).toBeTruthy();
    expect(dir.get('.atlas/making')).toBeNull();
    expect(getState().registry.worlds.map(w => w.id)).toEqual([entry.id]);
    expect(getState().registry.active_world_id ?? entry.id).toBe(entry.id);
  });
});

describe('createWorldFromImportedData into the browser', () => {
  it('a full origin is fatal: no entry, no directory, the storage-full sentence', async () => {
    let calls = 0;
    const real = MockFolderStore.prototype.createElement;
    vi.spyOn(MockFolderStore.prototype, 'createElement').mockImplementation(async function (this: MockFolderStore, ...args: Parameters<typeof real>) {
      if (++calls === 2) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return real.apply(this, args);
    });
    await expect(createWorldFromImportedData(plan(3), { where: 'browser' }))
      .rejects.toMatchObject({ name: 'PlainError', message: BROWSER_STORAGE_FULL('importing the world') });
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
  });

  it('any other failure also leaves nothing behind, and keeps its own error', async () => {
    vi.spyOn(MockFolderStore.prototype, 'writeWorldMeta').mockRejectedValue(new DOMException('gone', 'InvalidStateError'));
    await expect(createWorldFromImportedData(plan(1), { where: 'browser' })).rejects.toMatchObject({ name: 'InvalidStateError' });
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
  });

  it('a whole import lands as a browser world', async () => {
    const { entry, applied } = await createWorldFromImportedData(plan(3), { where: 'browser' });
    expect(entry.where).toBe('browser');
    expect(applied.created).toBe(3);
    expect(applied.failures).toEqual([]);
  });
});
