/**
 * FolderStore.resetSyncBaseline — the unlink-from-api contract.
 *
 * When a user unlinks an api-linked world, the folder is conceptually no
 * longer associated with that api world. Every shred of sync metadata must be
 * invalidated: element baselines (`server_updated_at`), tombstones (queued
 * DELETEs for the old api world), `sync-state.json` (last_*_at + conflicts +
 * server_deletes), and `world.json.api`. Local content is preserved.
 *
 * The bug this fix closes (caught during session 206 smoke):
 *   1. User makes a local world online via Route 1 — elements get stamped with
 *      `server_updated_at`.
 *   2. User unlinks AND deletes the api world on onlyworlds.com.
 *   3. User makes online a SECOND time via Route 1 (new api world).
 *   4. Transient engine pushPhase sees elements with `server_updated_at` →
 *      treats them as UPDATEs against the new world → pre-update GET 404 →
 *      every element routed to server_deletes. World is created on api with
 *      ZERO elements. User expected a fresh upload.
 *
 * The fix: unlink calls `folder.resetSyncBaseline()`, so the second Route 1
 * sees never-synced elements and CREATEs them all.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
});

describe('FolderStore.resetSyncBaseline — contract', () => {
  it('strips server_updated_at from every element', async () => {
    const alice = await folder.createElement('character', { name: 'Alice' });
    const bob = await folder.createElement('location', { name: 'Bob City' });
    // Simulate prior sync stamping baselines.
    await folder.stampServerUpdatedAt(alice.id, 'character', '2026-01-01T01:00:00.000Z');
    await folder.stampServerUpdatedAt(bob.id, 'location', '2026-01-01T01:00:00.000Z');
    expect((await folder.getElement(alice.id))!.server_updated_at).toBeDefined();
    expect((await folder.getElement(bob.id))!.server_updated_at).toBeDefined();

    await folder.resetSyncBaseline();

    expect((await folder.getElement(alice.id))!.server_updated_at).toBeUndefined();
    expect((await folder.getElement(bob.id))!.server_updated_at).toBeUndefined();
  });

  it('preserves local content — names, descriptions, relations, ids', async () => {
    const loc = await folder.createElement('location', { name: 'Shire' });
    const alice = await folder.createElement('character', {
      name: 'Alice',
      description: 'A hobbit',
      birthplace: loc.id,
      species: ['hobbit-id'],
    });
    await folder.stampServerUpdatedAt(alice.id, 'character', '2026-01-01T01:00:00.000Z');
    await folder.stampServerUpdatedAt(loc.id, 'location', '2026-01-01T01:00:00.000Z');

    await folder.resetSyncBaseline();

    const aliceAfter = await folder.getElement(alice.id);
    expect(aliceAfter).not.toBeNull();
    expect(aliceAfter!.name).toBe('Alice');
    expect(aliceAfter!.description).toBe('A hobbit');
    expect((aliceAfter as any).birthplace).toBe(loc.id);
    expect((aliceAfter as any).species).toEqual(['hobbit-id']);
    expect(aliceAfter!.id).toBe(alice.id); // id unchanged
    expect(aliceAfter!.local_updated_at).toBeDefined();
  });

  it('drops every tombstone', async () => {
    const alice = await folder.createElement('character', { name: 'Alice' });
    await folder.deleteElement(alice.id);
    expect(await folder.listTombstonesSince(null)).toHaveLength(1);

    await folder.resetSyncBaseline();

    expect(await folder.listTombstonesSince(null)).toHaveLength(0);
  });

  it('resets sync-state.json (last_pull_at + last_push_at + conflicts + server_deletes)', async () => {
    await folder.writeSyncState({
      last_pull_at: '2026-01-01T01:00:00.000Z',
      last_push_at: '2026-01-01T01:00:00.000Z',
      conflicts: [{
        element_id: 'foo',
        type: 'character',
        detected_at: '2026-01-01T01:00:00.000Z',
        local_updated_at: '2026-01-01T01:00:00.000Z',
        server_updated_at: '2026-01-01T01:00:00.000Z',
        fields: ['name'],
      }],
      server_deletes: [{
        id: 'bar',
        type: 'character',
        detected_at: '2026-01-01T01:00:00.000Z',
        name: 'Bar',
      }],
    });

    await folder.resetSyncBaseline();

    const state = await folder.readSyncState();
    expect(state.last_pull_at).toBeNull();
    expect(state.last_push_at).toBeNull();
    expect(state.conflicts).toEqual([]);
    expect(state.server_deletes ?? []).toEqual([]);
  });

  it('strips the api block from world.json', async () => {
    await folder.writeWorldMeta({
      id: 'w1',
      name: 'Test',
      api: { world_id: 'srv-1', api_key: 'old-key' },
    });
    expect((await folder.readWorldMeta()).api).toBeDefined();

    await folder.resetSyncBaseline();

    expect((await folder.readWorldMeta()).api).toBeUndefined();
    // Other meta survives.
    expect((await folder.readWorldMeta()).name).toBe('Test');
  });

  it('is idempotent on a fresh never-synced folder', async () => {
    await folder.createElement('character', { name: 'Alice' });
    // No stamps, no tombstones, no api block — nothing to reset.

    await expect(folder.resetSyncBaseline()).resolves.not.toThrow();
    // And again, just to be sure.
    await expect(folder.resetSyncBaseline()).resolves.not.toThrow();

    // Local content survives both calls.
    const elements = await folder.listElements();
    expect(elements).toHaveLength(1);
    expect(elements[0].name).toBe('Alice');
  });
});

describe('FolderStore.resetSyncBaseline — re-link Route 1 after unlink (the captain bug)', () => {
  it('after sync + reset, a fresh push CREATEs every element (no UPDATE → 404 → server-delete routing)', async () => {
    // Setup: two elements, freshly created locally. They'll get
    // server_updated_at stamps from the first push.
    const alice = await folder.createElement('character', { name: 'Alice' });
    const bob = await folder.createElement('character', { name: 'Bob' });

    // First "Make-Online Route 1": transient engine pushes to an api world.
    // (keel preserves client ids — v2 contract, probed 2026-07-12.)
    const client1 = new FakeOwApiClient();
    client1.setClock(clock.next);
    const engine1 = new SyncEngine({ folder, client: client1 });
    const firstPush = await engine1.pushOnce();
    expect(firstPush.pushed.creates).toBe(2);
    // After: both elements keep their client ids + gain server_updated_at.
    const afterFirst = await folder.listElements();
    expect(afterFirst).toHaveLength(2);
    expect(afterFirst.every((e) => !!e.server_updated_at)).toBe(true);

    // User unlinks (settings → unlink-from-api). The bug: without this
    // call, the elements keep server_updated_at and the second Route 1
    // treats them as UPDATEs against a never-seen-them world.
    await folder.resetSyncBaseline();

    // Verify reset landed.
    const afterReset = await folder.listElements();
    expect(afterReset.every((e) => !e.server_updated_at)).toBe(true);
    expect((await folder.readWorldMeta()).api).toBeUndefined();

    // Second "Make-Online Route 1": fresh api world, fresh transient engine.
    // ZERO existing server state. Every element should CREATE, none UPDATE,
    // and no 404 → server_delete routing.
    const client2 = new FakeOwApiClient();
    client2.setClock(clock.next);
    const engine2 = new SyncEngine({ folder, client: client2 });
    const secondPush = await engine2.pushOnce();

    // The fix in action: BOTH elements push as CREATEs to the new api world.
    expect(secondPush.pushed.creates).toBe(2);
    expect(secondPush.pushed.updates).toBe(0);
    expect(secondPush.failures).toEqual([]);
    expect(client2.__server_count('character')).toBe(2);

    // And critically: no server_deletes were detected. Before the fix, both
    // elements would have shown up here because the engine would have run
    // them through the UPDATE → 404 path.
    const finalState = await folder.readSyncState();
    expect(finalState.server_deletes ?? []).toEqual([]);

    void alice; void bob;
  });

  it('tombstones from the old api world do not propagate to the new one', async () => {
    // Setup: create + sync + delete + re-create (tombstone for old id queued).
    const alice = await folder.createElement('character', { name: 'Alice' });
    await folder.stampServerUpdatedAt(alice.id, 'character', '2026-01-01T01:00:00.000Z');
    await folder.deleteElement(alice.id);
    expect(await folder.listTombstonesSince(null)).toHaveLength(1);

    // Unlink resets — tombstone gone (targeted at the dead api world).
    await folder.resetSyncBaseline();
    expect(await folder.listTombstonesSince(null)).toHaveLength(0);

    // A future push against a new api world has no orphan DELETEs to fire,
    // so the new world doesn't see spurious 404s.
    const client = new FakeOwApiClient();
    client.setClock(clock.next);
    const engine = new SyncEngine({ folder, client });
    const result = await engine.pushOnce();
    expect(result.pushed.deletes).toBe(0);
    expect(result.failures).toEqual([]);
  });
});
