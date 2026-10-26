/**
 * The attach Make Online performs does not ask "changed on disk" (promoted
 * from a probe).
 *
 * After a Route 2 whose creates FAILED (a /bulk network error here; a copied
 * folder's id_conflict does the same), every never-stamped element counts as
 * locally changed. Since 1.12 (conv. 117) an attach above BIG_BATCH holds
 * the engine and asks "Upload them / Stay offline", which right after the
 * user clicked Link was the wrong question, and it delayed the foreign-id
 * record behind the answer. The Make Online attach passes `justLinked`: the
 * flush runs unasked and reports the failures. A normal attach still asks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachSyncEngine, detachSyncEngine } from '../../src/sync/sync-attach';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { BIG_BATCH, __resetLiveFolderForTests, getDiskNotice } from '../../src/core/live-folder';
import { mergeLocalIntoApi } from '../../src/sync/make-online';
import { SyncEngine } from '../../src/sync/sync-engine';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';

const entry: WorldRegistryEntry = {
  id: 'w1', name: 'W', state: 'api-linked',
  api: { world_id: 'srv-1', api_key: 'k1' },
  folder: { handle_key: 'vault-1', folder_name: 'w' },
  created_at: '2026-01-01T00:00:00Z',
};
const noop = { pushed: { creates: 0, updates: 0, deletes: 0 }, pulled: { creates: 0, updates: 0, deletes: 0 }, conflicts: [], failures: [] };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };

async function failedMerge(n: number) {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  const folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  for (let i = 0; i < n; i++) await folder.createElement('character', { name: `c${i}` });
  const client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_bulk();
  vi.spyOn(client, 'bulkCreate').mockRejectedValue(new Error('network unreachable'));
  const m = await mergeLocalIntoApi(folder, client, 'b');
  expect(m.failures.length).toBe(n);
  return folder;
}

beforeEach(() => {
  detachSyncEngine();
  __resetLiveFolderForTests();
  localStorage.removeItem('atlas_disk_held');
  patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [entry] }, '1234'));
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
});
afterEach(() => { detachSyncEngine(); vi.restoreAllMocks(); patchSlice('active', null); localStorage.removeItem('atlas_disk_held'); });

describe('the attach after Make Online', () => {
  it(`${BIG_BATCH + 1} failed creates: the link's own attach retries them unasked`, async () => {
    const folder = await failedMerge(BIG_BATCH + 1);
    const pushSpy = vi.spyOn(SyncEngine.prototype, 'pushOnce').mockResolvedValue(noop as never);
    attachSyncEngine(entry, folder as never, { justLinked: true });
    await settle();
    expect(getDiskNotice()?.held ?? null).toBeNull();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('a question saved before the link (held, unlinked, linked again) does not come back', async () => {
    // The persisted hold was adopted before the flush, so the
    // link's own attach still asked "Upload them / Stay offline" with the old
    // count and refused the retry.
    const folder = await failedMerge(BIG_BATCH + 1);
    localStorage.setItem('atlas_disk_held', JSON.stringify({ w1: 77 }));
    const pushSpy = vi.spyOn(SyncEngine.prototype, 'pushOnce').mockResolvedValue(noop as never);
    attachSyncEngine(entry, folder as never, { justLinked: true });
    await settle();
    expect(getDiskNotice()?.held ?? null).toBeNull();
    expect(JSON.parse(localStorage.getItem('atlas_disk_held') ?? '{}').w1).toBeUndefined();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('control: the same folder opened later (a normal attach) still asks', async () => {
    const folder = await failedMerge(BIG_BATCH + 1);
    const pushSpy = vi.spyOn(SyncEngine.prototype, 'pushOnce').mockResolvedValue(noop as never);
    attachSyncEngine(entry, folder as never);
    await settle();
    expect(pushSpy).not.toHaveBeenCalled();
    expect(getDiskNotice()?.held?.count).toBe(BIG_BATCH + 1);
  });
});
