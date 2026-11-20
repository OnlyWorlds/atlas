/**
 * A copy with no record of what OnlyWorlds held (conv. 192): a file with no
 * `server_updated_at` (or one marked unknown) whose id keel already holds. The
 * contract's promises I1 to I7 and the gate's MUSTs, on the real FsFolderStore
 * over the in-memory FS and the real SyncEngine, against FakeOwApiClient as
 * keel serves (every field, `change_seq`, `/bulk` as an upsert, `?ids=`,
 * `If-Match`). Each probe of the contract's round (`probe:N`, `adopt:A1..A3`)
 * and of its gate (G2 to G5) is here inverted; G1 is the banked case (M4).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { SyncEngine, CHANGED_WHILE_OPEN, VIEW_ONLY_KEEP_THIS } from '../../src/sync/sync-engine';
import { isBaselineUnknown } from '../../src/core/baseline-unknown';
import { classifyFailure } from '../../src/sync/sync-failure-copy';
import { bulkReplacedLine } from '../../src/sync/sync-attach';
import type { BulkItem } from '../../src/sync/sync-engine';
import type { Element } from '../../src/core/types';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let now = 0;
const tick = () => new Date(++now).toISOString();
const A = '00000000-0000-4000-8000-0000000a0001';
const B = '00000000-0000-4000-8000-0000000b0002';
const C = '00000000-0000-4000-8000-0000000c0003';
const L = '00000000-0000-4000-8000-0000000d0004';
const F = '00000000-0000-4000-8000-0000000e0005';
const DIR = 'elements/character';
type Policy = 'local-wins' | 'pause-and-review';
const POLICIES: Policy[] = ['local-wins', 'pause-and-review'];

let root: FakeDirHandle;
let store: FsFolderStore;
let client: FakeOwApiClient;

async function openStore(): Promise<FsFolderStore> {
  const s = new FsFolderStore({ clock: tick, tabId: `t${now}`, disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  await s.listElements();
  await s.awaitTidies();
  return s;
}

beforeEach(async () => {
  now = Date.parse('2026-11-20T10:00:00.000Z');
  root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  root.put(`${DIR}/.keep`, '');
  root.put('elements/narrative/.keep', '');
  root.put('elements/location/.keep', '');
  store = await openStore();
  client = new FakeOwApiClient();
  client.setClock(tick);
});

const stamp = () => new Date(now += 1000).toISOString();
const pathOf = (id: string): string =>
  root.list().find(p => p.endsWith('.json') && p.startsWith('elements/') && (() => { try { return JSON.parse(root.get(p)!).id === id; } catch { return false; } })())
  ?? `${DIR}/x--${id.slice(-8)}.json`;
/** An outside writer (a restore, an AI, a second computer) puts a file in place, then the live folder reads it. */
async function put(id: string, body: Record<string, unknown>): Promise<void> {
  root.put(pathOf(id), j({ id, type: 'character', ...body }));
  await store.rescanDisk();
}
const file = (id: string) => JSON.parse(root.get(pathOf(id))!) as Record<string, unknown>;
const onKeel = (id: string, type: 'character' | 'location' | 'narrative' = 'character') => client.__server_get(type, id) as Record<string, unknown>;
const rows = async () => (await store.readSyncState()).conflicts;
const writesFor = (id: string) => client.calls.filter(c => (c.method === 'create' || c.method === 'update' || c.method === 'delete') && ((c as { id?: string }).id === id || (c as { body?: { id?: string } }).body?.id === id));
const engineFor = (policy: Policy, extra: Partial<ConstructorParameters<typeof SyncEngine>[0]> = {}) => new SyncEngine({ folder: store, client, policy, ...extra });

/** keel holds A as Atlas sent it (v1); returns the engine. */
async function online(policy: Policy, body: Record<string, unknown> = { name: 'Ada', description: 'v1' }): Promise<SyncEngine> {
  await put(A, { ...body, local_updated_at: stamp() });
  const engine = engineFor(policy);
  await engine.pushOnce();
  expect(file(A).server_updated_at).toBeTruthy();
  return engine;
}

/** The copy comes back as it was before its first stamp: these bytes, no baseline, a fresh edit time. */
const restore = (id: string, body: Record<string, unknown>) => put(id, { ...body, local_updated_at: stamp() });

/** The first create lands on keel and its answer is lost. */
function loseFirstCreate(onInFlight?: () => Promise<void>): void {
  const real = client.createElement.bind(client);
  let once = true;
  client.createElement = async (type, body) => {
    if (!once) return real(type, body);
    once = false;
    if (onInFlight) await onInFlight();
    await real(type, body);
    throw new Error('network: response lost');
  };
}

describe('I1: a newer account edit is never overwritten unseen', () => {
  for (const policy of POLICIES) {
    it(`[${policy}] a restored copy over a member's edit, one create (probe:202): a row, keel's copy unchanged`, async () => {
      const engine = await online(policy);
      client.__server_mutate('character', A, { description: 'v3 member' });
      await restore(A, { name: 'Ada', description: 'v1' });
      client.calls = [];
      const r1 = await engine.pushOnce();
      const r2 = await engine.pushOnce();
      expect(onKeel(A).description).toBe('v3 member');
      expect(writesFor(A).map(c => c.method)).toEqual(['create']);
      expect([...r1.conflicts, ...r2.conflicts].map(c => c.element_id)).toEqual([A]);
      const held = await rows();
      expect(held.map(c => [c.element_id, c.no_baseline, c.fields])).toEqual([[A, true, ['description']]]);
      expect(held[0].theirs).toEqual({ description: 'v3 member' });
      expect(file(A).description).toBe('v1');
      expect(isBaselineUnknown(file(A))).toBe(true);
    });

    it(`[${policy}] its own earlier bytes over its own later version (probe:142): a row, the later version stays`, async () => {
      const engine = await online(policy);
      await put(A, { ...file(A), description: 'v2', local_updated_at: stamp() });
      await engine.pushOnce();
      expect(onKeel(A).description).toBe('v2');
      await restore(A, { name: 'Ada', description: 'v1' });
      await engine.pushOnce();
      await engine.pushOnce();
      expect(onKeel(A).description).toBe('v2');
      expect((await rows()).map(c => c.element_id)).toEqual([A]);
    });

    it(`[${policy}] two restored copies through /bulk (adopt:A1): the check finds both, nothing replaced, the member's field kept`, async () => {
      client.__enable_bulk();
      const engine = engineFor(policy);
      await put(A, { name: 'Ada', description: 'v1', local_updated_at: stamp() });
      await put(B, { name: 'Bo', description: 'v1', local_updated_at: stamp() });
      await engine.pushOnce();
      client.__server_mutate('character', A, { description: 'member', background: 'member added' });
      client.__server_mutate('character', B, { description: 'member' });
      await restore(A, { name: 'Ada', description: 'v1' });
      await restore(B, { name: 'Bo', description: 'v1' });
      client.calls = [];
      await engine.pushOnce();
      expect(client.calls.map(c => c.method)).not.toContain('bulk');
      expect(onKeel(A).description).toBe('member');
      expect(onKeel(A).background).toBe('member added');
      expect(onKeel(B).description).toBe('member');
      expect((await rows()).map(c => c.element_id).sort()).toEqual([A, B]);
      expect((await rows()).find(c => c.element_id === A)!.fields.sort()).toEqual(['background', 'description']);
    });

    it(`[${policy}] Atlas's own lost create with a member's edit before the retry (adopt:A2): a row`, async () => {
      const engine = engineFor(policy);
      await put(A, { name: 'Ada', description: 'mine', local_updated_at: stamp() });
      loseFirstCreate();
      await engine.pushOnce();
      expect(file(A).server_updated_at).toBeUndefined();
      client.__server_mutate('character', A, { description: 'member' });
      await engine.pushOnce();
      await engine.pushOnce();
      expect(onKeel(A).description).toBe('member');
      expect((await rows()).map(c => c.element_id)).toEqual([A]);
    });
  }
});

describe('I2: the lost create still settles silently', () => {
  it('nobody edited it: adopted clean, no row, and no further call of any kind for it (full bodies, adopt:A3 inverted)', async () => {
    const engine = engineFor('local-wins');
    await put(A, { name: 'Ada', description: 'same', local_updated_at: stamp() });
    loseFirstCreate();
    await engine.pushOnce();
    const r = await engine.pushOnce(); // 409, read back keel's whole body: the same content
    expect(r.conflicts).toEqual([]);
    expect(file(A).server_updated_at).toBe(onKeel(A).updated_at);
    client.calls = [];
    await engine.pushOnce();
    await engine.syncNow();
    expect(client.calls.filter(c => (c as { id?: string }).id === A || (c as { body?: { id?: string } }).body?.id === A)).toEqual([]);
    expect(await rows()).toEqual([]);
    expect(await store.listLocallyChangedSince(null)).toEqual([]);
  });

  it('M2 (G2 inverted): the same content back with a local stamp after keel\'s: keel\'s stamp is the local one too, nothing sent', async () => {
    const engine = await online('local-wins', { name: 'Ada', description: 'same' });
    const keelStamp = onKeel(A).updated_at as string;
    await restore(A, { name: 'Ada', description: 'same' });
    client.calls = [];
    await engine.pushOnce(); // 409, the same content: adopted
    await engine.pushOnce();
    expect(client.calls.map(c => c.method)).toEqual(['create', 'get']);
    expect(onKeel(A).updated_at).toBe(keelStamp);
    expect(file(A).local_updated_at).toBe(keelStamp);
    expect(file(A).server_updated_at).toBe(keelStamp);
  });

  it('M1 (G3 inverted): a reviewed world, its own lost create, nobody edited: keel\'s review mark is no difference, kept on the copy', async () => {
    client.__propose_writes(true);
    const engine = engineFor('pause-and-review');
    await put(A, { name: 'Ada', description: 'mine', local_updated_at: stamp() });
    loseFirstCreate();
    await engine.pushOnce();
    client.calls = [];
    const r1 = await engine.pushOnce();
    const r2 = await engine.pushOnce();
    expect(r1.conflicts.length + r2.conflicts.length).toBe(0);
    expect(client.calls.map(c => c.method)).toEqual(['create', 'get']);
    expect(client.__proposals()).toEqual([]);
    expect(file(A).x_review_proposed).toEqual(onKeel(A).x_review_proposed);
    expect(await rows()).toEqual([]);
  });

  it('the /bulk form: a lost /bulk answer, retried: the check finds both the same, adopted, no /bulk again', async () => {
    client.__enable_bulk();
    const engine = engineFor('local-wins');
    await put(A, { name: 'Ada', description: 'a', local_updated_at: stamp() });
    await put(B, { name: 'Bo', description: 'b', local_updated_at: stamp() });
    const real = client.bulkCreate!;
    let once = true;
    client.bulkCreate = async (items, opts) => {
      const r = await real(items, opts);
      if (once) { once = false; throw new Error('network: response lost'); }
      return r;
    };
    await engine.pushOnce();
    expect(file(A).server_updated_at).toBeUndefined();
    client.calls = [];
    const r = await engine.pushOnce();
    expect(r.conflicts).toEqual([]);
    expect(client.calls.map(c => c.method)).toEqual([]);
    expect(client.idsReads[client.idsReads.length - 1].ids.sort()).toEqual([A, B]);
    expect(await store.listLocallyChangedSince(null)).toEqual([]);
  });
});

describe('I3: nothing changes for a file that carries server_updated_at', () => {
  for (const policy of POLICIES) {
    it(`[${policy}] a stamped push conflict: the same calls in the same order (S4: the hold is only for rows with no record)`, async () => {
      const engine = await online(policy);
      client.__server_mutate('character', A, { description: 'member' });
      await put(A, { ...file(A), description: 'mine', local_updated_at: stamp() });
      client.calls = [];
      const r = await engine.pushOnce();
      expect(r.conflicts.map(c => [c.element_id, c.no_baseline])).toEqual([[A, undefined]]);
      expect(client.calls.map(c => c.method)).toEqual(policy === 'local-wins' ? ['get', 'update'] : ['get']);
      if (policy === 'pause-and-review') {
        client.calls = [];
        await engine.pushOnce();
        expect(client.calls.map(c => c.method)).toEqual(['get']); // the stamped row still reads keel each round
      }
      expect(isBaselineUnknown(file(A))).toBe(false);
    });
  }
});

describe('I4: a shared world on pause-and-review holds it', () => {
  it('probe:217 inverted: the pull\'s row holds through pushes, pulls and a reopen; keel\'s copy unchanged', async () => {
    let engine = await online('pause-and-review');
    await engine.pullNow();
    client.__server_mutate('character', A, { description: 'v3 member' });
    await restore(A, { name: 'Ada', description: 'v1' });
    const p = await engine.pullNow();
    expect(p.conflicts.map(c => [c.element_id, c.no_baseline])).toEqual([[A, true]]);
    await engine.pushOnce();
    await engine.pushOnce();
    await engine.pullNow();
    // Reopen: a new store and engine on the same folder.
    await store.close();
    store = await openStore();
    engine = engineFor('pause-and-review');
    client.calls = [];
    await engine.pushOnce();
    await engine.syncNow();
    expect(writesFor(A)).toEqual([]);
    expect(onKeel(A).description).toBe('v3 member');
    expect(file(A).description).toBe('v1');
    expect((await rows()).map(c => c.element_id)).toEqual([A]);
  });

  for (const policy of POLICIES) {
    it(`[${policy}] the mark alone holds it: a copy restored with its old edit time, its row lost (a held sync-state), is held again, never PATCHed`, async () => {
      const engine = await online(policy);
      const oldLocal = file(A).local_updated_at as string;
      client.__server_mutate('character', A, { description: 'v3 member' });
      // A backup of the file as it was before its first stamp: the old edit time, before keel's.
      await put(A, { name: 'Ada', description: 'v1', local_updated_at: oldLocal });
      await engine.pushOnce();
      expect(isBaselineUnknown(file(A))).toBe(true);
      expect(Date.parse(file(A).local_updated_at as string) < Date.parse(file(A).server_updated_at as string)).toBe(true);
      await store.updateSyncState(() => ({ conflicts: [] }));
      client.__server_mutate('character', A, { description: 'v4 member' });
      client.calls = [];
      await engine.pushOnce();
      expect(client.calls.filter(c => c.method === 'update')).toEqual([]);
      expect(onKeel(A).description).toBe('v4 member');
      expect((await rows()).map(c => [c.element_id, c.theirs])).toEqual([[A, { description: 'v4 member' }]]);
    });
  }

  it('under local-wins too (R5, S4): the pull\'s row is kept, and the push that follows sends nothing', async () => {
    const engine = await online('local-wins');
    await engine.pullNow();
    client.__server_mutate('character', A, { description: 'v3 member' });
    await restore(A, { name: 'Ada', description: 'v1' });
    await engine.pullNow();
    expect((await rows()).map(c => c.element_id)).toEqual([A]);
    client.calls = [];
    await engine.pushOnce(); // the convergence push the attach would send
    expect(client.calls).toEqual([]);
    expect(onKeel(A).description).toBe('v3 member');
  });
});

describe('I5: /bulk never replaces an element keel held', () => {
  function captureBulk(): string[][] {
    const sent: string[][] = [];
    const real = client.bulkCreate!;
    client.bulkCreate = async (items: BulkItem[], opts) => {
      sent.push(items.map(it => it.element.id as string));
      return real(items, opts);
    };
    return sent;
  }

  it('no item carries an id the check answered as held', async () => {
    client.__enable_bulk();
    const engine = await online('local-wins');
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'v1' });
    await put(B, { name: 'Bo', local_updated_at: stamp() });
    await put(C, { name: 'Cy', local_updated_at: stamp() });
    const sent = captureBulk();
    await engine.pushOnce();
    expect(sent).toEqual([[B, C]]);
    expect(onKeel(A).description).toBe('member');
  });

  it('M5: an id the check did not answer (a page left unread) leaves the batch and goes alone: its 409 is the check', async () => {
    client.__enable_bulk();
    const engine = await online('local-wins');
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'v1' });
    await put(B, { name: 'Bo', local_updated_at: stamp() });
    await put(C, { name: 'Cy', local_updated_at: stamp() });
    client.idsReadCut = 0;
    const sent = captureBulk();
    client.calls = [];
    await engine.pushOnce();
    expect(sent).toEqual([]);
    expect(client.calls.filter(c => c.method === 'create').length).toBe(3);
    expect(onKeel(A).description).toBe('member');
    expect((await rows()).map(c => c.element_id)).toEqual([A]);
  });

  it('M5: a check that fails sends each alone, never a batch', async () => {
    client.__enable_bulk();
    await put(B, { name: 'Bo', local_updated_at: stamp() });
    await put(C, { name: 'Cy', local_updated_at: stamp() });
    client.idsReadFails = Object.assign(new Error('API Error 422: ids must be a comma-separated list of ids.'), { status: 422, code: 'invalid_request', param: 'ids' });
    const sent = captureBulk();
    await engineFor('local-wins').pushOnce();
    expect(sent).toEqual([]);
    expect(file(B).server_updated_at && file(C).server_updated_at).toBeTruthy();
  });

  it('S5: a slot answered 200 (a race the check lost) is said, never silent', async () => {
    client.__enable_bulk();
    const engine = await online('local-wins');
    await restore(A, { name: 'Ada', description: 'v1' });
    await put(B, { name: 'Bo', local_updated_at: stamp() });
    client.listByIds = async () => ({ records: [], complete: true }); // another place sent A in the window
    const r = await engine.pushOnce();
    expect(r.bulk_replaced_ids).toEqual([A]);
    expect(bulkReplacedLine(1)).toMatch(/^OnlyWorlds already held one element this copy sent as new/);
  });

  it('N2: only Make Online\'s first round on a world made empty skips the check', async () => {
    client.__enable_bulk();
    await put(B, { name: 'Bo', local_updated_at: stamp() });
    await put(C, { name: 'Cy', local_updated_at: stamp() });
    await engineFor('local-wins', { freshWorld: true }).pushOnce();
    expect(client.idsReads).toEqual([]);
    await put(A, { name: 'Ada', local_updated_at: stamp() });
    await put(L, { name: 'Lu', local_updated_at: stamp() });
    await engineFor('local-wins').pushOnce();
    expect(client.idsReads.length).toBe(1);
  });
});

describe('I6: one decision whichever door', () => {
  type Case = { name: string; file: Record<string, unknown>; keel: Record<string, unknown>; same: boolean; fields?: string[]; setup?: () => Promise<void> };
  const cases: Case[] = [
    { name: 'a sparse file and keel\'s whole body of the same content', file: { name: 'Ada', description: 'd' }, keel: {}, same: true },
    { name: 'keel\'s review mark on its own create (M1)', file: { name: 'Ada', description: 'd' }, keel: { x_review_proposed: { by: 'seat-0001', evidence: 'seat', expires: '2099-01-01' } }, same: true },
    { name: 'link ids in another case and a repeat in a list (S1)', file: { name: 'Ada', description: 'd', birthplace: L.toUpperCase(), friends: [F, F.toUpperCase()] }, keel: { birthplace: L, friends: [F] }, same: true },
    { name: 'a kept link keel\'s read leaves out (S1)', file: { name: 'Ada', description: 'd', friends: [F, L] }, keel: { friends: [F] }, same: true,
      setup: async () => { await store.updateSyncState(() => ({ kept_outside_view: [L] })); } },
    { name: 'a number keel coerced from a text (S1: a row, said)', file: { name: 'Ada', description: 'd', height: '5' }, keel: { height: 5 }, same: false, fields: ['height'] },
    { name: 'other content', file: { name: 'Ada', description: 'mine' }, keel: { description: 'theirs' }, same: false, fields: ['description'] },
  ];
  const doors = ['post', 'bulk', 'bulk-409', 'pull', 'pull-then-push'] as const;

  for (const c of cases) {
    for (const door of doors) {
      it(`${c.name}, through ${door}`, async () => {
        // keel holds A: created by someone, then as the case says.
        await client.createElement('character', { id: A, name: 'Ada', description: 'd' });
        if (Object.keys(c.keel).length) client.__server_mutate('character', A, c.keel);
        await c.setup?.();
        const keelStamp = onKeel(A).updated_at as string;
        await put(A, { ...c.file, local_updated_at: stamp() });
        if (door.startsWith('bulk')) {
          client.__enable_bulk();
          await put(B, { name: 'Bo', local_updated_at: stamp() });
          if (door === 'bulk-409') {
            client.listByIds = async () => ({ records: [], complete: true });
            client.__inject_bulk_item_failure(A, { code: 'id_conflict', message: `An element with id ${A} already exists. Use PUT to upsert, or POST without an id.`, param: 'id' });
          }
        }
        const engine = engineFor('local-wins');
        const said: unknown[] = [];
        if (door === 'pull' || door === 'pull-then-push') said.push(...(await engine.pullNow()).conflicts);
        if (door !== 'pull') said.push(...(await engine.pushOnce()).conflicts);
        expect(onKeel(A).updated_at).toBe(keelStamp);
        if (c.same) {
          // Nothing to choose: no row kept and none in the round's own word (the attach would say it).
          expect(said).toEqual([]);
          expect(await rows()).toEqual([]);
          expect(file(A).server_updated_at).toBe(keelStamp);
          expect((await store.listLocallyChangedSince(null)).map(e => e.id)).not.toContain(A);
        } else {
          expect((await rows()).map(r => [r.element_id, r.no_baseline, r.fields])).toEqual([[A, true, c.fields]]);
          expect(isBaselineUnknown(file(A))).toBe(true);
        }
      });
    }
  }

  it('M1: keel\'s narrator on a guest\'s new Narrative is no difference; for the owner it is', async () => {
    const N = '00000000-0000-4000-8000-0000000f0006';
    for (const [role, same] of [['guest', true], ['owner', false]] as const) {
      client = new FakeOwApiClient();
      client.setClock(tick);
      client.keyRole = role;
      await client.createElement('narrative', { id: N, name: 'Note', narrator: F });
      root.put(`elements/narrative/note--${N.slice(-8)}.json`, j({ id: N, type: 'narrative', name: 'Note', local_updated_at: stamp() }));
      await store.rescanDisk();
      await store.updateSyncState(() => ({ conflicts: [] }));
      await engineFor('local-wins').pushOnce();
      expect((await rows()).length === 0).toBe(same);
      root.put(`elements/narrative/note--${N.slice(-8)}.json`, j({ id: N, type: 'narrative', name: 'Note', local_updated_at: stamp() }));
      await store.rescanDisk();
    }
  });
});

describe('I7: the row resolves, from every state', () => {
  async function heldRow(policy: Policy = 'pause-and-review'): Promise<SyncEngine> {
    const engine = await online(policy);
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'mine' });
    await engine.pushOnce();
    expect((await rows()).map(c => c.element_id)).toEqual([A]);
    return engine;
  }

  it('Keep this copy sends an UPDATE (never a POST) with keel\'s If-Match, and the copy then reads clean', async () => {
    const engine = await heldRow();
    const seq = (await rows())[0].change_seq;
    expect(typeof seq).toBe('number');
    client.calls = [];
    await engine.resolveConflict(A, 'overwrite-mine');
    expect(client.calls.map(c => c.method)).toEqual(['update']);
    expect(client.ifMatchSent).toEqual([{ id: A, ifMatch: seq }]);
    expect(onKeel(A).description).toBe('mine');
    expect(isBaselineUnknown(file(A))).toBe(false);
    expect(await store.listLocallyChangedSince(null)).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('Keep the OnlyWorlds copy lands keel\'s record, the mark gone', async () => {
    const engine = await heldRow();
    await engine.resolveConflict(A, 'pull-theirs');
    expect(file(A).description).toBe('member');
    expect(isBaselineUnknown(file(A))).toBe(false);
    expect(await store.listLocallyChangedSince(null)).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it('M6: it changed on OnlyWorlds while open: a 412, the row takes keel\'s copy as it is now and says so; nothing retried', async () => {
    const engine = await heldRow();
    client.__server_mutate('character', A, { description: 'member again' });
    client.calls = [];
    await expect(engine.resolveConflict(A, 'overwrite-mine')).rejects.toThrow(CHANGED_WHILE_OPEN);
    expect(client.calls.map(c => c.method)).toEqual(['update']);
    expect(onKeel(A).description).toBe('member again');
    const [row] = await rows();
    expect(row.changed_while_open).toBe(true);
    expect(row.theirs).toEqual({ description: 'member again' });
    expect(row.server_updated_at).toBe(onKeel(A).updated_at);
    // The person chooses again, now against the copy shown.
    await engine.resolveConflict(A, 'overwrite-mine');
    expect(onKeel(A).description).toBe('mine');
    expect(await rows()).toEqual([]);
  });

  it('M3 (G5 inverted): keel deleted it: Keep the OnlyWorlds copy goes to the delete review, never a throw', async () => {
    const engine = await heldRow();
    client.__server_evict('character', A);
    await engine.resolveConflict(A, 'pull-theirs');
    const st = await store.readSyncState();
    expect(st.conflicts).toEqual([]);
    expect((st.server_deletes ?? []).map(d => d.id)).toEqual([A]);
  });

  it('M3: keel deleted it: Keep this copy goes to the delete review', async () => {
    const engine = await heldRow();
    client.__server_evict('character', A);
    await engine.resolveConflict(A, 'overwrite-mine');
    const st = await store.readSyncState();
    expect(st.conflicts).toEqual([]);
    expect((st.server_deletes ?? []).map(d => d.id)).toEqual([A]);
  });

  it('M3: out of a guest\'s view: Keep this copy keeps it here', async () => {
    const engine = await heldRow();
    client.keyRole = 'guest';
    client.outOfView.add(A);
    await engine.resolveConflict(A, 'overwrite-mine');
    const st = await store.readSyncState();
    expect(st.conflicts).toEqual([]);
    expect(st.kept_outside_view).toEqual([A]);
  });

  it('M3: a reviewed world: Keep this copy is a proposal, recorded, the row gone', async () => {
    const engine = await heldRow();
    client.__propose_writes(true);
    await engine.resolveConflict(A, 'overwrite-mine');
    const st = await store.readSyncState();
    expect(st.conflicts).toEqual([]);
    expect((st.proposed ?? []).map(p => p.element_id)).toEqual([A]);
    expect(onKeel(A).description).toBe('member');
  });

  it('M3: not_author: Keep this copy is refused by keel, and Keep the OnlyWorlds copy ends the row', async () => {
    const engine = await heldRow();
    client.__as_member_seat('contributor');
    await expect(engine.resolveConflict(A, 'overwrite-mine')).rejects.toThrow();
    await engine.resolveConflict(A, 'pull-theirs');
    expect(await rows()).toEqual([]);
    expect(file(A).description).toBe('member');
  });

  it('M3: a row written before the mark (no stamp on the copy): the row\'s stamp lands first, keel is read, then an UPDATE with that read\'s If-Match, never a POST', async () => {
    const engine = await online('pause-and-review');
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'mine' });
    const keelStamp = onKeel(A).updated_at as string;
    await store.updateSyncState(() => ({ conflicts: [{ element_id: A, type: 'character', detected_at: stamp(), local_updated_at: file(A).local_updated_at as string, server_updated_at: keelStamp, fields: ['description'] }] }));
    client.calls = [];
    client.ifMatchSent = [];
    await engine.resolveConflict(A, 'overwrite-mine');
    expect(client.calls.map(c => c.method)).toEqual(['get', 'update']);
    expect(client.ifMatchSent.map(m => m.id)).toEqual([A]);
    expect(onKeel(A).description).toBe('mine');
    expect(await rows()).toEqual([]);
  });

  it('gate S1 (Q2): a row written by 1.124.29 with no counter, and a member\'s edit after it: Keep this copy reads keel, takes its copy into the row, writes nothing', async () => {
    const engine = await online('pause-and-review');
    await engine.pullNow();
    client.__server_mutate('character', A, { description: 'v3 member' });
    await restore(A, { name: 'Ada', description: 'v1' });
    await engine.pullNow();
    // As a 1.124.29 pull wrote it: no flag, no counter, the copy unstamped.
    await store.updateSyncState(s => ({ conflicts: s.conflicts.map(c => ({ element_id: c.element_id, type: c.type, detected_at: c.detected_at, local_updated_at: c.local_updated_at, server_updated_at: c.server_updated_at, fields: c.fields })) }));
    const f = file(A); delete f.server_updated_at; delete f.atlas_baseline_unknown;
    root.put(pathOf(A), j(f)); await store.rescanDisk();
    client.__server_mutate('character', A, { description: 'v4 member, after the row' });
    client.calls = [];
    await expect(engine.resolveConflict(A, 'overwrite-mine')).rejects.toThrow(CHANGED_WHILE_OPEN);
    expect(client.calls.map(c => c.method)).toEqual(['get']);
    expect(onKeel(A).description).toBe('v4 member, after the row');
    const [row] = await rows();
    expect([row.no_baseline, row.changed_while_open, row.theirs]).toEqual([true, true, { description: 'v4 member, after the row' }]);
    await engine.resolveConflict(A, 'overwrite-mine');
    expect(onKeel(A).description).toBe('v1');
  });

  it('S6: a view-only world: Keep this copy is refused with the words, Keep the OnlyWorlds copy works', async () => {
    await online('local-wins');
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'mine' });
    const viewOnly = engineFor('pause-and-review', { readOnly: true });
    await viewOnly.pullNow();
    expect((await rows()).map(c => [c.element_id, c.no_baseline])).toEqual([[A, true]]);
    client.calls = [];
    await expect(viewOnly.resolveConflict(A, 'overwrite-mine')).rejects.toThrow(VIEW_ONLY_KEEP_THIS);
    expect(client.calls.filter(c => c.method !== 'get')).toEqual([]);
    await viewOnly.resolveConflict(A, 'pull-theirs');
    expect(file(A).description).toBe('member');
  });

  it('gate M1 (Q1): a field this copy holds as "" is sent, and Keep this copy empties it on OnlyWorlds', async () => {
    const engine = await online('pause-and-review');
    client.__server_mutate('character', A, { description: 'member', background: 'member bg' });
    await restore(A, { name: 'Ada', description: 'mine', background: '' });
    await engine.pushOnce();
    expect((await rows())[0].fields.sort()).toEqual(['background', 'description']);
    await engine.resolveConflict(A, 'overwrite-mine');
    expect(onKeel(A).background).toBe('');
  });

  it('S3: Keep this copy sends no empties: a field this copy lacks stays on OnlyWorlds', async () => {
    const engine = await online('pause-and-review');
    client.__server_mutate('character', A, { description: 'member', background: 'member wrote this' });
    await restore(A, { name: 'Ada', description: 'mine' });
    await engine.pushOnce();
    client.calls = [];
    await engine.resolveConflict(A, 'overwrite-mine');
    const sent = client.calls.find(c => c.method === 'update') as { body: Record<string, unknown> };
    expect('background' in sent.body).toBe(false);
    expect(onKeel(A).background).toBe('member wrote this');
  });
});

describe('the hidden rules stay ahead of conv. 192 (conv. 170)', () => {
  it('the pull leaves a hidden copy whose id keel shows to its plain conflict: no stamp, no mark', async () => {
    await client.createElement('character', { id: A, name: 'Ada', description: 'A sailor.' });
    await put(A, { name: 'Ada', description: 'The traitor.', hidden: true, local_updated_at: stamp() });
    const r = await engineFor('pause-and-review').pullNow();
    expect(r.conflicts.map(c => [c.element_id, c.no_baseline])).toEqual([[A, undefined]]);
    expect(file(A).server_updated_at).toBeUndefined();
    expect(isBaselineUnknown(file(A))).toBe(false);
  });
});

describe('S1, S7: what is never a row, and never another world', () => {
  it('S1: keel\'s stub of the id is kept as last known, never a row, nothing sent', async () => {
    await client.createElement('character', { id: A, name: 'Ada' });
    client.__server_mutate('character', A, { known_of: true });
    await put(A, { name: 'Ada', description: 'whole', local_updated_at: stamp() });
    const engine = engineFor('pause-and-review');
    await engine.pushOnce();
    expect(await rows()).toEqual([]);
    expect((await store.readSyncState()).kept_outside_view).toEqual([A]);
    expect(file(A).server_updated_at).toBeUndefined();
  });

  it('S7: an id keel holds as another type: a failure in plain words, never foreign, no new ids offered (one create and /bulk)', async () => {
    await client.createElement('location', { id: A, name: 'Ada Bay' });
    await put(A, { name: 'Ada', local_updated_at: stamp() });
    const r = await engineFor('local-wins').pushOnce();
    const f = r.failures.find(x => x.element_id === A)!;
    expect(f.message).toBe('OnlyWorlds already holds this id as a location in this world');
    expect(classifyFailure(f)).not.toBe('foreign_id');
    expect((await store.readSyncState()).foreign ?? []).toEqual([]);
    client.__enable_bulk();
    await put(B, { name: 'Bo', local_updated_at: stamp() });
    const r2 = await engineFor('local-wins').pushOnce();
    const f2 = r2.failures.find(x => x.element_id === A)!;
    expect(f2.message).toBe('OnlyWorlds already holds this id as a location in this world');
    expect((await store.readSyncState()).foreign ?? []).toEqual([]);
    expect(onKeel(A, 'location').name).toBe('Ada Bay');
  });
});

describe('M4: finding 3 is banked (the gate\'s G1, recorded)', () => {
  it('an Atlas-made sparse file, a member\'s field, a local-wins push of another edit: the field stays on keel and no empty is ever sent', async () => {
    const engine = engineFor('local-wins');
    await store.createElement('character', { id: A, name: 'Ada', description: 'v1' } as Partial<Element>);
    await engine.syncNow();
    client.__server_mutate('character', A, { background: 'member wrote this' });
    await store.updateElement(A, { description: 'mine' });
    await engine.syncNow();
    const local = await store.getElement(A) as Record<string, unknown>;
    // The banked case: the copy lacks the field, keel holds it, keel unmoved since the baseline.
    expect('background' in local).toBe(false);
    expect(onKeel(A).background).toBe('member wrote this');
    await store.updateElement(A, { description: 'mine again' });
    client.calls = [];
    await engine.syncNow();
    const sent = client.calls.find(c => c.method === 'update') as { body: Record<string, unknown> };
    expect(Object.keys(sent.body)).not.toContain('background');
    expect(onKeel(A).background).toBe('member wrote this');
  });
});

describe('gate S2: a delete made here still goes, and the row goes with it (Q4, Q4b)', () => {
  for (const policy of POLICIES) {
    it(`[${policy}] deleting a held copy sends the DELETE, and its row is gone after the round`, async () => {
      const engine = await online(policy);
      client.__server_mutate('character', A, { description: 'member' });
      await restore(A, { name: 'Ada', description: 'mine' });
      await engine.pushOnce();
      expect((await rows()).map(c => c.element_id)).toEqual([A]);
      await store.deleteElement(A);
      client.calls = [];
      await engine.syncNow();
      expect(client.calls.filter(c => c.method === 'delete').map(c => (c as { id: string }).id)).toEqual([A]);
      expect(client.__server_get('character', A)).toBeUndefined();
      expect(await rows()).toEqual([]);
      await engine.syncNow();
      expect(await rows()).toEqual([]);
    });
  }
});

describe('gate S3: each reading of the mark held by a test', () => {
  /** A held copy whose edit time is before keel's stamp: only the mark says it is changed. */
  async function heldOld(policy: Policy = 'pause-and-review'): Promise<SyncEngine> {
    const engine = await online(policy);
    // The feed walked past keel's first version: a copy equal to an older version is that version
    // (adopted on its op, then pulled forward), which is not what these cases are about.
    await engine.pullNow();
    const oldLocal = file(A).local_updated_at as string;
    client.__server_mutate('character', A, { description: 'member' });
    await put(A, { name: 'Ada', description: 'v1', local_updated_at: oldLocal });
    await engine.pushOnce();
    expect(isBaselineUnknown(file(A))).toBe(true);
    expect(Date.parse(file(A).local_updated_at as string) < Date.parse(file(A).server_updated_at as string)).toBe(true);
    return engine;
  }

  it('C7: an id written in capitals meets the /bulk check as keel\'s own id, never a /bulk item', async () => {
    client.__enable_bulk();
    await client.createElement('character', { id: A, name: 'Ada', description: 'member' });
    const UP = A.toUpperCase();
    root.put(`${DIR}/ada--upper.json`, j({ id: UP, type: 'character', name: 'Ada', description: 'mine', local_updated_at: stamp() }));
    await put(B, { name: 'Bo', local_updated_at: stamp() });
    await put(C, { name: 'Cy', local_updated_at: stamp() });
    const sent: string[] = [];
    const real = client.bulkCreate!;
    client.bulkCreate = async (items: BulkItem[], opts) => {
      sent.push(...items.map(it => String(it.element.id).toLowerCase()));
      return real(items, opts);
    };
    await engineFor('local-wins').pushOnce();
    expect(sent.sort()).toEqual([B, C]);
    expect(onKeel(A).description).toBe('member');
    expect((await rows()).map(c => c.element_id)).toEqual([UP]);
  });

  it('C3: the hide sweep leaves a held copy alone: no hide sent for it, nothing pulled over it', async () => {
    const engine = await heldOld();
    root.put(pathOf(A), j({ ...file(A), hidden: true, atlas_hidden_shown_online: true }));
    await store.rescanDisk();
    client.calls = [];
    await engine.pushOnce();
    expect(client.calls.filter(c => c.method === 'hide')).toEqual([]);
    expect(file(A).description).toBe('v1');
  });

  it('C4: keel hides the element from this key: a held copy stays in the copy', async () => {
    const engine = await heldOld();
    client.__server_hide('character', A);
    await engine.pullNow();
    expect(root.get(pathOf(A))).toBeTruthy();
    expect(file(A).description).toBe('v1');
  });

  it('C5: a view reset whose walk no longer names a held copy keeps it, never drops it', async () => {
    const engine = await heldOld();
    await engine.pullNow();
    const inner = client.pullChanges!;
    let refused = false;
    client.pullChanges = async (since, limit) => {
      if (since && !refused) {
        refused = true;
        throw Object.assign(new Error('API Error 409: resync'), { status: 409, code: 'resync_required', param: null, reason: 'view' });
      }
      const page = await inner(since, limit);
      return { ...page, changes: page.changes.filter(op => op.id !== A) };
    };
    await engine.pullNow();
    expect(root.get(pathOf(A))).toBeTruthy();
    expect(file(A).description).toBe('v1');
    expect((await store.readSyncState()).kept_outside_view ?? []).toContain(A);
  });

  it('C9: clearing a held copy\'s baseline takes the mark with it', async () => {
    await heldOld();
    await store.clearServerBaseline(A);
    expect(file(A).server_updated_at).toBeUndefined();
    expect('atlas_baseline_unknown' in file(A)).toBe(false);
  });

  it('C13: keel\'s live copy on a 412 now holds what this copy holds: adopted, the row goes, nothing more written', async () => {
    const engine = await online('pause-and-review');
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'mine' });
    await engine.pushOnce();
    client.__server_mutate('character', A, { description: 'mine' });
    client.calls = [];
    await engine.resolveConflict(A, 'overwrite-mine');
    expect(client.calls.map(c => c.method)).toEqual(['update']);
    expect(await rows()).toEqual([]);
    expect(isBaselineUnknown(file(A))).toBe(false);
    expect(file(A).server_updated_at).toBe(onKeel(A).updated_at);
  });

  it('C19: the list pull that finds keel now holds the same content drops the row', async () => {
    const engine = await online('pause-and-review');
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'mine' });
    await engine.pushOnce();
    expect((await rows()).length).toBe(1);
    client.__server_mutate('character', A, { description: 'mine' });
    client.__enable_changes(false);
    await engine.pullNow();
    expect(await rows()).toEqual([]);
    expect(isBaselineUnknown(file(A))).toBe(false);
  });
});

describe('gate 2: a DELETE answered 404, and a number held as ""', () => {
  for (const policy of POLICIES) {
    it(`[${policy}] S1: keel answers the DELETE with 404 (gone already): it counts as landed, and the row goes`, async () => {
      const engine = await online(policy);
      client.__server_mutate('character', A, { description: 'member' });
      await restore(A, { name: 'Ada', description: 'mine' });
      await engine.pushOnce();
      expect((await rows()).map(c => c.element_id)).toEqual([A]);
      await store.deleteElement(A);
      client.deleteElement = async () => { throw Object.assign(new Error('API Error 404: not found'), { status: 404, code: 'not_found', param: null }); };
      await engine.syncNow();
      expect(await rows()).toEqual([]);
      expect(await store.listTombstonesSince(null)).toEqual([]);
    });
  }

  it('N1: a number this copy holds as "" goes as null, which keel takes: Keep this copy empties it there', async () => {
    const engine = await online('pause-and-review', { name: 'Ada', description: 'v1', height: 5 });
    client.__server_mutate('character', A, { description: 'member' });
    await restore(A, { name: 'Ada', description: 'mine', height: '' });
    await engine.pushOnce();
    expect((await rows())[0].fields.sort()).toEqual(['description', 'height']);
    client.calls = [];
    await engine.resolveConflict(A, 'overwrite-mine');
    const sent = client.calls.find(c => c.method === 'update') as { body: Record<string, unknown> };
    expect(sent.body.height).toBeNull();
    expect(onKeel(A).height).toBeNull();
  });
});
