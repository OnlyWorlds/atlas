/**
 * The big-batch question at OPEN (Titus's yes): more than
 * BIG_BATCH elements waiting to upload when a linked world opens (an agent
 * re-parsed the folder while Atlas was closed) wait for Upload them / Stay
 * offline, as the same batch seen with the window open does. At or under the
 * line, the flush uploads as before.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachSyncEngine, detachSyncEngine, getCurrentSyncEngine } from '../../src/sync/sync-attach';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { BIG_BATCH, __resetLiveFolderForTests, answerHeldBatch } from '../../src/core/live-folder';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry } from '../../src/core/types';
import { getState } from '../../src/core/state';

const entry: WorldRegistryEntry = {
  id: 'w1', name: 'Test World', state: 'api-linked',
  api: { world_id: 'srv-1', api_key: 'k1' },
  folder: { handle_key: 'vault-1', folder_name: 'test-world' },
  created_at: '2026-01-01T00:00:00Z',
};
const noopResult = { pushed: { creates: 0, updates: 0, deletes: 0 }, pulled: { creates: 0, updates: 0, deletes: 0 }, conflicts: [], failures: [] };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };

async function folderWith(n: number): Promise<MockFolderStore> {
  const folder = new MockFolderStore();
  await folder.open(null);
  for (let i = 0; i < n; i++) await folder.createElement('character', { name: `c${i}` });
  return folder;
}

beforeEach(() => {
  detachSyncEngine();
  __resetLiveFolderForTests();
  patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [entry] }, '1234'));
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'Test World' }, opened: true } as never);
});
afterEach(() => { detachSyncEngine(); vi.restoreAllMocks(); patchSlice('active', null); });

describe('flush on attach, by batch size', () => {
  it(`more than ${BIG_BATCH} waiting: nothing uploads, the world asks`, async () => {
    const folder = await folderWith(BIG_BATCH + 1);
    const pushSpy = vi.spyOn((await import('../../src/sync/sync-engine')).SyncEngine.prototype, 'pushOnce').mockResolvedValue(noopResult as never);
    attachSyncEngine(entry, folder);
    await settle();
    expect(pushSpy).not.toHaveBeenCalled();
    const { getDiskNotice } = await import('../../src/core/live-folder');
    expect(getDiskNotice()?.held?.count).toBe(BIG_BATCH + 1);
    // The question survives a reload.
    expect(JSON.parse(localStorage.getItem('atlas_disk_held') ?? '{}')).toEqual({ w1: BIG_BATCH + 1 });
    // "Upload them" answers it, and the upload actually runs.
    await answerHeldBatch(true);
    expect(getDiskNotice()?.held ?? null).toBeNull();
    expect(getState().registry.worlds[0].sync_paused).toBeFalsy();
    await settle();
    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalled());
  });

  it(`exactly ${BIG_BATCH} waiting is still "at or under the line": uploads`, async () => {
    const folder = await folderWith(BIG_BATCH);
    attachSyncEngine(entry, folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult as never);
    await settle();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('a question persisted from before a reload refuses the flush (no second question)', async () => {
    localStorage.setItem('atlas_disk_held', JSON.stringify({ w1: 60 }));
    const folder = await folderWith(BIG_BATCH + 5);
    const pushSpy = vi.spyOn((await import('../../src/sync/sync-engine')).SyncEngine.prototype, 'pushOnce');
    attachSyncEngine(entry, folder);
    await settle();
    const { getDiskNotice } = await import('../../src/core/live-folder');
    expect(getDiskNotice()?.held?.count).toBe(60);
    // pushOnce may be entered, but the hold refuses the round: nothing is sent.
    for (const call of pushSpy.mock.results) {
      const r = await (call.value as Promise<{ pushed: { creates: number; updates: number } }>);
      expect(r.pushed.creates + r.pushed.updates).toBe(0);
    }
  });

  it(`${BIG_BATCH} or fewer: uploads at once, as before`, async () => {
    const folder = await folderWith(3);
    attachSyncEngine(entry, folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult as never);
    await settle();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it(`a world kept in this browser never asks: its ${BIG_BATCH + 10} waiting are its own offline edits, and upload (1.17, gate B15)`, async () => {
    const browserEntry: WorldRegistryEntry = { ...entry, where: 'browser' };
    patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [browserEntry] }, '1234'));
    const { toastManager } = await import('../../src/ui/toast-manager');
    const said = vi.spyOn(toastManager, 'success').mockImplementation(() => {});
    const folder = await folderWith(BIG_BATCH + 10);
    attachSyncEngine(browserEntry, folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue({ ...noopResult, pushed: { creates: BIG_BATCH + 10, updates: 0, deletes: 0 } } as never);
    await settle();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    const { getDiskNotice } = await import('../../src/core/live-folder');
    expect(getDiskNotice()?.held ?? null).toBeNull();
    expect(localStorage.getItem('atlas_disk_held')).toBeNull();
    expect(said).toHaveBeenCalledWith(`Uploaded ${BIG_BATCH + 10} changes that were waiting in this browser`);
  });

  it('a linked world restored from a world file reviews its first round, then goes back to the policy (1.17, contract §5.2, gate A9)', async () => {
    const restored: WorldRegistryEntry = { ...entry, review_first_sync: true };
    patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [restored] }, '1234'));
    const folder = await folderWith(0);
    attachSyncEngine(restored, folder);
    const engine = getCurrentSyncEngine()! as unknown as { policy: string; onSyncResult: (p: string, r: unknown) => void };
    expect(engine.policy).toBe('pause-and-review');
    // A round that compared nothing (offline, busy, a dead key) reviews nothing.
    engine.onSyncResult('push', { ...noopResult, transient_blocked: true });
    engine.onSyncResult('push', { ...noopResult, auth_blocked: true });
    await settle();
    expect(engine.policy).toBe('pause-and-review');
    // A round that held a conflict keeps the review until the conflict is answered.
    const conflict = { id: 'c1', type: 'character', local_updated_at: 'x', server_updated_at: 'y' };
    engine.onSyncResult('push', { ...noopResult, conflicts: [conflict] });
    await settle();
    expect(engine.policy).toBe('pause-and-review');
    await folder.writeSyncState({ conflicts: [conflict] } as never);
    engine.onSyncResult('push', noopResult);
    await settle();
    expect(engine.policy).toBe('pause-and-review');
    expect(getState().registry.worlds[0].review_first_sync).toBe(true);
    // Answered, and a clean round: back to the policy.
    await folder.writeSyncState({ conflicts: [] } as never);
    engine.onSyncResult('push', noopResult);
    await settle();
    expect(engine.policy).toBe('local-wins');
    expect(getState().registry.worlds[0].review_first_sync).toBeUndefined();
  });

  it(`a world just moved from this browser to a folder never asks either: what waits was edited in the browser (1.17)`, async () => {
    const folder = await folderWith(BIG_BATCH + 10);
    attachSyncEngine(entry, folder, { justMoved: true });
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue({ ...noopResult, pushed: { creates: BIG_BATCH + 10, updates: 0, deletes: 0 } } as never);
    await settle();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('atlas_disk_held')).toBeNull();
  });
});

describe('the flush toast says the count in words that agree', () => {
  for (const [n, text] of [[1, 'Uploaded 1 change that was waiting in the folder'], [2, 'Uploaded 2 changes that were waiting in the folder']] as const) {
    it(`n = ${n}`, async () => {
      const { toastManager } = await import('../../src/ui/toast-manager');
      const said = vi.spyOn(toastManager, 'success').mockImplementation(() => {});
      const folder = await folderWith(n);
      attachSyncEngine(entry, folder);
      const engine = getCurrentSyncEngine()!;
      vi.spyOn(engine, 'pushOnce').mockResolvedValue({ ...noopResult, pushed: { creates: n, updates: 0, deletes: 0 } } as never);
      await settle();
      expect(said).toHaveBeenCalledWith(text);
    });
  }
});
