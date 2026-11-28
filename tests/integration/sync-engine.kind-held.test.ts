/**
 * Conv. 200: an integer field holding what keel would store cut (2.5) or refuse (a word) never goes to
 * OnlyWorlds unsaid. keel answers a fraction in an integer field with a 200 and stores it cut, so the
 * file and the online world would part without a word. Where Atlas sends (the push, single and through
 * `/bulk`, and Keep this copy), such an element is held here as a sync issue naming the field and the
 * value; a new element that links one held waits for it; a whole number written as text is sent.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { KIND_WAITS_MESSAGE, KindFaultError } from '../../src/sync/kind-fault';
import { classifyFailure, describeFailures } from '../../src/sync/sync-failure-copy';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

const WREN = '00000000-0000-4000-8000-0000000000c1';
const ADA = '00000000-0000-4000-8000-0000000000c2';
const DOCK = '00000000-0000-4000-8000-0000000000c3';

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
});

const createdIds = () => client.calls.flatMap(c => c.method === 'create' ? [(c.body as { id?: string }).id] : []);
const updatedIds = () => client.calls.flatMap(c => c.method === 'update' ? [c.id] : []);
const onServer = async (id: string) => (await client.listElements('character')).find(e => e.id === id) as Record<string, unknown> | undefined;

for (const bulk of [false, true]) {
  describe(bulk ? 'through /bulk' : 'one create at a time', () => {
    beforeEach(() => { if (bulk) client.__enable_bulk(true); });

    it('a create holding 2.5 is not sent, named by field and value; one linking it waits; the rest goes', async () => {
      await folder.createElement('character', { id: WREN, name: 'Wren', birth_date: 2.5 } as never);
      await folder.createElement('character', { id: ADA, name: 'Ada', friends: [WREN] } as never);
      await folder.createElement('location', { id: DOCK, name: 'The dock', founding_date: '12' } as never);
      const r = await new SyncEngine({ folder, client }).syncNow();
      expect(createdIds()).not.toContain(WREN);
      expect(createdIds()).not.toContain(ADA);
      expect(await onServer(WREN)).toBeUndefined();
      // A whole number written as text goes: keel stores the same number.
      expect((await client.listElements('location')).map(e => e.id)).toEqual([DOCK]);
      const wren = r.failures.find(f => f.element_id === WREN)!;
      expect(wren.kind_fault).toEqual({ field: 'birth_date', value: '2.5' });
      expect(classifyFailure(wren)).toBe('wrong_kind');
      const ada = r.failures.find(f => f.element_id === ADA)!;
      expect(ada.message).toBe(KIND_WAITS_MESSAGE);
      expect(classifyFailure(ada)).toBe('wrong_kind');
      expect(r.failures).toHaveLength(2);
      expect((await folder.getElement(WREN))!.server_updated_at).toBeFalsy();
      expect(describeFailures(r.failures)).toBe('1 element was not sent: a field that takes only a whole number holds something else (birth date 2.5), which OnlyWorlds would not keep as written. Change it to a whole number, such as 12, to let it sync. It stays on your disk. 1 element links to a new element that was not sent, and syncs when that one does.');

      // Made whole, both go on the next round, the link with them.
      await folder.updateElement(WREN, { birth_date: 2 } as never);
      const r2 = await new SyncEngine({ folder, client }).syncNow();
      expect(r2.failures).toEqual([]);
      expect((await onServer(WREN))?.birth_date).toBe(2);
      expect((await onServer(ADA))?.friends).toEqual([WREN]);
    });

    it('a value written between the round\'s list and the send is read as sent, and held', async () => {
      await folder.createElement('character', { id: WREN, name: 'Wren' } as never);
      await folder.createElement('character', { id: ADA, name: 'Ada' } as never);
      await folder.createElement('location', { id: DOCK, name: 'The dock' } as never);
      // An outside writer lands 2.5 after the round listed its changes: the send reads the file again.
      const read = folder.getElement.bind(folder);
      folder.getElement = (async (id: string) => {
        const el = await read(id);
        return el && id === WREN ? { ...el, birth_date: 2.5 } : el;
      }) as typeof folder.getElement;
      const r = await new SyncEngine({ folder, client }).syncNow();
      expect(await onServer(WREN)).toBeUndefined();
      expect(r.failures).toEqual([expect.objectContaining({ element_id: WREN, kind_fault: { field: 'birth_date', value: '2.5' } })]);
      expect((await client.listElements('location')).map(e => e.id)).toEqual([DOCK]);
    });
  });
}

describe('a value written after the round\'s list that reads like keel\'s answer', () => {
  it('is the element\'s fault, never a dead key, a delete online or another world\'s id', async () => {
    await folder.createElement('character', { id: ADA, name: 'Ada' } as never);
    const engine = new SyncEngine({ folder, client, policy: 'local-wins' });
    expect((await engine.syncNow()).failures).toEqual([]);
    await folder.updateElement(ADA, { description: 'Edited.' } as never);
    await folder.createElement('character', { id: WREN, name: 'Wren' } as never);
    await folder.createElement('character', { id: DOCK, name: 'Dock' } as never);
    const late: Record<string, unknown> = { [ADA]: '404 not found', [WREN]: 401.5, [DOCK]: 'id_conflict' };
    const read = folder.getElement.bind(folder);
    folder.getElement = (async (id: string) => {
      const el = await read(id);
      return el && id in late ? { ...el, height: late[id] } : el;
    }) as typeof folder.getElement;
    client.calls.length = 0;
    const r = await engine.syncNow();
    expect(r.auth_blocked).toBeFalsy();
    expect(r.failures.map(f => [f.element_id, classifyFailure(f)]).sort()).toEqual([[ADA, 'wrong_kind'], [DOCK, 'wrong_kind'], [WREN, 'wrong_kind']].sort());
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toEqual([]);
    expect(state.foreign ?? []).toEqual([]);
    expect(state.conflicts ?? []).toEqual([]);
    expect(client.calls.filter(c => c.method !== 'list' && c.method !== 'getWorldMeta')).toEqual([]);
  });
});

describe('an update linking a new element held for its kind', () => {
  it('waits, told as waiting on that one, never as refused by OnlyWorlds', async () => {
    await folder.createElement('character', { id: ADA, name: 'Ada' } as never);
    const engine = new SyncEngine({ folder, client });
    expect((await engine.syncNow()).failures).toEqual([]);
    await folder.createElement('character', { id: WREN, name: 'Wren', birth_date: 2.5 } as never);
    await folder.updateElement(ADA, { friends: [WREN] } as never);
    client.calls.length = 0;
    const r = await engine.syncNow();
    expect(updatedIds()).toEqual([]);
    const ada = r.failures.find(f => f.element_id === ADA)!;
    expect(ada).toEqual(expect.objectContaining({ operation: 'update', message: KIND_WAITS_MESSAGE }));
    expect(classifyFailure(ada)).toBe('wrong_kind');
  });
});

describe('an update', () => {
  it('a word in an integer field holds the edit here, with its other edits; whole again, it goes', async () => {
    await folder.createElement('character', { id: WREN, name: 'Wren', height: 170 } as never);
    const engine = new SyncEngine({ folder, client });
    expect((await engine.syncNow()).failures).toEqual([]);
    await folder.updateElement(WREN, { height: 'tall', description: 'Taller now.' } as never);
    client.calls.length = 0;
    const r = await engine.syncNow();
    expect(updatedIds()).toEqual([]);
    expect(r.failures).toEqual([expect.objectContaining({ element_id: WREN, operation: 'update', kind_fault: { field: 'height', value: '"tall"' } })]);
    expect((await onServer(WREN))?.height).toBe(170);
    await folder.updateElement(WREN, { height: 180 } as never);
    expect((await engine.syncNow()).failures).toEqual([]);
    expect(await onServer(WREN)).toEqual(expect.objectContaining({ height: 180, description: 'Taller now.' }));
  });

  it('Keep this copy refuses to send a fraction, with the field and value, and sends nothing', async () => {
    await folder.createElement('character', { id: WREN, name: 'Wren', height: 170 } as never);
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    await engine.syncNow();
    client.__server_mutate('character', WREN, { name: 'Wren (online)' });
    await folder.updateElement(WREN, { description: 'Mine.' } as never);
    await engine.syncNow();
    expect((await folder.readSyncState()).conflicts.map(c => c.element_id)).toEqual([WREN]);
    await folder.updateElement(WREN, { height: 170.5 } as never);
    client.calls.length = 0;
    const err = await engine.resolveConflict(WREN, 'overwrite-mine').then(() => null, e => e);
    expect(err).toBeInstanceOf(KindFaultError);
    expect((err as Error).message).toBe('Its height field holds 170.5, and OnlyWorlds takes only a whole number there, such as 12, so nothing was sent. Change it to a whole number, then try again.');
    expect(updatedIds()).toEqual([]);
    expect((await folder.readSyncState()).conflicts.map(c => c.element_id)).toEqual([WREN]);
  });
});
