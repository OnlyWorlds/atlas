/**
 * The big-batch question counted once across the hold at open and the revive pass.
 * Each asserts the fixed behaviour; red on the code before the fixes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachSyncEngine, detachSyncEngine, getCurrentSyncEngine } from '../../src/sync/sync-attach';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { setActiveStore } from '../../src/core/active-store';
import { BIG_BATCH, __resetLiveFolderForTests, answerHeldBatch, getDiskNotice, rescanNow } from '../../src/core/live-folder';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const entry: WorldRegistryEntry = {
  id: 'w1', name: 'Test World', state: 'api-linked',
  api: { world_id: 'srv-1', api_key: 'k1' },
  folder: { handle_key: 'vault-1', folder_name: 'test-world' },
  created_at: '2026-01-01T00:00:00Z',
};
const noopResult = { pushed: { creates: 0, updates: 0, deletes: 0 }, pulled: { creates: 0, updates: 0, deletes: 0 }, conflicts: [], failures: [] };
const settle = async () => { for (let i = 0; i < 40; i++) { await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); } };

beforeEach(() => {
  detachSyncEngine();
  __resetLiveFolderForTests();
  patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [entry] }, '1234'));
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'Test World' }, opened: true } as never);
  patchSlice('data', { elements: [], loading: false } as never);
});
afterEach(() => { detachSyncEngine(); vi.restoreAllMocks(); patchSlice('active', null); });

describe('C1: switch back to a parked linked world that an agent edited (>BIG_BATCH files)', () => {
  it('one question, counted once, and answering it releases sync', async () => {
    const n = BIG_BATCH + 1;
    const folder = new MockFolderStore();
    await folder.open(null);
    const ids: string[] = [];
    for (let i = 0; i < n; i++) ids.push((await folder.createElement('character', { name: `c${i}` })).id);
    // The parked store's revive pass finds the agent's edits on disk.
    folder.rescanDisk = async () => ({ changes: ids.map(id => ({ kind: 'changed', id, type: 'character' })) as never });
    setActiveStore(folder as unknown as FsFolderStore);
    const pushSpy = vi.spyOn((await import('../../src/sync/sync-engine')).SyncEngine.prototype, 'pushOnce').mockResolvedValue(noopResult as never);

    // activateWorld: attach (flush-on-attach chain starts), then the forced revive pass.
    attachSyncEngine(entry, folder);
    const pass = rescanNow({ force: true });
    await pass;
    await settle();

    expect(pushSpy).not.toHaveBeenCalled();
    const count = getDiskNotice()?.held?.count;
    await answerHeldBatch(true);
    await settle();
    expect(getCurrentSyncEngine()!.isHeld()).toBe(false);
    expect(getState().registry.worlds[0].sync_paused).toBeFalsy();
    expect(count).toBe(n); // the same 51 elements, not 51 + 51
  });
});
