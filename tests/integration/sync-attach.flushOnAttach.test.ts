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

describe('sync-attach: world settings waiting in world.json count as pending', () => {
  // Make online's own round only seeds the settings, and another tool can write
  // world.json while Atlas is closed: with no element pending, the flush used to
  // return, and the settings waited for an unrelated element edit.
  async function seededFolder(meta: Record<string, unknown>): Promise<MockFolderStore> {
    const folder = new MockFolderStore();
    await folder.open(null);
    // What a seed round leaves against a new, empty world: baselines that hold nothing.
    await folder.updateSyncState(() => ({ meta_baseline: {}, meta_ext_baseline: {} }));
    await folder.writeWorldMeta(meta as never);
    return folder;
  }

  async function settle(): Promise<void> {
    for (let i = 0; i < 40; i++) await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 40; i++) await Promise.resolve();
  }

  it('fires pushOnce for an x_ key the world never sent, with no element pending', async () => {
    const folder = await seededFolder({ x_time_unit: 'spring' });
    expect((await folder.listLocallyChangedSince(null)).length).toBe(0);

    attachSyncEngine(makeEntry(), folder, { justLinked: true });
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);

    await settle();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('fires pushOnce for a setting field the world never sent', async () => {
    const folder = await seededFolder({ description: 'A tidal road' });

    attachSyncEngine(makeEntry(), folder);
    const engine = getCurrentSyncEngine()!;
    const pushSpy = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noopResult);

    await settle();
    expect(pushSpy).toHaveBeenCalledTimes(1);
  });

  it('sends one state of the settings at open once: a refused state is not resent at every open, a new change is', async () => {
    // A member's description edit keel refuses owner_only leaves the baseline where it was:
    // without the claim, every open would PATCH it again and toast the refusal again.
    const folder = await seededFolder({ description: 'Refused for a member' });
    const opens: number[] = [];
    for (let i = 0; i < 3; i++) {
      attachSyncEngine(makeEntry(), folder);
      const spy = vi.spyOn(getCurrentSyncEngine()!, 'pushOnce').mockResolvedValue(noopResult);
      await settle();
      opens.push(spy.mock.calls.length);
      detachSyncEngine();
    }
    expect(opens).toEqual([1, 0, 0]);

    await folder.writeWorldMeta({ description: 'Changed again' } as never);
    attachSyncEngine(makeEntry(), folder);
    const after = vi.spyOn(getCurrentSyncEngine()!, 'pushOnce').mockResolvedValue(noopResult);
    await settle();
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the settings match the baseline, nor before any seed', async () => {
    const clean = new MockFolderStore();
    await clean.open(null);
    await clean.updateSyncState(() => ({ meta_baseline: {}, meta_ext_baseline: {} }));
    attachSyncEngine(makeEntry(), clean);
    const spyClean = vi.spyOn(getCurrentSyncEngine()!, 'pushOnce').mockResolvedValue(noopResult);
    await settle();
    expect(spyClean).not.toHaveBeenCalled();
    detachSyncEngine();

    // No baseline yet: the seed has not run, so nothing is known to be waiting.
    const unseeded = new MockFolderStore();
    await unseeded.open(null);
    await unseeded.writeWorldMeta({ x_time_unit: 'spring' } as never);
    attachSyncEngine(makeEntry(), unseeded);
    const spyUnseeded = vi.spyOn(getCurrentSyncEngine()!, 'pushOnce').mockResolvedValue(noopResult);
    await settle();
    expect(spyUnseeded).not.toHaveBeenCalled();
  });
});
