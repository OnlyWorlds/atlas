/**
 * Foreign ids, recorded on evidence only (S363, re-key gate lens 2 F3/F7).
 *
 * The list is the re-key's worklist, so a false entry is dangerous: re-keying
 * an element that DOES live in this world leaves the server holding it twice.
 * A single POST 409s for a same-world id too, so only a read-back that
 * answered "not here" (or a /bulk id_conflict, which never fires for a
 * same-world id) counts.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { liveForeignIds } from '../../src/sync/foreign-ids';
import { classifyFailure } from '../../src/sync/sync-failure-copy';

const API_WORLD = 'api-world-1';
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
  engine = new SyncEngine({ folder, client, apiWorldId: API_WORLD });
});

const KEEL_FOREIGN = 'An element with id x already exists in another world. give this element a new id (a copied world folder needs fresh ids).';
const stored = async () => (await folder.readSyncState()).foreign;
const live = async () => liveForeignIds(await stored(), API_WORLD, await folder.listElements());

describe('foreign ids: what counts as evidence', () => {
  it('a single-create 409 whose read-back answers "not here" is recorded', async () => {
    const a = await folder.createElement('character', { name: 'A' });
    client.__inject_failure('create', a.id, 'API Error 409: id_conflict');
    client.getElement = async () => null;
    const res = await engine.pushOnce();
    expect((await live()).map(e => e.id)).toEqual([a.id]);
    expect(classifyFailure(res.failures.find(f => f.element_id === a.id)!)).toBe('foreign_id');
  });

  it('a 409 whose read-back FAILS (503) is neither recorded nor called foreign', async () => {
    const a = await folder.createElement('character', { name: 'A' });
    client.__inject_failure('create', a.id, 'API Error 409: id_conflict');
    client.getElement = async () => { throw new Error('API Error 503: Service Unavailable'); };
    const res = await engine.pushOnce();
    expect(await live()).toEqual([]);
    expect(classifyFailure(res.failures.find(f => f.element_id === a.id)!)).toBe('other');
  });

  it('an auth-blocked round records nothing', async () => {
    const a = await folder.createElement('character', { name: 'A' });
    client.__inject_failure('create', a.id, 'API Error 409: id_conflict');
    client.getElement = async () => { throw new Error('API Error 401: Unauthorized'); };
    const res = await engine.pushOnce();
    expect(res.auth_blocked).toBe(true);
    expect(await stored()).toBeUndefined();
  });

  it('a /bulk id_conflict item nothing here can adopt is recorded', async () => {
    client.__enable_bulk();
    const a = await folder.createElement('character', { name: 'A' });
    const b = await folder.createElement('character', { name: 'B' });
    client.__inject_bulk_item_failure(a.id, { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' });
    await engine.pushOnce();
    expect((await live()).map(e => e.id)).toEqual([a.id]);
    expect((await folder.getElement(b.id))!.server_updated_at).toBeTruthy();
  });
});

describe('foreign ids: entries leave when they stop being true', () => {
  async function recordForeign(): Promise<string> {
    const a = await folder.createElement('character', { name: 'A' });
    client.__inject_failure('create', a.id, 'API Error 409: id_conflict');
    const realGet = client.getElement.bind(client);
    client.getElement = async () => null;
    await engine.pushOnce();
    client.getElement = realGet;
    expect((await live()).map(e => e.id)).toEqual([a.id]);
    return a.id;
  }

  it('a local delete drops it from the stored list on the next round', async () => {
    const id = await recordForeign();
    await folder.deleteElement(id);
    await engine.pushOnce();
    expect((await stored())?.ids.map(e => e.id)).toEqual([]);
  });

  it('an element that later uploads drops out', async () => {
    const id = await recordForeign();
    await folder.updateElement(id, { description: 'retry' });
    await engine.pushOnce(); // the injected failure was one-shot: this create lands
    expect((await folder.getElement(id))!.server_updated_at).toBeTruthy();
    expect((await stored())?.ids.map(e => e.id)).toEqual([]);
  });

  it('entries observed against another api world are ignored and then discarded', async () => {
    const id = await recordForeign();
    expect(liveForeignIds(await stored(), 'some-other-world', await folder.listElements())).toEqual([]);
    const other = new SyncEngine({ folder, client, apiWorldId: 'some-other-world' });
    await folder.updateElement(id, { description: 'x' });
    client.__inject_failure('create', id, 'API Error 500: boom');
    await other.pushOnce();
    const s = await stored();
    expect(s?.api_world_id).toBe('some-other-world');
    expect(s?.ids).toEqual([]);
  });

  it('resetSyncBaseline clears the list', async () => {
    await recordForeign();
    await folder.resetSyncBaseline();
    expect(await stored()).toBeUndefined();
  });
});

describe('an update that links to a create refused in the same round waits', () => {
  it('bulk path: the referrer is held back, not sent to be refused whole', async () => {
    client.__enable_bulk();
    const r = await folder.createElement('location', { name: 'R' });
    await engine.pushOnce();
    const n1 = await folder.createElement('character', { name: 'N1' });
    await folder.createElement('character', { name: 'N2' });
    await folder.updateElement(r.id, { rivals: [n1.id] } as never);
    client.__inject_bulk_item_failure(n1.id, { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' });
    client.calls.length = 0;
    const res = await engine.pushOnce();
    const methods = client.calls.map(c => (c as { method: string }).method);
    expect(methods).not.toContain('update');
    expect(res.failures.find(f => f.element_id === r.id)?.message).toMatch(/waits for an element/);
    expect((await folder.getElement(r.id))!.local_updated_at > (await folder.getElement(r.id))!.server_updated_at!).toBe(true);
  });

  it('single path: a refused create holds back the update after it', async () => {
    const r = await folder.createElement('location', { name: 'R' });
    await engine.pushOnce();
    const n1 = await folder.createElement('character', { name: 'N1' });
    await folder.updateElement(r.id, { rivals: [n1.id] } as never);
    client.__inject_failure('create', n1.id, 'API Error 400: boom');
    client.calls.length = 0;
    await engine.pushOnce();
    expect(client.calls.map(c => (c as { method: string }).method)).not.toContain('update');
  });

  it('an update with no link to a refused create still goes', async () => {
    client.__enable_bulk();
    const r = await folder.createElement('location', { name: 'R' });
    await engine.pushOnce();
    const n1 = await folder.createElement('character', { name: 'N1' });
    await folder.createElement('character', { name: 'N2' });
    await folder.updateElement(r.id, { description: 'edited' });
    client.__inject_bulk_item_failure(n1.id, { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' });
    client.calls.length = 0;
    await engine.pushOnce();
    expect(client.calls.map(c => (c as { method: string }).method)).toContain('update');
  });
});
