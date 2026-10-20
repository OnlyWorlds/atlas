/**
 * keel's "known of" stubs (PR 113, B16; the folder spec §4.4; conv. 155;
 * contract Forge/Notes/2026-10-20-s443-known-of-stubs.md, I1 to I6). keel
 * probed live S443 (`Notes/ui-snapshots/2026-10-20-s443/probe-stub.log`): a
 * stub is an upsert with `known_of: true` and every other field served unset
 * ("", null, []); it keeps the element's own `updated_at`; a stub arriving or
 * leaving answers the old cursor 409 `resync_required`, reason `view`; a
 * write body carrying `known_of` is 422.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { toV2WireShape } from '../../src/sync/ow-v2-client-adapter';
import { PlainError } from '../../src/core/plain-error';
import type { FolderStore } from '../../src/store/folder-store';
import type { Element } from '../../src/core/types';

const KID = '00000000-0000-4000-8000-0000000000b1';
const ANA = '00000000-0000-4000-8000-0000000000b2';
const STAMP = '2026-01-01T00:00:05.000Z';

/** keel's stub of a whole record, as served live: the kept keys, every other field unset. */
function asStub(whole: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(whole)) {
    if (['id', 'type', 'name', 'description', 'supertype', 'subtype', 'image_url', 'created_at', 'updated_at'].includes(k)) out[k] = v;
    else out[k] = Array.isArray(v) ? [] : typeof v === 'string' ? '' : null;
  }
  out.known_of = true;
  return out;
}

const anaWhole = { id: ANA, type: 'character', name: 'Ana', description: 'Sells mules.', reputation: 'Honest', friends: [KID], updated_at: STAMP };

// ---- the stores (I1, I2, I5) ----

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const tick = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();

async function realStore(): Promise<FolderStore> {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  const s = new FsFolderStore({ clock: tick, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await s.open(root as unknown as FileSystemDirectoryHandle);
  return s;
}
async function mockStore(): Promise<FolderStore> {
  const s = new MockFolderStore();
  await s.open(null);
  return s;
}

describe.each([['the real store', realStore], ['the mock store', mockStore]] as const)('%s', (_name, make) => {
  it('writes a stub as a stub: known_of and the kept keys, the unset fields left out (I1)', async () => {
    const s = await make();
    await s.applyServerRecord('character', asStub(anaWhole), STAMP);
    const got = (await s.getElement(ANA)) as unknown as Record<string, unknown>;
    expect(got.known_of).toBe(true);
    expect([got.name, got.description]).toEqual(['Ana', 'Sells mules.']);
    for (const unset of ['reputation', 'friends', 'height', 'created_by']) expect(unset in got).toBe(false);
  });

  it('a stub over a whole copy keeps none of the copy\'s wire fields, only the person\'s own (I1)', async () => {
    const s = await make();
    const ZONE = '00000000-0000-4000-8000-0000000000c1';
    await s.applyServerRecord('zone', { id: ZONE, type: 'zone', name: 'The Pale', atlas_color: '#aa3322', updated_at: STAMP }, STAMP);
    await s.applyServerRecord('zone', { id: ZONE, type: 'zone', name: 'The Pale', description: '', updated_at: STAMP, known_of: true }, STAMP);
    const got = (await s.getElement(ZONE)) as unknown as Record<string, unknown>;
    expect([got.known_of, 'atlas_color' in got]).toEqual([true, false]);
  });

  it('a stub arriving whole is written whole, and known_of goes (I2)', async () => {
    const s = await make();
    await s.applyServerRecord('character', asStub(anaWhole), STAMP);
    await s.applyServerRecord('character', anaWhole, STAMP);
    const got = (await s.getElement(ANA)) as unknown as Record<string, unknown>;
    expect('known_of' in got).toBe(false);
    expect([got.reputation, got.friends]).toEqual(['Honest', [KID]]);
  });

  it('a stub is never changed or deleted here; the engine\'s silent delete still runs (I5)', async () => {
    const s = await make();
    await s.applyServerRecord('character', asStub(anaWhole), STAMP);
    await expect(s.updateElement(ANA, { name: 'Ana the Bold' } as Partial<Element>)).rejects.toBeInstanceOf(PlainError);
    await expect(s.deleteElement(ANA)).rejects.toBeInstanceOf(PlainError);
    expect((await s.getElement(ANA))?.name).toBe('Ana');
    await s.deleteElement(ANA, { silent: true });
    expect(await s.getElement(ANA)).toBeNull();
  });
});

// ---- the wire (I4) ----

describe('the adapter', () => {
  it('refuses a body carrying known_of before sending, never strips it (I4)', () => {
    expect(() => toV2WireShape({ id: ANA, name: 'Ana', known_of: true }, 'character', 'update')).toThrow(PlainError);
    expect(toV2WireShape({ id: ANA, name: 'Ana' }, 'character', 'update')).toEqual({ name: 'Ana' });
  });
});

// ---- the engine (I2, I3, I4) ----

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;
let stubbed: Set<string>;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
  stubbed = new Set();
  // keel serves these ids as stubs, with the element's own stamp.
  const real = client.pullChanges!.bind(client);
  client.pullChanges = async (since, limit) => {
    const page = await real(since, limit);
    return { ...page, changes: page.changes.map(op => op.op === 'upsert' && stubbed.has(op.id) ? { ...op, element: asStub(op.element as Record<string, unknown>) as typeof op.element } : op) };
  };
});

/** keel moves this key's view: the old cursor gets one 409 with this reason, then the walk from 0. */
function reset(reason: 'view' | 'role'): void {
  const inner = client.pullChanges!;
  let refused = false;
  client.pullChanges = async (since, limit) => {
    if (since && !refused) {
      refused = true;
      throw Object.assign(new Error('API Error 409: resync'), { status: 409, code: 'resync_required', param: null, reason });
    }
    return inner(since, limit);
  };
}

async function world(engine: SyncEngine): Promise<void> {
  await client.createElement('character', { id: KID, name: 'The Kid', friends: [ANA] });
  await client.createElement('character', { id: ANA, name: 'Ana', description: 'Sells mules.', reputation: 'Honest' });
  await engine.pullNow();
}
const local = async (id: string) => (await folder.getElement(id)) as unknown as Record<string, unknown>;

describe('the engine', () => {
  it('a first walk stores keel\'s stub as a stub (I1)', async () => {
    stubbed.add(ANA);
    await world(new SyncEngine({ folder, client }));
    const ana = await local(ANA);
    expect([ana.known_of, 'reputation' in ana]).toEqual([true, false]);
  });

  it('a stub arriving whole lands though its stamp did not move (I2)', async () => {
    stubbed.add(ANA);
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    stubbed.delete(ANA);
    reset('view');
    await engine.pullNow();
    const ana = await local(ANA);
    expect(['known_of' in ana, ana.reputation]).toEqual([false, 'Honest']);
  });

  it('a whole copy meeting a stub on the walk a view reset starts takes the stub (I3)', async () => {
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    stubbed.add(ANA);
    reset('view');
    await engine.pullNow();
    const ana = await local(ANA);
    expect([ana.known_of, 'reputation' in ana]).toEqual([true, false]);
  });

  it('a whole copy is kept as last known on a role reset (I3, B12)', async () => {
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    stubbed.add(ANA);
    reset('role');
    await engine.pullNow();
    const ana = await local(ANA);
    expect(['known_of' in ana, ana.reputation]).toEqual([false, 'Honest']);
  });

  it('a whole copy holding an edit never sent is kept on a view reset (I3)', async () => {
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    engine.stop();
    await folder.updateElement(ANA, { description: 'Sells mules, cheaply.' } as Partial<Element>);
    const paused = new SyncEngine({ folder, client });
    stubbed.add(ANA);
    reset('view');
    await paused.pullNow();
    const ana = await local(ANA);
    expect(['known_of' in ana, ana.description]).toEqual([false, 'Sells mules, cheaply.']);
  });

  it('a stub is never pushed, though it reads as changed (I4)', async () => {
    stubbed.add(ANA);
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    // A Keep from the delete review clears the baseline: the stub now reads as a create.
    const stub = await local(ANA);
    delete stub.server_updated_at;
    await folder.deleteElement(ANA, { silent: true });
    await folder.createElementVerbatim('character', { ...stub, local_updated_at: clock.next() } as unknown as Element);
    // The store never lists it as waiting (gate G9), so nothing counts it and the push never meets it.
    expect(await folder.listLocallyChangedSince(null)).toEqual([]);
    client.calls = [];
    await engine.syncNow();
    expect(client.calls.filter(c => c.method === 'create' || c.method === 'update' || c.method === 'bulk')).toEqual([]);
  });

  it('a copy a role reset kept whole stays whole through a later view reset (gate G1, B12)', async () => {
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    stubbed.add(ANA);
    reset('role');
    await engine.pullNow();
    // An unrelated move of the view: keel bumps with reason view.
    await client.createElement('character', { id: '00000000-0000-4000-8000-0000000000b3', name: 'Bob' });
    reset('view');
    await engine.pullNow();
    const ana = await local(ANA);
    expect(['known_of' in ana, ana.reputation]).toEqual([false, 'Honest']);
    expect((await folder.readSyncState()).kept_whole).toEqual([ANA]);
    // Named whole again, it leaves the set.
    stubbed.delete(ANA);
    reset('view');
    await engine.pullNow();
    expect((await folder.readSyncState()).kept_whole).toEqual([]);
  });

  it('a stub with no baseline meeting its stub again is no conflict (gate G2)', async () => {
    stubbed.add(ANA);
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    const stub = await local(ANA);
    delete stub.server_updated_at;
    await folder.deleteElement(ANA, { silent: true });
    await folder.createElementVerbatim('character', { ...stub, local_updated_at: clock.next() } as unknown as Element);
    await client.updateElement('character', ANA, { name: 'Ana Reyes' });
    await engine.pullNow();
    expect((await folder.readSyncState()).conflicts).toEqual([]);
    expect((await local(ANA)).name).toBe('Ana Reyes');
  });

  it('keeping mine on a stub\'s conflict takes theirs, never sends it (gate G3)', async () => {
    stubbed.add(ANA);
    const engine = new SyncEngine({ folder, client });
    await world(engine);
    await folder.updateSyncState(() => ({ conflicts: [{ element_id: ANA, type: 'character', detected_at: STAMP, local_updated_at: STAMP, server_updated_at: STAMP, fields: ['name'] }] }));
    client.calls = [];
    await engine.resolveConflict(ANA, 'overwrite-mine');
    expect(client.calls.filter(c => c.method === 'create' || c.method === 'update')).toEqual([]);
    expect((await folder.readSyncState()).conflicts).toEqual([]);
  });
});

describe.each([['the real store', realStore], ['the mock store', mockStore]] as const)('%s, after the gate', (_name, make) => {
  it('updateElementWith leaves a stub as it is, and throws nothing (gate G4)', async () => {
    const s = await make();
    await s.applyServerRecord('character', asStub(anaWhole), STAMP);
    const back = await s.updateElementWith(ANA, () => ({ description: 'x' } as Partial<Element>));
    expect(back?.description).toBe('Sells mules.');
    expect(await s.listLocallyChangedSince(null)).toEqual([]);
  });

  it('a stub never reads as waiting to be sent, though its baseline is gone (gate G9)', async () => {
    const s = await make();
    await s.applyServerRecord('character', asStub(anaWhole), STAMP);
    await s.applyServerRecord('character', { id: KID, type: 'character', name: 'The Kid', updated_at: STAMP }, STAMP);
    await s.resetSyncBaseline();
    expect((await s.listLocallyChangedSince(null)).map(e => e.id)).toEqual([KID]);
  });

  it('a story replaced by its stub keeps no rich-text copy of it (gate G6)', async () => {
    const s = await make();
    const STORY = '00000000-0000-4000-8000-0000000000d1';
    await s.applyServerRecord('narrative', { id: STORY, type: 'narrative', name: 'The Road', story: 'The Kid rode out.', updated_at: STAMP }, STAMP);
    await s.updateElement(STORY, { atlas_richtext_json: { type: 'doc' } } as unknown as Partial<Element>);
    await s.applyServerRecord('narrative', { id: STORY, type: 'narrative', name: 'The Road', description: '', updated_at: STAMP, known_of: true }, STAMP);
    const got = (await s.getElement(STORY)) as unknown as Record<string, unknown>;
    expect([got.known_of, 'story' in got, 'atlas_richtext_json' in got]).toEqual([true, false, false]);
  });
});
