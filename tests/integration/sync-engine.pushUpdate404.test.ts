/**
 * SyncEngine pushPhase UPDATE-404 → server-delete routing (Bout 8).
 *
 * When the local element has `server_updated_at` set but the server has lost
 * the record (out-of-band delete: web app, admin, another atlas instance),
 * push's pre-update GET returns null. Previous behavior: push attempted PATCH
 * anyway → 404 propagated up as an error toast → kept happening every push.
 *
 * New behavior: detect the null pre-GET (or 404 on PATCH itself) and route
 * the element into sync_state.server_deletes. The server-delete review modal
 * then handles it symmetrically with pull-time detection.
 *
 * Two failure-mode vectors verified:
 *   - pre-update GET returns null (the common case)
 *   - PATCH itself 404s (race: element deleted between GET and PATCH)
 *
 * Both fakes (FakeOwApiClient + MSW) now throw "API Error 404: <id> not
 * found in this world." on PATCH of unknown id, matching real OW.
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

describe('SyncEngine pushPhase: UPDATE 404 routes to server_deletes', () => {
  it('detects pre-update GET null → adds to server_deletes, skips PATCH', async () => {
    // 1. Set up an element synced to server (push first).
    const local = await folder.createElement('character', { name: 'Vanished' });
    await engine.syncNow();
    expect(client.__server_count('character')).toBe(1);
    const baseline = (await folder.getElement(local.id))!.server_updated_at;
    expect(baseline).toBeTruthy();

    // 2. Delete server-side out-of-band.
    await client.deleteElement('character', local.id).catch(() => {});
    expect(client.__server_count('character')).toBe(0);

    // 3. Local edit creates a push pending.
    await folder.updateElement(local.id, { description: 'changed locally' });

    // 4. Sync — push detects server has lost the element.
    const result = await engine.syncNow();
    expect(result.pushed.updates).toBe(0);
    expect(result.failures).toHaveLength(0);

    // 5. No PATCH attempt was made (only the pre-GET).
    const patchCalls = client.calls.filter(c => c.method === 'update' && c.id === local.id);
    expect(patchCalls).toHaveLength(0);

    // 6. Element queued for server-delete review.
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(1);
    expect((state.server_deletes ?? [])[0].id).toBe(local.id);
    expect((state.server_deletes ?? [])[0].name).toBe('Vanished');
  });

  it('local file is preserved (server_updated_at still set) so user can choose keep/delete', async () => {
    const local = await folder.createElement('character', { name: 'Preserved' });
    await engine.syncNow();
    await client.deleteElement('character', local.id).catch(() => {});
    await folder.updateElement(local.id, { description: 'still on disk' });

    await engine.syncNow();

    // Local file still exists with original content + baseline intact.
    const after = await folder.getElement(local.id);
    expect(after).not.toBeNull();
    expect(after!.name).toBe('Preserved');
    expect(after!.description).toBe('still on disk');
    expect(after!.server_updated_at).toBeTruthy();
  });

  it('dedupes server_deletes across multiple pushes', async () => {
    const local = await folder.createElement('character', { name: 'Twice' });
    await engine.syncNow();
    await client.deleteElement('character', local.id).catch(() => {});

    // Two edits, two pushes — element should appear in server_deletes only once.
    await folder.updateElement(local.id, { description: 'edit 1' });
    await engine.syncNow();
    await folder.updateElement(local.id, { description: 'edit 2' });
    await engine.syncNow();

    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(1);
  });

  it('does not interfere with the happy path (server still has the element)', async () => {
    const local = await folder.createElement('character', { name: 'Healthy' });
    await engine.syncNow();
    expect(client.__server_count('character')).toBe(1);

    await folder.updateElement(local.id, { description: 'normal edit' });
    const result = await engine.syncNow();

    expect(result.pushed.updates).toBe(1);
    expect(result.failures).toHaveLength(0);
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(0);
  });

  it('does NOT route CREATE 404 to server_deletes (only UPDATE)', async () => {
    // CREATEs of fresh local elements should never 404. If they somehow do
    // (server reject, validation), the error belongs in failures — not
    // server_deletes, since there was never a baseline to lose.
    const local = await folder.createElement('character', { name: 'NewbieFail' });
    client.__inject_failure('create', local.id, 'API Error 404: forced for test');

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].operation).toBe('create');
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(0);
  });
});

describe('SyncEngine pushPhase: UPDATE 404 detected via PATCH race', () => {
  it('routes 404 thrown by the PATCH call itself (TOCTOU race)', async () => {
    // Set up so pre-GET succeeds (mocked via a separate fake that returns
    // the element on getElement but 404s on updateElement). We achieve this
    // with the existing FakeOwApiClient by injecting a failure on update
    // only. The element IS on the server (no real delete), but PATCH throws
    // with a 404-shaped error — engine should treat as server-delete event.
    const local = await folder.createElement('character', { name: 'RacyMcRaceFace' });
    await engine.syncNow();
    await folder.updateElement(local.id, { description: 'race condition coming' });
    client.__inject_failure('update', local.id, 'API Error 404: not found in this world');

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(0);
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(1);
    expect((state.server_deletes ?? [])[0].id).toBe(local.id);
  });

  it('non-404 errors still land in failures', async () => {
    const local = await folder.createElement('character', { name: 'Server500' });
    await engine.syncNow();
    await folder.updateElement(local.id, { description: 'edit' });
    client.__inject_failure('update', local.id, 'API Error 500: internal error');

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toMatch(/500/);
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(0);
  });
});

describe('SyncEngine.resolveConflict: overwrite-mine routes 404 to server-delete', () => {
  it('clears conflict + routes to server_deletes when server has lost the element', async () => {
    // Set up: element synced, server gets a remote edit (conflict bait), then
    // gets deleted server-side before user resolves.
    const local = await folder.createElement('character', { name: 'Phantom' });
    await engine.syncNow();
    // Local edit + simulate a server-side edit to create the conflict baseline.
    await folder.updateElement(local.id, { description: 'local edit' });
    client.__server_mutate('character', local.id, { description: 'remote edit' });
    // Sync under pause-and-review policy to persist the conflict.
    const eng = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    await eng.syncNow();
    const before = await folder.readSyncState();
    expect(before.conflicts).toHaveLength(1);

    // Now server-side delete — between conflict detection and user resolve.
    await client.deleteElement('character', local.id).catch(() => {});

    // User picks "overwrite-mine" — this would 404 on UPDATE before the fix.
    await expect(eng.resolveConflict(local.id, 'overwrite-mine')).resolves.toBeUndefined();

    const after = await folder.readSyncState();
    expect(after.conflicts).toHaveLength(0);
    expect(after.server_deletes ?? []).toHaveLength(1);
    expect((after.server_deletes ?? [])[0].id).toBe(local.id);
  });
});
