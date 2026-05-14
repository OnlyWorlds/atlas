/**
 * sync-attach flush-on-attach regression test (Bout W2).
 *
 * The autosave debounce timer lives in memory. Reloads / world switches /
 * crashes during the 5s window leave writes stranded — `local_updated_at >
 * server_updated_at` on disk but the api never received them. Without a
 * recovery path, those writes sit dead forever (manual sync-pill click is
 * pull-only).
 *
 * Fix: on every non-paused engine attach, fire a pushOnce() iff there are
 * pending changes or tombstones. Symmetric to pull-on-activate but
 * UNCONDITIONAL — pending local writes already encode user intent.
 *
 * This test covers:
 *   - pending element → pushOnce fires on attach
 *   - pending tombstone → pushOnce fires on attach
 *   - clean folder → no push
 *   - paused world → no push (user is intentionally offline)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  attachSyncEngine,
  detachSyncEngine,
  getCurrentSyncEngine,
} from '../../src/sync/sync-attach';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin, setSyncPauseAll } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry } from '../../src/core/types';

function makeEntry(): WorldRegistryEntry {
  return {
    id: 'w1',
    name: 'Test World',
    state: 'api-linked',
    api: { world_id: 'srv-1', api_key: 'k1' },
    folder: { handle_key: 'vault-1', folder_name: 'test-world' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

const noopResult = {
  pushed: { creates: 0, updates: 0, deletes: 0 },
  pulled: { creates: 0, updates: 0, deletes: 0 },
  conflicts: [],
  failures: [],
};

async function flushMicrotasks(): Promise<void> {
  // The flush-on-attach helper awaits two folder reads (listLocallyChangedSince
  // + listTombstonesSince) before calling pushOnce. Yield a few times to clear.
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  detachSyncEngine();
  patchSlice('registry', setPin(defaultRegistry(), '1234'));
});

afterEach(() => {
  detachSyncEngine();
  vi.restoreAllMocks();
});

describe('sync-attach: flush pending writes on engine attach', () => {
  it('fires pushOnce when the folder has a locally-changed element', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    // Simulate a write that survived a reload — local edit pending, never synced.
    await folder.createElement('character', { name: 'Stranded' });

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);

    await flushMicrotasks();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('fires pushOnce when the folder has a pending tombstone', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    const el = await folder.createElement('character', { name: 'Doomed' });
    // Pretend it was previously synced, then deleted locally.
    await folder.stampServerUpdatedAt(el.id, 'character', '2026-01-01T00:00:00.000Z');
    await folder.deleteElement(el.id);
    expect((await folder.listLocallyChangedSince(null)).length).toBe(0);
    expect((await folder.listTombstonesSince(null)).length).toBe(1);

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);

    await flushMicrotasks();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('does not fire pushOnce when the folder is clean', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);

    await flushMicrotasks();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does not fire pushOnce when sync is globally paused', async () => {
    patchSlice('registry', setSyncPauseAll(setPin(defaultRegistry(), '1234'), true));
    const folder = new MockFolderStore();
    await folder.open(null);
    await folder.createElement('character', { name: 'Quiet' });

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);

    await flushMicrotasks();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('does not fire pushOnce when the world has per-world pause set', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    await folder.createElement('character', { name: 'World-paused' });

    attachSyncEngine({ ...makeEntry(), sync_paused: true }, folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);

    await flushMicrotasks();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
