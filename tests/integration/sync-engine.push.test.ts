/**
 * SyncEngine push phase — integration test.
 *
 * Covers the foundational contract:
 * - A locally-created element gets pushed as CREATE
 * - The folder receives `server_updated_at` stamped on success
 * - A locally-updated previously-synced element gets pushed as UPDATE
 * - A deleted element (with tombstone) gets pushed as DELETE
 * - Tombstone cleared after server-side delete success
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
  engine = new SyncEngine({ folder, client });
});

/** Push tests focus on write methods. Pull phase issues list calls every sync,
 *  and the world-meta step issues a getWorldMeta read every round;
 *  filter both out so push assertions stay focused on the push surface. */
const writeCalls = () => client.calls.filter(c => c.method !== 'list' && c.method !== 'getWorldMeta');

describe('SyncEngine push phase', () => {
  it('pushes a locally-created element as CREATE', async () => {
    const local = await folder.createElement('character', { name: 'Alice' });
    expect(local.server_updated_at).toBeUndefined();

    const result = await engine.syncNow();

    expect(result.pushed.creates).toBe(1);
    expect(result.pushed.updates).toBe(0);
    const writes = writeCalls();
    expect(writes).toHaveLength(1);
    const call = writes[0];
    expect(call.method).toBe('create');
    if (call.method !== 'create') throw new Error('expected create');
    expect(call.type).toBe('character');
    expect(call.body).toMatchObject({
      id: local.id,
      name: 'Alice',
      type: 'character',
    });
  });

  it('stamps server_updated_at on the folder element after successful push', async () => {
    const local = await folder.createElement('character', { name: 'Bob' });

    await engine.syncNow();

    const after = await folder.getElement(local.id);
    expect(after).not.toBeNull();
    expect(after!.server_updated_at).toBeTruthy();
    expect(after!.server_updated_at).toBe(client.__server_get('character', local.id)?.updated_at);
  });

  it('preserves client-side UUID on create (OW accepts client UUIDs)', async () => {
    const fixedId = '00000000-0000-4000-8000-000000000001';
    await folder.createElement('character', { id: fixedId, name: 'Carol' });

    await engine.syncNow();

    expect(client.__server_get('character', fixedId)).toBeDefined();
    expect(client.__server_get('character', fixedId)?.name).toBe('Carol');
  });

  it('pushes a locally-updated previously-synced element as UPDATE', async () => {
    // First sync: create + push.
    const local = await folder.createElement('character', { name: 'Dora' });
    await engine.syncNow();
    expect(writeCalls()).toHaveLength(1);

    // Local edit after sync.
    await folder.updateElement(local.id, { name: 'Dora the Brave' });

    // Second sync: should be an UPDATE, not a re-CREATE.
    const result = await engine.syncNow();
    expect(result.pushed.updates).toBe(1);
    expect(result.pushed.creates).toBe(0);
    expect(client.calls.filter(c => c.method === 'update')).toHaveLength(1);
  });

  it('pushes a delete (via tombstone) and clears the tombstone on success', async () => {
    const local = await folder.createElement('character', { name: 'Eve' });
    await engine.syncNow();
    expect(folder.__debug_elementCount()).toBe(1);

    await folder.deleteElement(local.id);
    expect(folder.__debug_elementCount()).toBe(0);
    expect(folder.__debug_tombstoneCount()).toBe(1);

    const result = await engine.syncNow();
    expect(result.pushed.deletes).toBe(1);
    expect(client.__server_count('character')).toBe(0);
    expect(folder.__debug_tombstoneCount()).toBe(0);
  });

  it('does nothing when there are no local changes and no tombstones', async () => {
    const result = await engine.syncNow();
    expect(result.pushed.creates).toBe(0);
    expect(result.pushed.updates).toBe(0);
    expect(result.pushed.deletes).toBe(0);
    expect(writeCalls()).toHaveLength(0);
  });

  it('does not push while paused', async () => {
    await folder.createElement('character', { name: 'Frank' });
    engine.pause('manual');

    const result = await engine.syncNow();
    expect(result.pushed.creates).toBe(0);
    expect(client.calls).toHaveLength(0); // pause short-circuits before pull too
  });

  it('resume clears paused state and the next sync proceeds', async () => {
    await folder.createElement('character', { name: 'Grace' });
    engine.pause('manual');
    expect(engine.getState().kind).toBe('paused');

    engine.resume();
    // resume() now also fires pushOnce internally (Bout AA fix for the
    // pause+edit+resume gap), so the engine may transition through
    // `syncing` before settling at `idle`. Either state immediately after
    // resume() proves "no longer paused" — the load-bearing assertion is
    // that the subsequent syncNow proceeds.
    const afterResume = engine.getState().kind;
    expect(afterResume === 'idle' || afterResume === 'syncing').toBe(true);

    const result = await engine.syncNow();
    expect(result.pushed.creates).toBe(1);
  });

  /**
   * A push-phase throw must restore idle, exactly as the pull path does.
   *
   * `runPullOnly` has wrapped its phase in try/catch-and-restore-idle since it
   * was written, with a comment saying "we MUST restore idle state first or the
   * pill stays stuck at 'fetching...' forever". `runPushOnly` never got the same
   * guard, so any throw outside the per-element catch left the sync pill reading
   * "Saving…" indefinitely — on the path EVERY user edit takes.
   *
   * The state assertion is the load-bearing half. The rejection alone would pass
   * with the fix reverted; only `kind === 'idle'` distinguishes "threw and
   * cleaned up" from "threw and left the UI lying".
   */
  it('restores idle state when the push phase throws, instead of stranding the pill at Saving', async () => {
    await folder.createElement('character', { name: 'Hank' });

    // pushPhase's FIRST folder read (sync-engine.ts:1443). Injecting at
    // listElements does not work: pushPhase never calls it, and the round
    // succeeds — the instrument has to hit the path actually under test.
    const boom = new Error('disk went away mid-push');
    folder.listLocallyChangedSince = async () => { throw boom; };

    await expect(engine.pushOnce()).rejects.toThrow('disk went away mid-push');

    // The bug: this read 'syncing' forever, and the pill renders straight from it.
    expect(engine.getState().kind).toBe('idle');
  });

  it('does not re-push an element whose local_updated_at equals server_updated_at', async () => {
    const local = await folder.createElement('character', { name: 'Hank' });
    await engine.syncNow(); // initial push, server_updated_at stamped
    const first = await folder.getElement(local.id);
    expect(first?.server_updated_at).toBeTruthy();

    // No local edit; sync again.
    const result = await engine.syncNow();
    expect(result.pushed.creates).toBe(0);
    expect(result.pushed.updates).toBe(0);
  });
});
