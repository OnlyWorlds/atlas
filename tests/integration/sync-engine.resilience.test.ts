/**
 * SyncEngine push resilience — integration test.
 *
 * The engine must NOT abort the whole push when one element fails. Failures
 * are recorded in result.failures and the iteration continues. This matters
 * most for Make-Online: uploading dozens of elements at once, one bad element
 * shouldn't kill the upload.
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
let progressCalls: Array<{ done: number; total: number }>;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  progressCalls = [];
  engine = new SyncEngine({
    folder,
    client,
    onPushProgress: (done, total) => progressCalls.push({ done, total }),
  });
});

describe('SyncEngine push resilience — per-element failures', () => {
  it('continues pushing remaining elements when one CREATE fails', async () => {
    const e1 = await folder.createElement('character', { name: 'Alice' });
    const e2 = await folder.createElement('character', { name: 'Bob' });
    const e3 = await folder.createElement('character', { name: 'Carol' });

    // Inject failure on Bob's CREATE — engine should still succeed Alice + Carol.
    client.__inject_failure('create', e2.id, 'simulated 400');

    const result = await engine.syncNow();

    expect(result.pushed.creates).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({
      element_id: e2.id,
      type: 'character',
      operation: 'create',
    });
    expect(result.failures[0].message).toContain('simulated 400');

    // Server has Alice + Carol; Bob is missing.
    expect(client.__server_get('character', e1.id)).toBeDefined();
    expect(client.__server_get('character', e2.id)).toBeUndefined();
    expect(client.__server_get('character', e3.id)).toBeDefined();

    // Folder side: failed element has NO server_updated_at stamp.
    const bobAfter = await folder.getElement(e2.id);
    expect(bobAfter?.server_updated_at).toBeUndefined();
    // Successful elements DO have it stamped.
    const aliceAfter = await folder.getElement(e1.id);
    expect(aliceAfter?.server_updated_at).toBeTruthy();
  });

  it('continues pushing when one UPDATE fails', async () => {
    // Two elements synced.
    const e1 = await folder.createElement('character', { name: 'Dave' });
    const e2 = await folder.createElement('character', { name: 'Eve' });
    await engine.syncNow();
    const e1Baseline = (await folder.getElement(e1.id))!.server_updated_at!;

    // Local edits to both.
    await folder.updateElement(e1.id, { name: 'Dave the Brave' });
    await folder.updateElement(e2.id, { name: 'Eve the Wise' });

    // Inject failure on Eve's UPDATE.
    client.__inject_failure('update', e2.id, 'server 500');

    const result = await engine.syncNow();

    expect(result.pushed.updates).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ element_id: e2.id, operation: 'update' });

    // Eve's server_updated_at stays at the original baseline (no successful push).
    const eveAfter = await folder.getElement(e2.id);
    expect(eveAfter?.server_updated_at).toBeTruthy();
    // Dave's server_updated_at advanced.
    const daveAfter = await folder.getElement(e1.id);
    expect(daveAfter!.server_updated_at).not.toBe(e1Baseline);
  });

  it('continues pushing remaining tombstones when one DELETE fails', async () => {
    const e1 = await folder.createElement('character', { name: 'Frank' });
    const e2 = await folder.createElement('character', { name: 'Grace' });
    await engine.syncNow();
    await folder.deleteElement(e1.id);
    await folder.deleteElement(e2.id);
    expect(folder.__debug_tombstoneCount()).toBe(2);

    client.__inject_failure('delete', e1.id, 'gone but tracked');

    const result = await engine.syncNow();

    expect(result.pushed.deletes).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ element_id: e1.id, operation: 'delete' });
    // Failed tombstone remains in log for next sync; successful one cleared.
    expect(folder.__debug_tombstoneCount()).toBe(1);
  });

  it('reports per-iteration push progress including failures', async () => {
    const ids = [];
    for (let i = 0; i < 5; i++) {
      const e = await folder.createElement('character', { name: `H${i}` });
      ids.push(e.id);
    }
    // Inject one failure mid-stream.
    client.__inject_failure('create', ids[2], 'middle one fails');

    await engine.syncNow();

    // Progress fires once per element (success OR failure), total=5.
    expect(progressCalls).toHaveLength(5);
    expect(progressCalls.map(p => p.done)).toEqual([1, 2, 3, 4, 5]);
    expect(progressCalls.every(p => p.total === 5)).toBe(true);
  });

  it('pushOnce returns the same shape as syncNow but skips the pull phase', async () => {
    await folder.createElement('character', { name: 'Iris' });
    await folder.createElement('character', { name: 'Jack' });

    const result = await engine.pushOnce();

    expect(result.pushed.creates).toBe(2);
    expect(result.pulled).toEqual({ creates: 0, updates: 0, deletes: 0 });
    expect(result.failures).toHaveLength(0);
    // No list calls — pull phase didn't run.
    expect(client.calls.some(c => c.method === 'list')).toBe(false);
  });

  it('pushOnce honors per-element failure tolerance', async () => {
    const e1 = await folder.createElement('character', { name: 'Kate' });
    const e2 = await folder.createElement('character', { name: 'Liam' });
    client.__inject_failure('create', e1.id, 'first one fails');

    const result = await engine.pushOnce();

    expect(result.pushed.creates).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].element_id).toBe(e1.id);
    expect(client.__server_get('character', e2.id)).toBeDefined();
  });
});

/**
 * S323 — a throw in the META step must not pin the engine at 'syncing'.
 *
 * `executeMetaStep` does real disk I/O and ran outside any try on all three
 * round entry points, while the push and pull PHASES each had an idle-restore
 * with a comment explaining why. So a dead directory handle during the meta
 * step left `activeSync` reading 'syncing' for the whole session: the pill
 * says "Saving…" forever, the manual pull button no-ops on
 * `kind === 'syncing'`, and the auto-pull scheduler skips every tick as busy.
 * The engine's own source named this hole and deferred it before release.
 *
 * Asserted on the STATE the UI reads, not on the throw, because the stuck
 * state is the damage. This is the S308 class in its third location:
 * hardening applied to one side of a symmetric surface is a defect class.
 */
describe('meta-step failure leaves the engine usable', () => {
  for (const entry of ['pushOnce', 'pullNow', 'syncNow'] as const) {
    it(`restores idle when the meta step throws during ${entry}`, async () => {
      await folder.createElement('character', { name: 'Mona' });
      // The first thing executeMetaStep touches on disk.
      folder.readSyncState = async () => { throw new Error('directory handle is dead'); };

      await expect((engine as unknown as Record<string, () => Promise<unknown>>)[entry]()).rejects.toThrow();

      // The pill, the manual pull button and the auto-pull scheduler all read
      // this one field.
      expect(engine.getState().kind).toBe('idle');
    });
  }
});
