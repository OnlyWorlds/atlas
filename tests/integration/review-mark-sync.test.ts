/**
 * keel #565's mark through the engine (conv. 168, R5 and R6): a seat's new
 * element comes back from keel marked proposed, and the copy that made it keeps
 * the mark with its stamp; a keeper's accept (the mark null) and decline (the
 * element deleted) reach the copy on a pull. FakeOwApiClient plays keel's shape
 * as probed live (S459 `setup-565.mjs`).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient, FAKE_SEAT_ID } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { isProposed } from '../../src/core/review-mark';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client, policy: 'pause-on-conflict' });
  await folder.createElement('character', { name: 'Ada' });
  await engine.syncNow();
  client.__propose_writes(true);
});

const mark = (r: unknown) => (r as Record<string, unknown> | null | undefined)?.x_review_proposed;

describe('R5: the seat\'s own copy', () => {
  it('a create keel marks keeps the mark here, clean, and sends nothing more', async () => {
    const quill = await folder.createElement('character', { name: 'Quill' });
    const r = await engine.syncNow();
    expect(r.failures).toEqual([]);
    const local = (await folder.getElement(quill.id))!;
    expect(mark(local)).toEqual({ by: FAKE_SEAT_ID, evidence: 'seat', expires: '2099-01-01' });
    expect(isProposed(local)).toBe(true);
    // The copy is clean: the next round sends nothing, and keel's mark is unchanged.
    const sent = client.calls.length;
    await engine.syncNow();
    expect(client.calls.filter((c, i) => i >= sent && (c.method === 'create' || c.method === 'update'))).toEqual([]);
    expect(mark(client.__server_get('character', quill.id))).toEqual(mark(local));
  });

  it('several creates in one round (/bulk) keep the mark too: a seat reads them back (gate F1)', async () => {
    client.keyRole = 'contributor';
    client.__enable_bulk(true);
    const quill = await folder.createElement('character', { name: 'Quill' });
    const rook = await folder.createElement('character', { name: 'Rook' });
    const r = await engine.syncNow();
    expect(r.failures).toEqual([]);
    expect(client.calls.filter(c => c.method === 'bulk')).toHaveLength(1);
    for (const id of [quill.id, rook.id]) expect(isProposed(await folder.getElement(id))).toBe(true);
    const sent = client.calls.length;
    await engine.syncNow();
    expect(client.calls.filter((c, i) => i >= sent && (c.method === 'create' || c.method === 'update'))).toEqual([]);
  });

  it('a keeper\'s bulk creates take the echo and read nothing back', async () => {
    client.__propose_writes(false);
    client.__enable_bulk(true);
    await folder.createElement('character', { name: 'Bo' });
    await folder.createElement('character', { name: 'Cy' });
    const reads = client.calls.length;
    await engine.syncNow();
    expect(client.calls.filter((c, i) => i >= reads && c.method === 'bulk')).toHaveLength(1);
    expect(client.calls.filter((c, i) => i >= reads && c.method === 'get')).toEqual([]);
  });

  it('a create keel does not mark carries no mark', async () => {
    client.__propose_writes(false);
    const bo = await folder.createElement('character', { name: 'Bo' });
    await engine.syncNow();
    expect(mark(await folder.getElement(bo.id))).toBeUndefined();
  });
});

describe('R6: the keeper settles on OnlyWorlds, the copy follows', () => {
  it('accept writes the mark null, and a pull brings it', async () => {
    const quill = await folder.createElement('character', { name: 'Quill' });
    await engine.syncNow();
    client.__review_new_element('character', quill.id, 'accept');
    await engine.syncNow();
    const local = (await folder.getElement(quill.id))!;
    expect(mark(local)).toBeNull();
    expect(isProposed(local)).toBe(false);
  });

  it('decline deletes it online, and the copy asks as for any delete made online', async () => {
    const quill = await folder.createElement('character', { name: 'Quill' });
    await engine.syncNow();
    client.__review_new_element('character', quill.id, 'decline');
    await engine.syncNow();
    // A delete from keel is never applied unasked: the server-delete review holds it.
    const state = await folder.readSyncState();
    expect(state.server_deletes?.map(d => d.id)).toEqual([quill.id]);
  });
});
