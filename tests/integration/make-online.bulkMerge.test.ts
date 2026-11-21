/**
 * Make-Online Route 2 merge — the /bulk create phase (`processBulkCreates`).
 *
 * Production always takes this branch (buildV2Adapter → OwV2ClientAdapter has
 * bulkCreate; batches of ≥2 local-only creates go through one atomic /bulk).
 * The legacy make-online.test.ts drives the v1 adapter and can only exercise
 * the per-element fallback — this file closes the close-gate coverage gap on
 * the port's headline path: cyclic local webs merging into an existing world.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { mergeLocalIntoApi } from '../../src/sync/make-online';
import { REPLACED_HELD_LINE } from '../../src/sync/sync-engine';

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
  client.__enable_bulk();
});

describe('mergeLocalIntoApi /bulk create phase', () => {
  it('a create whose id keel came to hold after the plan is its slot\'s 409 (create_only): never replaced, the rest land', async () => {
    const a1 = await folder.createElement('character', { name: 'Raced' });
    const b1 = await folder.createElement('character', { name: 'Free' });
    const c1 = await folder.createElement('character', { name: 'Also free' });
    // Between the plan's list and the batch, another place sends the same id with its own words.
    const real = client.bulkCreate!;
    let raced = false;
    client.bulkCreate = async (items, opts) => {
      if (!raced) { raced = true; await client.createElement('character', { id: a1.id, name: 'Raced elsewhere', description: 'theirs' }); }
      return real(items, opts);
    };
    const result = await mergeLocalIntoApi(folder, client, 'b');
    expect(client.calls.filter(c => c.method === 'bulk').every(c => (c as { createOnly: boolean }).createOnly)).toBe(true);
    expect(client.__server_get('character', a1.id)!.description).toBe('theirs');
    expect(result.failures.map(f => [f.element_id, f.code])).toEqual([[a1.id, 'id_conflict']]);
    expect(client.__server_get('character', b1.id)).toBeTruthy();
    expect(client.__server_get('character', c1.id)).toBeTruthy();
    // A rerun of the merge must not take the raced id as its own upload.
    expect((await folder.readSyncState()).route2_created ?? []).not.toContain(a1.id);
    expect((await folder.readSyncState()).route2_created ?? []).toEqual(expect.arrayContaining([b1.id, c1.id]));
  });

  it('a 200 slot in a create_only batch is a broken contract: that element\'s failure, never stamped, never this route\'s upload', async () => {
    const a1 = await folder.createElement('character', { name: 'Replaced' });
    const b1 = await folder.createElement('character', { name: 'Free' });
    const real = client.bulkCreate!;
    client.bulkCreate = async (items, opts) => {
      const out = await real(items, opts);
      const i = items.findIndex(it => it.element.id === a1.id);
      out.items[i] = { ...out.items[i], status: 200 };
      return out;
    };
    const result = await mergeLocalIntoApi(folder, client, 'b');
    const f = result.failures.find(x => x.element_id === a1.id)!;
    expect(f).toMatchObject({ status: 200, message: REPLACED_HELD_LINE });
    expect((await folder.getElement(a1.id))!.server_updated_at).toBeUndefined();
    expect((await folder.getElement(b1.id))!.server_updated_at).toBeTruthy();
    expect((await folder.readSyncState()).route2_created ?? []).not.toContain(a1.id);
  });

  it('merges a cyclic local-only pair through ONE bulk call, stamps server baselines, downloads server-only', async () => {
    // Server has one pre-existing element (downloads to local).
    await client.createElement('location', { id: '00000000-0000-4000-8000-00000000cafe', name: 'Server Keep' });
    // Local has a cyclic pair (the class per-element loops can never land).
    const a = await folder.createElement('character', { name: 'Merge Alpha' });
    const b = await folder.createElement('character', { name: 'Merge Beta' });
    await folder.updateElement(a.id, { friends: [b.id] });
    await folder.updateElement(b.id, { friends: [a.id] });

    const result = await mergeLocalIntoApi(folder, client, 'b');

    expect(result.creates).toBe(2);
    expect(result.downloaded).toBe(1);
    expect(result.failures).toHaveLength(0);
    // Exactly one bulk call carried the creates.
    expect(client.calls.filter(c => c.method === 'bulk')).toHaveLength(1);
    // Both landed server-side with the cycle intact.
    const srvA = client.__server_get('character', a.id);
    const srvB = client.__server_get('character', b.id);
    expect(srvA && (srvA.friends as string[])).toContain(b.id);
    expect(srvB && (srvB.friends as string[])).toContain(a.id);
    // Local baselines = the SERVER's timestamps (backfill, never client now()).
    const localA = await folder.getElement(a.id);
    expect(localA?.server_updated_at).toBe(srvA?.updated_at);
    // Server-only element downloaded.
    expect(await folder.getElement('00000000-0000-4000-8000-00000000cafe')).toBeTruthy();
  });

  it('stamps >20 creates straight from the D46 echo (no post-bulk read-back)', async () => {
    for (let i = 0; i < 25; i++) {
      await folder.createElement('object', { name: `bulk-obj-${i}` });
    }
    const result = await mergeLocalIntoApi(folder, client, 'b');
    expect(result.creates).toBe(25);
    expect(result.failures).toHaveLength(0);
    const bulkIdx = client.calls.findIndex(c => c.method === 'bulk');
    expect(client.calls.slice(bulkIdx + 1).filter(c => c.method === 'get')).toHaveLength(0);
    const all = await folder.listElements();
    expect(all.filter(e => !e.server_updated_at)).toHaveLength(0);
  });

  it('pre-D46 fallback: >20 creates without the echo backfill via a per-type list walk', async () => {
    client.__omit_bulk_timestamps();
    for (let i = 0; i < 25; i++) {
      await folder.createElement('object', { name: `bulk-obj-${i}` });
    }
    const result = await mergeLocalIntoApi(folder, client, 'b');
    expect(result.creates).toBe(25);
    expect(result.failures).toHaveLength(0);
    // The list-walk backfill fired for the pushed type after the bulk call.
    const methods = client.calls.map(c => c.method);
    expect(methods.indexOf('list', methods.indexOf('bulk'))).toBeGreaterThan(-1);
    const all = await folder.listElements();
    expect(all.filter(e => !e.server_updated_at)).toHaveLength(0);
  });

  it('atomic failure: bad item fails, survivors retry in a second bulk and land', async () => {
    const good1 = await folder.createElement('character', { name: 'Survivor One' });
    const good2 = await folder.createElement('character', { name: 'Survivor Two' });
    const bad = await folder.createElement('character', { name: 'Bad Apple' });
    client.__inject_bulk_item_failure(bad.id, {
      code: 'invalid_link',
      message: `location references Location '00000000-0000-4000-8000-00000000dead' which does not exist.`,
      param: 'location',
    });

    const result = await mergeLocalIntoApi(folder, client, 'b');

    expect(result.creates).toBe(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].element_id).toBe(bad.id);
    // Two bulk calls: the rolled-back attempt + the survivor retry.
    expect(client.calls.filter(c => c.method === 'bulk')).toHaveLength(2);
    // Survivors landed + stamped; the bad one has no baseline.
    expect(client.__server_get('character', good1.id)).toBeTruthy();
    expect(client.__server_get('character', good2.id)).toBeTruthy();
    expect(client.__server_get('character', bad.id)).toBeUndefined();
    expect((await folder.getElement(good1.id))?.server_updated_at).toBeTruthy();
    expect((await folder.getElement(bad.id))?.server_updated_at).toBeUndefined();
  });
});
