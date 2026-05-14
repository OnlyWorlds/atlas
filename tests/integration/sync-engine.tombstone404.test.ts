/**
 * Tombstone recovery on DELETE 404 (H2).
 *
 * Real OW returns 404 on `DELETE /element/{unknown_id}/` (DRF default). If the
 * engine treats that as a hard failure and retains the tombstone, every
 * subsequent push retries the same DELETE → 404 → tombstone retained → forever.
 *
 * Three vectors produce orphan tombstones:
 *   1. User creates locally and deletes locally before any sync (no server
 *      counterpart ever existed).
 *   2. Cascade-delete of a parent (e.g. map) writes tombstones for child
 *      elements (pins) that were never pushed.
 *   3. The element was synced once but server-side state has since drifted —
 *      another client / admin deleted it. We see 404 on our DELETE attempt.
 *
 * The engine's contract: DELETE 404 means "server doesn't have it" which is
 * the desired post-condition of a DELETE. Treat as success, clear the tombstone.
 *
 * Both fakes now mirror the real OW 404-on-unknown rule (msw-handlers.ts +
 * fake-ow-client.ts), so any future code that mistakenly retains an unknown-id
 * tombstone will fail its tests immediately.
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

describe('SyncEngine tombstone recovery on DELETE 404', () => {
  it('clears tombstone when server returns 404 on a never-synced delete', async () => {
    // Local-only lifecycle: create + delete before any sync ever ran.
    const local = await folder.createElement('character', { name: 'Ghost' });
    expect(local.server_updated_at).toBeUndefined();
    await folder.deleteElement(local.id);
    expect(folder.__debug_tombstoneCount()).toBe(1);

    // First push: the only thing pending is the tombstone for an id the
    // server has never heard of. Engine attempts DELETE → fake throws 404.
    // The engine must treat this as "already gone" and clear the tombstone,
    // NOT record it as a failure to retry forever.
    const result = await engine.syncNow();

    expect(folder.__debug_tombstoneCount()).toBe(0);
    expect(result.pushed.deletes).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('clears tombstone when the server has independently deleted the element', async () => {
    // Synced lifecycle, then server-side drift.
    const local = await folder.createElement('character', { name: 'Drifter' });
    await engine.syncNow();
    expect(client.__server_count('character')).toBe(1);

    // Simulate another client deleting it server-side (out-of-band).
    await client.deleteElement('character', local.id).catch(() => {});
    expect(client.__server_count('character')).toBe(0);

    // Local deletes it now — tombstone has a real id but server returns 404.
    await folder.deleteElement(local.id);
    expect(folder.__debug_tombstoneCount()).toBe(1);

    const result = await engine.syncNow();
    expect(folder.__debug_tombstoneCount()).toBe(0);
    expect(result.pushed.deletes).toBe(1);
    expect(result.failures).toHaveLength(0);
  });

  it('does not regress non-404 failures (still recorded, tombstone retained)', async () => {
    const local = await folder.createElement('character', { name: 'Stubborn' });
    await engine.syncNow();
    await folder.deleteElement(local.id);

    // Inject a transient failure (not a 404) — should be recorded and retried.
    client.__inject_failure('delete', local.id, 'API Error 500: internal');

    const result = await engine.syncNow();
    expect(folder.__debug_tombstoneCount()).toBe(1);
    expect(result.pushed.deletes).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toMatch(/500/);

    // Retry: 500 was one-shot, next attempt succeeds (server still has the element).
    const retry = await engine.syncNow();
    expect(folder.__debug_tombstoneCount()).toBe(0);
    expect(retry.pushed.deletes).toBe(1);
  });

  it('clears multiple orphan tombstones in a single push round', async () => {
    // Cascade-delete style: multiple never-synced elements all become orphan
    // tombstones at once.
    const a = await folder.createElement('character', { name: 'A' });
    const b = await folder.createElement('character', { name: 'B' });
    const c = await folder.createElement('location', { name: 'C' });
    await folder.deleteElement(a.id);
    await folder.deleteElement(b.id);
    await folder.deleteElement(c.id);
    expect(folder.__debug_tombstoneCount()).toBe(3);

    const result = await engine.syncNow();
    expect(folder.__debug_tombstoneCount()).toBe(0);
    expect(result.pushed.deletes).toBe(3);
    expect(result.failures).toHaveLength(0);
  });
});
