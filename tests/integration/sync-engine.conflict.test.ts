/**
 * SyncEngine conflict detection — integration test.
 *
 * Pre-update GET happens on every UPDATE push. Behavior per policy:
 * - drain-blind: push anyway, record conflict for info
 * - pause-on-conflict: skip push, conflict recorded, local change preserved
 * - ask: alias for pause-on-conflict until Phase 3.5 ships the diff modal
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { Conflict } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('SyncEngine conflict detection on UPDATE push', () => {
  it('no conflict when server has not moved since baseline (drain-blind)', async () => {
    const engine = new SyncEngine({ folder, client });

    const local = await folder.createElement('character', { name: 'Alice' });
    await engine.syncNow();

    // Local edit. Server untouched.
    await folder.updateElement(local.id, { name: 'Alice v2' });

    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(0);
    expect(result.pushed.updates).toBe(1);

    // Pre-update GET was issued.
    expect(client.calls.filter(c => c.method === 'get')).toHaveLength(1);
  });

  it('drain-blind: pushes our version anyway when server moved, records conflict', async () => {
    const fired: Conflict[] = [];
    const engine = new SyncEngine({ folder, client, policy: 'drain-blind', onConflict: c => fired.push(c) });

    const local = await folder.createElement('character', { name: 'Alice' });
    await engine.syncNow();

    // Server-side change by someone else (doesn't show up in our calls log).
    await folder.updateElement(local.id, { name: 'Alice (mine)' });
    client.__server_mutate('character', local.id, { name: 'Alice (theirs)' });

    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].element_id).toBe(local.id);
    expect(result.conflicts[0].fields).toContain('name');
    expect(result.pushed.updates).toBe(1);
    expect(fired).toHaveLength(1);

    // Server now has OUR version.
    expect(client.__server_get('character', local.id)?.name).toBe('Alice (mine)');
  });

  it('pause-on-conflict: skips push, conflict recorded, local change preserved', async () => {
    const fired: Conflict[] = [];
    const engine = new SyncEngine({ folder, client, policy: 'pause-on-conflict', onConflict: c => fired.push(c) });

    const local = await folder.createElement('character', { name: 'Bob' });
    await engine.syncNow();

    await folder.updateElement(local.id, { name: 'Bob (mine)' });
    client.__server_mutate('character', local.id, { name: 'Bob (theirs)' });

    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.pushed.updates).toBe(0); // skipped
    expect(fired).toHaveLength(1);

    // Server STILL has theirs (we didn't push).
    expect(client.__server_get('character', local.id)?.name).toBe('Bob (theirs)');
    // Local STILL has mine (we didn't overwrite).
    expect((await folder.getElement(local.id))?.name).toBe('Bob (mine)');
  });

  it('ask: aliases pause-on-conflict for Phase 1 (push skipped, conflict recorded)', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'ask' });

    const local = await folder.createElement('character', { name: 'Carol' });
    await engine.syncNow();

    await folder.updateElement(local.id, { name: 'Carol (mine)' });
    client.__server_mutate('character', local.id, { name: 'Carol (theirs)' });

    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.pushed.updates).toBe(0);
  });

  it('multiple updates with mixed conflict / no-conflict in a single push', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'drain-blind' });

    const a = await folder.createElement('character', { name: 'Aria' });
    const b = await folder.createElement('character', { name: 'Bram' });
    const c = await folder.createElement('character', { name: 'Cora' });
    await engine.syncNow();

    // All three edited locally.
    await folder.updateElement(a.id, { name: 'Aria v2' });
    await folder.updateElement(b.id, { name: 'Bram v2' });
    await folder.updateElement(c.id, { name: 'Cora v2' });
    // Only B has a server-side conflict.
    client.__server_mutate('character', b.id, { name: 'Bram (theirs)' });

    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].element_id).toBe(b.id);
    expect(result.pushed.updates).toBe(3); // all three pushed under drain-blind
  });

  it('CREATE path does NOT call get (no baseline exists)', async () => {
    const engine = new SyncEngine({ folder, client });
    await folder.createElement('character', { name: 'fresh' });

    await engine.syncNow();

    expect(client.calls.filter(c => c.method === 'get')).toHaveLength(0);
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(1);
  });

  it('conflict.fields lists only fields that actually differ', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'drain-blind' });

    const local = await folder.createElement('character', { name: 'Dora', description: 'tall' });
    await engine.syncNow();

    // Local: edit name only.
    await folder.updateElement(local.id, { name: 'Dora v2' });
    // Server: edit description only.
    client.__server_mutate('character', local.id, { description: 'short' });

    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fields.sort()).toEqual(['description', 'name']);
  });
});
