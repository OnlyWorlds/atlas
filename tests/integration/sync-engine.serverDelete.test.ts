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

describe('server-delete detection — pagination safety', () => {
  /**
   * Bout V (session 202) — regression for the silent-data-loss vector where
   * a paginated listElements response caused page-2+ elements to be falsely
   * flagged as "vanished from server." The user, presented with the auto-open
   * review modal, could click "delete locally" → silent destruction of data
   * alive and well on the server.
   *
   * Engine now reads `client.getPaginatedTypes()` and skips server-delete
   * detection for any type whose list was paginated.
   */

  it('does NOT flag a local element as server-deleted when its type was paginated', async () => {
    // Establish a previously-synced local element via the normal sync path.
    await client.createElement('character', { id: 'c-on-page-2', name: 'Alice', type: 'character' });
    await engine.syncNow();
    // Confirm it's locally synced.
    const localBefore = await folder.getElement('c-on-page-2');
    expect(localBefore?.server_updated_at).toBeTruthy();

    // Simulate "server now paginates this type": remove from the FakeOwApi's
    // bucket so listElements won't return it, AND flag the type as paginated
    // (in real usage this would be the adapter detecting `count > results.length`).
    await client.deleteElement('character', 'c-on-page-2'); // no longer in client.bucket
    client.__force_paginated('character', true);

    // Pull. The engine sees the type as paginated and MUST suppress server-
    // delete detection for it — even though seenLocalIds is missing this id.
    await engine.pullNow();

    const deletes = await engine.listServerDeletes();
    expect(deletes.find(d => d.id === 'c-on-page-2')).toBeUndefined();
    // The local file is untouched.
    expect(await folder.getElement('c-on-page-2')).not.toBeNull();
  });

  it('still detects server-deletes for non-paginated types in the same pull', async () => {
    // Mix: character is paginated (suppress), location is not (detect).
    await client.createElement('character', { id: 'char-1', name: 'Alice', type: 'character' });
    await client.createElement('location', { id: 'loc-1', name: 'Shire', type: 'location' });
    await engine.syncNow();

    // Server-side: both elements get deleted, but only 'character' is paginated.
    await client.deleteElement('character', 'char-1');
    await client.deleteElement('location', 'loc-1');
    client.__force_paginated('character', true);
    // 'location' is NOT marked paginated — its absence is meaningful.

    await engine.pullNow();

    const deletes = await engine.listServerDeletes();
    // character: suppressed by pagination guard.
    expect(deletes.find(d => d.id === 'char-1')).toBeUndefined();
    // location: legitimately detected as server-deleted.
    expect(deletes.find(d => d.id === 'loc-1')).toBeDefined();
  });

  it('resumes server-delete detection for a type once pagination clears', async () => {
    // Cycle: type paginated on pull 1 → not paginated on pull 2.
    await client.createElement('character', { id: 'c2', name: 'Bob', type: 'character' });
    await engine.syncNow();
    await client.deleteElement('character', 'c2');

    // Pull 1: paginated → no detection.
    client.__force_paginated('character', true);
    await engine.pullNow();
    expect((await engine.listServerDeletes()).find(d => d.id === 'c2')).toBeUndefined();

    // Pull 2: pagination cleared (e.g., the type's element count dropped
    // below the page cap). Detection resumes.
    client.__force_paginated('character', false);
    await engine.pullNow();
    expect((await engine.listServerDeletes()).find(d => d.id === 'c2')).toBeDefined();
  });
});
