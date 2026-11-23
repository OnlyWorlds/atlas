/**
 * A removal that saves the registry and then deletes the world's vault
 * handle waits for the registry's landed copy between the two
 * (`src/registry/registry-copy.ts`), and takes the world out of state before
 * that wait, so no save from the old state puts it back meanwhile.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REGISTRY_COPY_DB } from '../../src/core/constants';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { getState, patchSlice } from '../../src/core/state';
import { loadRegistry, saveRegistry, __setRegistryTabBaseForTests } from '../../src/registry/registry';
import { __resetRegistryCopyForTests } from '../../src/registry/registry-copy';
import { deleteHandle } from '../../src/store/handle-vault';
import { wireWorldTab } from '../../src/middle/settings-world';
import type { ToastManager } from '../../src/ui/toast-manager';
import { slowIdbOpens } from '../fixtures/slow-idb-open';

vi.mock('../../src/store/handle-vault', async (orig) => ({
  ...(await orig<typeof import('../../src/store/handle-vault')>()),
  deleteHandle: vi.fn(async () => {}),
}));
vi.mock('../../src/setup/atlas-root-flow', async (orig) => ({
  ...(await orig<typeof import('../../src/setup/atlas-root-flow')>()),
  whyWorldFolderNotDeletable: async () => null,
  deleteWorldFolderUnderRoot: async () => {},
}));

const world: WorldRegistryEntry = {
  id: 'w-1', name: 'Harbour', state: 'local-only', created_at: '2026-01-01T00:00:00.000Z',
  folder: { handle_key: 'world-w-1', folder_name: 'harbour' },
} as WorldRegistryEntry;
const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const dropCopy = (): Promise<void> => new Promise(resolve => {
  const req = indexedDB.deleteDatabase(REGISTRY_COPY_DB);
  req.onsuccess = () => resolve();
  req.onerror = () => resolve();
  req.onblocked = () => resolve();
});

beforeEach(async () => {
  localStorage.clear();
  __resetRegistryCopyForTests();
  __setRegistryTabBaseForTests(null);
  await dropCopy();
  vi.mocked(deleteHandle).mockClear();
  loadRegistry();
  const reg: WorldsRegistry = { ...defaultRegistry(), worlds: [world] };
  saveRegistry(reg);
  patchSlice('registry', reg);
  await sleep(20);
});
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  patchSlice('registry', defaultRegistry());
});

for (const c of [
  { what: 'Forget', action: 'delete-world' },
  { what: 'Delete permanently', action: 'delete-world-permanent' },
]) {
  describe(c.what, () => {
    it('takes the world out of state at once, and deletes its handle only once the copy holds the save', async () => {
      document.body.innerHTML = `<div class="atlas-settings"><button data-action="${c.action}"></button></div>`;
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const slow = slowIdbOpens(300);
      try {
        wireWorldTab(world, toasts);
        document.querySelector<HTMLButtonElement>(`[data-action="${c.action}"]`)!.click();
        await sleep(100);
        // The copy's write is still opening: the handle stays, and state already lacks the world.
        expect(deleteHandle).not.toHaveBeenCalled();
        expect(getState().registry.worlds.map(w => w.id)).toEqual([]);
        await vi.waitFor(() => expect(deleteHandle).toHaveBeenCalledWith('world-w-1'), { timeout: 2000 });
      } finally {
        slow.restore();
      }
    });
  });
}
