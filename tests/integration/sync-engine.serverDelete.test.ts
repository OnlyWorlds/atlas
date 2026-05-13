/**
 * Server-side delete detection + resolution (Phase 3.5+).
 *
 * Covers:
 *   - pullPhase detects elements that vanished from the server.
 *   - Local elements with no server_updated_at aren't flagged.
 *   - Elements with pending tombstones aren't flagged (already being deleted).
 *   - resolveServerDelete('delete-locally') silently removes the local file.
 *   - resolveServerDelete('keep') clears server_updated_at; next push re-creates.
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

describe('server-side delete detection', () => {
  it('records a server-delete when a previously-synced element disappears', async () => {
    // Sync once to establish the element on both sides.
    await client.createElement('character', { id: 'c1', name: 'Alice', type: 'character' });
    await engine.syncNow();
    // Server-side delete.
    await client.deleteElement('character', 'c1');
    // Pull again.
    await engine.pullNow();

    const deletes = await engine.listServerDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0].id).toBe('c1');
    expect(deletes[0].type).toBe('character');
    expect(deletes[0].name).toBe('Alice');
  });

  it('does not record server-deletes for never-synced local elements', async () => {
    // Local-only element (no server_updated_at).
    await folder.createElement('character', { name: 'LocalOnly' });
    await engine.pullNow();

    const deletes = await engine.listServerDeletes();
    expect(deletes).toEqual([]);
  });

  it('does not record server-deletes for elements with a pending tombstone', async () => {
    await client.createElement('character', { id: 'c1', name: 'Alice', type: 'character' });
    await engine.syncNow();
    // Local delete writes tombstone.
    await folder.deleteElement('c1');
    // Server also gone (simulating two-side delete).
    await client.deleteElement('character', 'c1');

    await engine.pullNow();
    const deletes = await engine.listServerDeletes();
    expect(deletes).toEqual([]);
  });

  it('dedupes existing server-delete entries on subsequent pulls', async () => {
    await client.createElement('character', { id: 'c1', name: 'Alice', type: 'character' });
    await engine.syncNow();
    await client.deleteElement('character', 'c1');

    await engine.pullNow();
    await engine.pullNow();

    const deletes = await engine.listServerDeletes();
    expect(deletes).toHaveLength(1);
  });
});

describe('resolveServerDelete', () => {
  beforeEach(async () => {
    await client.createElement('character', { id: 'c1', name: 'Alice', type: 'character' });
    await engine.syncNow();
    await client.deleteElement('character', 'c1');
    await engine.pullNow();
  });

  it('delete-locally removes the local file silently (no tombstone)', async () => {
    await engine.resolveServerDelete('c1', 'delete-locally');

    expect(await folder.getElement('c1')).toBeNull();
    const tombs = await folder.listTombstonesSince(null);
    expect(tombs.find(t => t.id === 'c1')).toBeUndefined();
    const deletes = await engine.listServerDeletes();
    expect(deletes).toEqual([]);
  });

  it('keep clears server_updated_at so next push re-creates on server', async () => {
    await engine.resolveServerDelete('c1', 'keep');

    const local = await folder.getElement('c1');
    expect(local).not.toBeNull();
    expect(local!.server_updated_at).toBeUndefined();
    const deletes = await engine.listServerDeletes();
    expect(deletes).toEqual([]);

    // Push again — server should get c1 back as a CREATE.
    await engine.syncNow();
    expect(client.__server_count('character')).toBe(1);
    expect(client.__server_get('character', 'c1')?.name).toBe('Alice');
  });

  it('no-op for unknown id', async () => {
    await engine.resolveServerDelete('does-not-exist', 'delete-locally');
    const deletes = await engine.listServerDeletes();
    expect(deletes).toHaveLength(1); // original c1 untouched
  });
});
