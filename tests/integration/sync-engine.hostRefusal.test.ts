/**
 * The web host's refusal of a write, at the engine (R3, R4, R5, R7).
 *
 * The host in front of keel answers some writes 403 with its own HTML page
 * when their text holds a shell command after a code mark. Before, the
 * engine read that 403 as a dead key: the round bailed, the engine paused
 * red, and every other edit in the world stopped going up. Now it is the one
 * write refused: that element (or the world's details) fails this round and
 * stays changed here, the round goes on, and a changed text goes up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { HOST_HELD_MESSAGE, SyncEngine } from '../../src/sync/sync-engine';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { classifyFailure, describeFailures } from '../../src/sync/sync-failure-copy';
import type { BulkItem } from '../../src/sync/sync-engine';
import { mergeLocalIntoApi } from '../../src/sync/make-online';

const BLOCKED_PAGE = '<!DOCTYPE html><html><head><title>Blocked</title></head><body>Sorry, you have been blocked</body></html>';
/** What the adapter builds for the host's page on a write (no envelope, a body sent). */
const hostRefusal = (): OwV2Error => new OwV2Error(403, null, BLOCKED_PAGE, null, { sentBody: true, hostBlocked: true });
/** Another non-JSON 403 from the host (no Blocked title): the wide tier, said without a cause. */
const otherHostRefusal = (): OwV2Error => new OwV2Error(403, null, '<html><head><title>Access denied</title></head></html>', null, { sentBody: true });
/** keel's own 403 on a read key's write: the key, not the text. */
const keelKeyRefusal = (): OwV2Error => new OwV2Error(403, { type: 'permission_error', code: 'permission_error', message: 'This key may only read.' }, '', null, { sentBody: true });

const REFUSED_TEXT = 'Run `python -m http.server` in the folder';
/** The host's rule, as played: the command right after a code mark. */
const refusedText = (body: unknown): boolean => JSON.stringify(body).includes('`python -m');

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let sent: { create: string[]; update: string[]; bulk: number; meta: number };

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  sent = { create: [], update: [], bulk: 0, meta: 0 };
  // The host reads each request's text: a write whose body holds the command
  // is refused before keel; every other write reaches keel (the fake).
  const create = client.createElement.bind(client);
  client.createElement = async (type, body) => {
    sent.create.push(String(body.id));
    if (refusedText(body)) throw hostRefusal();
    return create(type, body);
  };
  const update = client.updateElement.bind(client);
  client.updateElement = async (type, id, body) => {
    sent.update.push(id);
    if (refusedText(body)) throw hostRefusal();
    return update(type, id, body);
  };
  const patchMeta = client.patchWorldMeta.bind(client);
  client.patchWorldMeta = async (fields) => {
    sent.meta++;
    if (refusedText(fields)) throw hostRefusal();
    return patchMeta(fields);
  };
  engine = new SyncEngine({ folder, client });
});

afterEach(() => engine.stop());

async function changedIds(): Promise<string[]> {
  return (await folder.listLocallyChangedSince(null)).map(e => e.id).sort();
}

describe('R3: an element PATCH or a single create refused by the host', () => {
  it('fails that element only: the round goes on, nothing pauses, the edit stays changed and is sent again', async () => {
    const a = await folder.createElement('character', { name: 'Aldric' });
    const b = await folder.createElement('character', { name: 'Bree' });
    await engine.pushOnce();
    expect(await changedIds()).toEqual([]);

    await folder.updateElement(a.id, { description: REFUSED_TEXT });
    await folder.updateElement(b.id, { description: 'A plain edit' });
    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBeFalsy();
    expect(result.transient_blocked).toBeFalsy();
    expect(engine.getState().kind).toBe('idle');
    expect(engine.isPaused()).toBe(false);
    expect(result.pushed.updates).toBe(1);
    expect(client.__server_get('character', b.id)?.description).toBe('A plain edit');
    expect(client.__server_get('character', a.id)?.description).toBeUndefined();
    // The failure: keel's status, no keel code, the host's kind.
    expect(result.failures).toHaveLength(1);
    const f = result.failures[0];
    expect(f).toMatchObject({ element_id: a.id, operation: 'update', status: 403, source: 'server' });
    expect(f.code).toBeUndefined();
    expect(classifyFailure(f)).toBe('host_refused');
    expect(f.host_blocked).toBe(true);
    // Kept here, changed, and sent again at the next round.
    expect(await changedIds()).toEqual([a.id]);
    expect((await folder.getElement(a.id))?.description).toBe(REFUSED_TEXT);
    const before = sent.update.filter(id => id === a.id).length;
    await engine.pushOnce();
    expect(sent.update.filter(id => id === a.id).length).toBe(before + 1);

    // A changed text goes up.
    await folder.updateElement(a.id, { description: 'Run python -m http.server in the folder' });
    const later = await engine.pushOnce();
    expect(later.failures).toEqual([]);
    expect(await changedIds()).toEqual([]);
  });

  it('another non-JSON 403 from the host is the same failure, recorded without the Blocked flag', async () => {
    const a = await folder.createElement('character', { name: 'Aldric' });
    const b = await folder.createElement('character', { name: 'Bree' });
    await engine.pushOnce();
    const update = client.updateElement.bind(client);
    client.updateElement = async (type, id, body) => {
      if (id === a.id) throw otherHostRefusal();
      return update(type, id, body);
    };
    await folder.updateElement(a.id, { description: 'x' });
    await folder.updateElement(b.id, { description: 'y' });
    const result = await engine.pushOnce();
    expect(result.auth_blocked).toBeFalsy();
    expect(result.pushed.updates).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(classifyFailure(result.failures[0])).toBe('host_refused');
    expect(result.failures[0].host_blocked).toBeUndefined();
  });

  it('a single create refused stays a local create; the update beside it goes up', async () => {
    const b = await folder.createElement('character', { name: 'Bree' });
    await engine.pushOnce();
    const a = await folder.createElement('character', { name: 'Aldric', description: REFUSED_TEXT });
    await folder.updateElement(b.id, { description: 'A plain edit' });

    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBeFalsy();
    expect(result.pushed.updates).toBe(1);
    expect(result.failures.map(x => [x.element_id, x.operation, classifyFailure(x)])).toEqual([[a.id, 'create', 'host_refused']]);
    expect(client.__server_get('character', a.id)).toBeUndefined();
    expect((await folder.getElement(a.id))?.server_updated_at).toBeFalsy();
  });

  it('the bare message form ("API Error 403: <html…") is the same failure, with its status recorded', async () => {
    const a = await folder.createElement('character', { name: 'Aldric' });
    const b = await folder.createElement('character', { name: 'Bree' });
    await engine.pushOnce();
    const update = client.updateElement.bind(client);
    client.updateElement = async (type, id, body) => {
      if (id === a.id) throw new Error(`API Error 403: ${BLOCKED_PAGE}`);
      return update(type, id, body);
    };
    await folder.updateElement(a.id, { description: 'x' });
    await folder.updateElement(b.id, { description: 'y' });
    const result = await engine.pushOnce();
    expect(result.auth_blocked).toBeFalsy();
    expect(result.pushed.updates).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]).toMatchObject({ element_id: a.id, status: 403, source: 'server' });
    expect(classifyFailure(result.failures[0])).toBe('host_refused');
  });

  it('keel\'s own 403 on the same write still bails the round (R7)', async () => {
    const a = await folder.createElement('character', { name: 'Aldric' });
    const b = await folder.createElement('character', { name: 'Bree' });
    await engine.pushOnce();
    client.updateElement = async () => { throw keelKeyRefusal(); };
    await folder.updateElement(a.id, { description: 'x' });
    await folder.updateElement(b.id, { description: 'y' });
    const result = await engine.pushOnce();
    expect(result.auth_blocked).toBe(true);
    expect(engine.getState().kind).toBe('error');
  });
});

describe('R4: a bulk create refused by the host', () => {
  beforeEach(() => {
    client.__enable_bulk();
    const bulk = client.bulkCreate!.bind(client);
    client.bulkCreate = async (items: BulkItem[], opts) => {
      sent.bulk++;
      if (items.some(it => refusedText(it.element))) throw hostRefusal();
      return bulk(items, opts);
    };
  });

  it('sends the batch one at a time in the same round, so only the refused element fails', async () => {
    const a = await folder.createElement('character', { name: 'Aldric', description: REFUSED_TEXT });
    const b = await folder.createElement('character', { name: 'Bree' });
    const c = await folder.createElement('location', { name: 'Cairn' });

    const result = await engine.pushOnce();

    expect(sent.bulk).toBe(1);
    expect(sent.create.sort()).toEqual([a.id, b.id, c.id].sort());
    expect(result.auth_blocked).toBeFalsy();
    expect(result.transient_blocked).toBeFalsy();
    expect(engine.getState().kind).toBe('idle');
    expect(result.pushed.creates).toBe(2);
    expect(client.__server_get('character', b.id)).toBeTruthy();
    expect(client.__server_get('location', c.id)).toBeTruthy();
    // Stamped as a single create stamps them.
    expect((await folder.getElement(b.id))?.server_updated_at).toBeTruthy();
    expect((await folder.getElement(c.id))?.server_updated_at).toBeTruthy();
    expect(result.failures.map(x => [x.element_id, x.operation, classifyFailure(x)])).toEqual([[a.id, 'create', 'host_refused']]);
    expect(await changedIds()).toEqual([a.id]);
  });

  it('a bulk answered by keel\'s own 403 still bails, and nothing goes one at a time (R7)', async () => {
    client.bulkCreate = async () => { sent.bulk++; throw keelKeyRefusal(); };
    await folder.createElement('character', { name: 'Aldric' });
    await folder.createElement('character', { name: 'Bree' });
    const result = await engine.pushOnce();
    expect(sent.bulk).toBe(1);
    expect(sent.create).toEqual([]);
    expect(result.auth_blocked).toBe(true);
  });
});

describe('R4: links inside a host-refused batch', () => {
  beforeEach(() => {
    // keel refuses a single create that links an element it does not hold.
    client.strictUpdateLinks = true;
    client.__enable_bulk();
    const bulk = client.bulkCreate!.bind(client);
    client.bulkCreate = async (items: BulkItem[], opts) => {
      sent.bulk++;
      if (items.some(it => refusedText(it.element))) throw hostRefusal();
      return bulk(items, opts);
    };
  });

  it('two new elements that name each other land in round one beside a refused one, which stays refused; one refusal said each round', async () => {
    const a = await folder.createElement('character', { name: 'Aldric' });
    const b = await folder.createElement('character', { name: 'Bree', friends: [a.id] });
    await folder.updateElement(a.id, { friends: [b.id] });
    const x = await folder.createElement('character', { name: 'Xan', description: REFUSED_TEXT });

    for (let round = 1; round <= 3; round++) {
      const result = await engine.pushOnce();
      expect(result.auth_blocked, `round ${round}`).toBeFalsy();
      expect(result.failures.map(f => [f.element_id, classifyFailure(f)]), `round ${round}`).toEqual([[x.id, 'host_refused']]);
      expect(describeFailures(result.failures), `round ${round}`).toMatch(/^1 change was refused by the web host in front of OnlyWorlds/);
      if (round === 1) expect(result.pushed.creates).toBe(2);
    }
    expect(client.__server_get('character', a.id)?.friends).toEqual([b.id]);
    expect(client.__server_get('character', b.id)?.friends).toEqual([a.id]);
    expect(client.__server_get('character', x.id)).toBeUndefined();
    expect(await changedIds()).toEqual([x.id]);
  });

  it('when the host refuses the second bulk too, the pair stays failed as it was', async () => {
    client.bulkCreate = async () => { sent.bulk++; throw hostRefusal(); };
    const a = await folder.createElement('character', { name: 'Aldric' });
    const b = await folder.createElement('character', { name: 'Bree', friends: [a.id] });
    await folder.updateElement(a.id, { friends: [b.id] });
    const x = await folder.createElement('character', { name: 'Xan', description: REFUSED_TEXT });

    const result = await engine.pushOnce();

    expect(sent.bulk).toBe(2);
    expect(result.pushed.creates).toBe(0);
    expect(result.failures.map(f => f.element_id).sort()).toEqual([a.id, b.id, x.id].sort());
    expect(await changedIds()).toEqual([a.id, b.id, x.id].sort());
  });

  it('a create whose link names a create keel refused for another reason is not sent again in a bulk', async () => {
    const b = await folder.createElement('character', { name: 'Bree' });
    const a = await folder.createElement('character', { name: 'Aldric', friends: [b.id] });
    const x = await folder.createElement('character', { name: 'Xan', description: REFUSED_TEXT });
    client.__inject_failure('create', b.id, 'API Error 422: name is not valid');

    const result = await engine.pushOnce();

    expect(sent.bulk).toBe(1); // the refused batch only: no second bulk for Aldric alone
    expect(result.failures.map(f => f.element_id).sort()).toEqual([a.id, b.id, x.id].sort());
    expect(classifyFailure(result.failures.find(f => f.element_id === x.id)!)).toBe('host_refused');
  });

  it('a create, and an update, that link a create the host refused are held and never sent, the host named', async () => {
    const w = await folder.createElement('character', { name: 'Wren' });
    await engine.pushOnce();
    const x = await folder.createElement('character', { name: 'Xan', description: REFUSED_TEXT });
    const y = await folder.createElement('character', { name: 'Yara', friends: [x.id] });
    const z = await folder.createElement('character', { name: 'Zed' });
    // Held in turn: it links the held Yara.
    const v = await folder.createElement('character', { name: 'Vale', friends: [y.id] });
    await folder.updateElement(w.id, { friends: [x.id] });
    sent.create = []; sent.update = [];

    const result = await engine.pushOnce();

    expect(sent.create.sort()).toEqual([x.id, z.id].sort());
    expect(sent.update).toEqual([]);
    expect(client.__server_get('character', z.id)).toBeTruthy();
    const byId = new Map(result.failures.map(f => [f.element_id, f]));
    expect(classifyFailure(byId.get(x.id)!)).toBe('host_refused');
    expect(byId.get(y.id)).toMatchObject({ operation: 'create', message: HOST_HELD_MESSAGE });
    expect(byId.get(w.id)).toMatchObject({ operation: 'update', message: HOST_HELD_MESSAGE });
    expect(byId.get(v.id)).toMatchObject({ operation: 'create', message: HOST_HELD_MESSAGE });
    expect(result.failures).toHaveLength(4);
  });
});

describe('R5: the world\'s details refused by the host', () => {
  it('stay changed here, the round goes on, and the failure is the host\'s on the world', async () => {
    client.__server_mutate_world_meta({ description: 'server desc' });
    await engine.syncNow(); // the seed round: baseline, no PATCH
    const b = await folder.createElement('character', { name: 'Bree' });
    await engine.pushOnce();

    await folder.writeWorldMeta({ description: REFUSED_TEXT });
    await folder.updateElement(b.id, { description: 'A plain edit' });
    const result = await engine.pushOnce();

    expect(result.auth_blocked).toBeFalsy();
    expect(engine.getState().kind).toBe('idle');
    expect(result.pushed.updates).toBe(1);
    const world = result.failures.filter(f => f.type === 'world');
    expect(world).toHaveLength(1);
    expect(world[0]).toMatchObject({ element_id: 'world', operation: 'update', status: 403 });
    expect(classifyFailure(world[0])).toBe('host_refused');
    expect(world[0].host_blocked).toBe(true);
    expect((await folder.readWorldMeta()).description).toBe(REFUSED_TEXT);
    // Still changed: the next round sends it again; a changed text goes up.
    const before = sent.meta;
    await engine.pushOnce();
    expect(sent.meta).toBe(before + 1);
    await folder.writeWorldMeta({ description: 'Run python -m http.server' });
    const later = await engine.pushOnce();
    expect(later.failures).toEqual([]);
    expect(later.meta_pushed).toEqual(['description']);
  });
});

describe('Make online, link to existing: its bulk refused by the host', () => {
  it('records the host\'s kind, so the link\'s toast says the host\'s words', async () => {
    client.__enable_bulk();
    client.bulkCreate = async () => { throw hostRefusal(); };
    const a = await folder.createElement('character', { name: 'Aldric', description: REFUSED_TEXT });
    await folder.createElement('character', { name: 'Bree' });
    const result = await mergeLocalIntoApi(folder, client, 'b');
    expect(result.failures).toHaveLength(2);
    expect(result.failures.map(classifyFailure)).toEqual(['host_refused', 'host_refused']);
    expect(result.failures.find(f => f.element_id === a.id)?.code).toBeUndefined();
    expect(result.failures.every(f => f.host_blocked === true)).toBe(true);
  });
});
