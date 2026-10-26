/**
 * SyncEngine read-only mode (view-only worlds linked with a READ key).
 *
 * The double wall: (1) the ENGINE never pushes — every trigger dies at the
 * pushOnce/requestPush boundary and the meta step never PATCHes; (2) the
 * STORE blocks UI mutations while the engine's own channels stay open.
 * A view world must never write to its owner's world, by construction.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client, readOnly: true });
});

const writeCalls = (calls: FakeOwApiClient['calls']) =>
  calls.filter(c => !['list', 'getWorldMeta', 'get'].includes(c.method));

describe('SyncEngine read-only mode', () => {
  it('pushOnce is a guaranteed no-op — nothing reaches the wire', async () => {
    // A local element with no baseline would CREATE under a normal engine.
    await folder.createElement('character', { name: 'Local Drift' });
    const before = client.calls.length;
    const result = await engine.pushOnce();
    expect(result.pushed.creates + result.pushed.updates + result.pushed.deletes).toBe(0);
    expect(client.calls.length).toBe(before); // not even the meta GET — no round ran
  });

  it('requestPush never arms a debounce', async () => {
    engine.setDebounceMs(0);
    await folder.createElement('character', { name: 'Local Drift' });
    engine.requestPush();
    await new Promise(r => setTimeout(r, 20));
    expect(writeCalls(client.calls)).toEqual([]);
  });

  it('syncNow degrades to a pull — server changes land, local drift never leaves', async () => {
    await folder.createElement('character', { name: 'Local Drift' });
    await client.createElement('character', { id: 'srv-1', name: 'Owner Edit', type: 'character' });
    const before = client.calls.length; // the seeding call above is ours, not the engine's
    const result = await engine.syncNow();
    expect(result.pulled.creates).toBe(1);
    expect(await folder.getElement('srv-1')).not.toBeNull();
    expect(result.pushed.creates + result.pushed.updates + result.pushed.deletes).toBe(0);
    expect(writeCalls(client.calls.slice(before))).toEqual([]);
  });

  it('the meta step pull-applies but never PATCHes, even with local-dirty meta', async () => {
    // Server meta has a description + now; local disk has a divergent value
    // written through the SYNC channel (simulating pre-existing drift).
    // The fake's seam takes DISK names (time_current, not the wire's rename).
    client.__server_mutate_world_meta({ description: 'the owner wrote this', time_current: 42 });
    await folder.writeWorldMeta({ description: 'local drift' }, { fromSync: true });

    // Round 1 = seed (adopt server baseline, fill empties, no PATCH).
    await engine.pullNow();
    // Round 2 = a normal diff round; local 'description' reads as local-dirty.
    await engine.pullNow();

    const patches = client.calls.filter(c => c.method === 'patchWorldMeta');
    expect(patches).toEqual([]);
    // The pull side still works: the now arrived on round 1's seed.
    const meta = await folder.readWorldMeta() as unknown as Record<string, unknown>;
    expect(meta.time_current).toBe(42);
  });

  it('flushPendingPush finds nothing to flush', async () => {
    engine.requestPush(); // no-op → no timer
    expect(engine.flushPendingPush()).toBeNull();
  });
});

describe('the view-only store guard (the second wall)', () => {
  beforeEach(() => folder.setViewOnly(true));

  it('blocks every UI mutation with an honest error', async () => {
    await expect(folder.createElement('character', { name: 'X' })).rejects.toThrow('view-only');
    await expect(folder.updateElement('any', { name: 'Y' })).rejects.toThrow('view-only');
    await expect(folder.deleteElement('any')).rejects.toThrow('view-only');
    await expect(folder.writeWorldMeta({ description: 'Z' })).rejects.toThrow('view-only');
    await expect(folder.writeCharts([])).rejects.toThrow('view-only');
  });

  it("keeps the engine's channels open: applyServerRecord, silent deletes, fromSync meta", async () => {
    await folder.applyServerRecord('character', { id: 'srv-2', type: 'character', name: 'Owner Made' }, clock.next());
    expect(await folder.getElement('srv-2')).not.toBeNull();
    await expect(folder.deleteElement('srv-2', { silent: true })).resolves.toBeTruthy();
    await expect(folder.writeWorldMeta({ description: 'pulled' }, { fromSync: true })).resolves.toBeTruthy();
  });

  it('a read-only engine round works end-to-end against a guarded store', async () => {
    const guarded = new SyncEngine({ folder, client, readOnly: true });
    await client.createElement('character', { id: 'srv-3', name: 'Fresh', type: 'character' });
    const result = await guarded.pullNow();
    expect(result.pulled.creates).toBe(1);
    expect(await folder.getElement('srv-3')).not.toBeNull();
  });
});
