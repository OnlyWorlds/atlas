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

  it('backfills >20 creates via a per-type list walk', async () => {
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
