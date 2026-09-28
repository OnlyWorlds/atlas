/**
 * SyncEngine /bulk push path — integration test (keel v2, Bout 3/5).
 *
 * Locks the engine's atomic-bulk CREATE path against the v2-dialect fake:
 * cyclic Make-Online, server-timestamp backfill (small + large), atomic
 * rollback + single retry, dangling-peer routing through a bulk item error,
 * the single-create fallback, and auth-bail. Plus a direct unit test of the
 * fake's `/changes` op log (the engine's changes-pull is a separate gated
 * bout, so pullChanges is exercised on the fake, not through the engine).
 *
 * Wire contract: Notes/2026-07-12-v2-probed-facts.md.
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
  // Opt in to the /bulk method. Left off by default so the per-element
  // createOrder tests keep exercising the topo-sort fallback.
  client.__enable_bulk();
  engine = new SyncEngine({ folder, client });
});

const bulkCalls = () => client.calls.filter(c => c.method === 'bulk');

describe('SyncEngine /bulk push path', () => {
  it('pushes a 2-element reference CYCLE through ONE bulk call, links intact, stamped from server ts', async () => {
    // Two never-synced characters whose `friends` arrays point at each other.
    // The per-element loop can never converge on this; /bulk resolves it in a
    // single atomic request (server-side fixpoint ordering).
    const a = await folder.createElement('character', { name: 'A' });
    const b = await folder.createElement('character', { name: 'B' });
    await folder.updateElement(a.id, { friends: [b.id] });
    await folder.updateElement(b.id, { friends: [a.id] });

    const result = await engine.pushOnce();

    expect(result.pushed.creates).toBe(2);
    expect(result.failures).toHaveLength(0);

    // Exactly ONE bulk call (no per-element create fallback, no retry).
    expect(bulkCalls()).toHaveLength(1);
    expect(client.calls.some(c => c.method === 'create')).toBe(false);

    // Both landed server-side with their cyclic links intact.
    const serverA = client.__server_get('character', a.id);
    const serverB = client.__server_get('character', b.id);
    expect(serverA?.friends).toEqual([b.id]);
    expect(serverB?.friends).toEqual([a.id]);

    // Local baselines stamped from the SERVER's timestamps (backfill), NOT
    // client now() — assert equality with the fake's stored updated_at.
    const localA = await folder.getElement(a.id);
    const localB = await folder.getElement(b.id);
    expect(localA?.server_updated_at).toBe(serverA?.updated_at);
    expect(localB?.server_updated_at).toBe(serverB?.updated_at);
  });

  it('stamps >20 creates straight from the D46 timestamp echo — no read-back at all', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const o = await folder.createElement('object', { name: `obj ${i}` });
      ids.push(o.id);
    }

    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBe(25);
    expect(result.failures).toHaveLength(0);

    // One bulk call and NOTHING after it: no per-element GETs, no list walk —
    // the echo made the whole backfill class unnecessary (keel D46).
    const bulkIdx = client.calls.findIndex(c => c.method === 'bulk');
    expect(bulkIdx).toBeGreaterThanOrEqual(0);
    expect(client.calls.slice(bulkIdx + 1).filter(c => c.method === 'list' || c.method === 'get')).toHaveLength(0);

    // Every element stamped from its server timestamp.
    for (const id of ids) {
      const local = await folder.getElement(id);
      expect(local?.server_updated_at).toBe(client.__server_get('object', id)?.updated_at);
    }
  });

  it('pre-D46 fallback: items without the echo backfill via listElements for >20 creates', async () => {
    client.__omit_bulk_timestamps();
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const o = await folder.createElement('object', { name: `obj ${i}` });
      ids.push(o.id);
    }

    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBe(25);
    expect(result.failures).toHaveLength(0);

    // One bulk call, then the >20 branch does a list walk per pushed type.
    const bulkIdx = client.calls.findIndex(c => c.method === 'bulk');
    expect(bulkIdx).toBeGreaterThanOrEqual(0);
    const listIdx = client.calls.findIndex(
      (c, i) => i > bulkIdx && c.method === 'list' && c.type === 'object',
    );
    expect(listIdx).toBeGreaterThan(bulkIdx);

    // Every element stamped from its server timestamp.
    for (const id of ids) {
      const local = await folder.getElement(id);
      expect(local?.server_updated_at).toBe(client.__server_get('object', id)?.updated_at);
    }
  });

  it('atomic rollback + single retry: fails the dangling item, retries survivors in a 2nd bulk', async () => {
    const good1 = await folder.createElement('character', { name: 'Good 1' });
    const good2 = await folder.createElement('character', { name: 'Good 2' });
    const danglingId = '00000000-0000-4000-8000-00000000dead';
    const bad = await folder.createElement('character', { name: 'Bad', birthplace: danglingId });

    const result = await engine.pushOnce();

    // First bulk errored (dangling); engine retried the 2 survivors atomically
    // in a SECOND bulk call.
    expect(bulkCalls()).toHaveLength(2);

    // The bad element surfaced as a failure with an invalid_link-derived
    // message (nothing to route — the dangling id isn't a local peer).
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].element_id).toBe(bad.id);
    expect(result.failures[0].operation).toBe('create');
    expect(result.failures[0].message).toMatch(/not found on the server/i);

    // The 2 survivors were created + stamped.
    expect(result.pushed.creates).toBe(2);
    expect((await folder.getElement(good1.id))?.server_updated_at).toBeTruthy();
    expect((await folder.getElement(good2.id))?.server_updated_at).toBeTruthy();

    // The fake's store holds exactly the 2 survivors — the bad one never
    // landed (rollback verified).
    expect(client.__server_count('character')).toBe(2);
    expect(client.__server_get('character', bad.id)).toBeUndefined();
  });

  it('a survivor that links to a refused element is held back, so the independent ones still land (S361)', async () => {
    // One refused element used to take every independent survivor down with
    // it: its dependents made the atomic retry fail, every round.
    const good = await folder.createElement('character', { name: 'Good' });
    const bad = await folder.createElement('location', { name: 'Refused' });
    const child = await folder.createElement('character', { name: 'Child', birthplace: bad.id });
    client.__inject_bulk_item_failure(bad.id, { code: 'invalid', message: 'refused for the test', param: null } as never);

    const result = await engine.pushOnce();

    expect(client.__server_get('character', good.id)).toBeDefined();
    expect(client.__server_get('character', child.id)).toBeUndefined();
    const held = result.failures.find(f => f.element_id === child.id);
    expect(held?.message).toMatch(/waits for an element OnlyWorlds refused/);
    expect(result.failures.some(f => f.element_id === bad.id)).toBe(true);
  });

  it('routes a bulk dangling-link peer (deleted server-side) to server_deletes review', async () => {
    // Zone + map synced first, so their baselines hold.
    const zone = await folder.createElement('zone', { name: 'Vanished zone' });
    const map = await folder.createElement('map', { name: 'Test map' });
    await engine.syncNow();
    expect((await folder.getElement(zone.id))?.server_updated_at).toBeTruthy();

    // Zone deleted out-of-band on the server; atlas still has it locally with
    // a server baseline.
    client.__server_evict('zone', zone.id);

    // Two never-synced creates so the engine uses /bulk: a marker referencing
    // the vanished zone + a benign bystander (the eventual survivor).
    const marker = await folder.createElement('marker', {
      name: 'orphan marker', map_id: map.id, zone_id: zone.id, x: 10, y: 20,
    });
    const bystander = await folder.createElement('character', { name: 'Bystander' });

    const result = await engine.pushOnce();

    // Marker failed with the peer-review message.
    const markerFailure = result.failures.find(f => f.element_id === marker.id);
    expect(markerFailure).toBeDefined();
    expect(markerFailure!.message).toMatch(/review in sync panel/i);

    // The vanished zone got queued for server-delete review (type resolved
    // from the LOCAL peer, not the error's placeholder refType).
    const state = await folder.readSyncState();
    const queued = (state.server_deletes ?? []).find(d => d.id === zone.id);
    expect(queued).toBeDefined();
    expect(queued!.type).toBe('zone');
    expect(queued!.name).toBe('Vanished zone');

    // The bystander survived the retry and is stamped.
    expect((await folder.getElement(bystander.id))?.server_updated_at).toBeTruthy();
    expect(result.auth_blocked ?? false).toBe(false);
  });

  it('does NOT use /bulk for a single create (falls through to createElement)', async () => {
    await folder.createElement('character', { name: 'Solo' });

    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBe(1);

    expect(client.calls.some(c => c.method === 'create')).toBe(true);
    expect(bulkCalls()).toHaveLength(0);
  });

  it('bails the round and records auth_blocked on dead credentials', async () => {
    await folder.createElement('character', { name: 'A' });
    await folder.createElement('character', { name: 'B' });
    client.__inject_auth_failure();

    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBe(true);
    expect(engine.getState().kind).toBe('error');
    // Since the world-meta step (S262), dead creds bail at the round-opening
    // GET /world — /bulk is never attempted and no per-item failures accrue.
    expect(result.failures).toHaveLength(0);
    expect(bulkCalls()).toHaveLength(0);
    expect(result.pushed.creates).toBe(0);
    expect(client.__server_count('character')).toBe(0);
  });
});

describe('FakeOwApiClient.pullChanges (unit — the engine wiring has its own suite)', () => {
  it('emits ops in commit order with element snapshots, paginates by since-cursor, shapes deletes', async () => {
    // pullChanges is OPT-IN (mirrors __enable_bulk): the engine dispatches on
    // its presence, so the fake keeps it detached by default and this unit
    // block attaches it explicitly.
    client.__enable_changes();
    const pull = client.pullChanges!;
    await client.createElement('character', { id: 'c1', name: 'A' });   // seq 1 upsert
    await client.createElement('character', { id: 'c2', name: 'B' });   // seq 2 upsert
    client.__server_mutate('character', 'c1', { name: 'A2' });          // seq 3 upsert
    await client.deleteElement('character', 'c2');                       // seq 4 delete

    // Cold walk: full state in commit order.
    const all = await pull(null, 100);
    expect(all.changes.map(c => c.changeSeq)).toEqual([1, 2, 3, 4]);
    expect(all.hasMore).toBe(false);
    expect(all.cursor).toBe('4:c2');

    // Upsert carries the element snapshot AT COMMIT TIME (seq1='A', seq3='A2').
    const first = all.changes[0];
    if (first.op !== 'upsert') throw new Error('expected upsert');
    expect(first.element.id).toBe('c1');
    expect(first.element.name).toBe('A');
    expect(first.updatedAt).toBeTruthy();
    const third = all.changes[2];
    if (third.op !== 'upsert') throw new Error('expected upsert');
    expect(third.element.name).toBe('A2');

    // Delete op shape: id + deletedAt, NO element body.
    const last = all.changes[3];
    if (last.op !== 'delete') throw new Error('expected delete');
    expect(last.id).toBe('c2');
    expect(last.deletedAt).toBeTruthy();
    expect((last as Record<string, unknown>).element).toBeUndefined();

    // Since-cursor paging: page by seq, cursor advances.
    const page1 = await pull(null, 2);
    expect(page1.changes.map(c => c.changeSeq)).toEqual([1, 2]);
    expect(page1.hasMore).toBe(true);
    expect(page1.cursor).toBe('2:c2');

    const page2 = await pull(page1.cursor, 2);
    expect(page2.changes.map(c => c.changeSeq)).toEqual([3, 4]);
    expect(page2.hasMore).toBe(false);
    expect(page2.cursor).toBe('4:c2');

    // Empty tail returns the `since` value verbatim (cursor does not reset).
    const page3 = await pull(page2.cursor, 2);
    expect(page3.changes).toHaveLength(0);
    expect(page3.cursor).toBe('4:c2');
    expect(page3.hasMore).toBe(false);
  });
});
