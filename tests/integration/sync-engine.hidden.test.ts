/**
 * What a hide takes from the copy (keel's hidden mark; one-rule §3: "a 409
 * with reason role: keep; reason view, or a delete row with reason hidden:
 * drop"). Contract: Forge/Notes/2026-10-20-s441-hidden-leaves-the-copy.md
 * (I1 to I7), and the S441 gate's G1 to G10. keel probed live S441
 * (`Notes/ui-snapshots/2026-10-20-s441/probe-hide.log`): a contributor gets
 * `{"op":"delete", ..., "reason":"hidden"}`; a write naming the hidden id is
 * 400 `invalid_link`, one leaving it out keeps it; a create with its id is
 * 404; an unhide answers the old cursor 409 `resync_required`, reason `view`,
 * and the walk from 0 names it again. Ids are real UUIDs, so the fake's
 * `strictUpdateLinks` can refuse a link as keel does (gate G8).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

const MINE = '00000000-0000-4000-8000-0000000000a1';
const SPOILER = '00000000-0000-4000-8000-0000000000a2';
const FERRY = '00000000-0000-4000-8000-0000000000a3';
const CROSSING = '00000000-0000-4000-8000-0000000000a4';

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
});

const ids = async () => (await folder.listElements()).map(e => e.id).sort();

async function contributorWorld(engine: SyncEngine): Promise<void> {
  client.keyRole = 'contributor';
  await client.createElement('character', { id: MINE, name: 'Cy, the contributor\'s own' });
  await client.createElement('character', { id: SPOILER, name: 'The traitor' });
  await client.createElement('location', { id: FERRY, name: 'The Ferry' });
  await client.createElement('event', { id: CROSSING, name: 'The crossing', characters: [MINE, SPOILER] });
  await engine.pullNow();
  expect(await ids()).toEqual([MINE, SPOILER, FERRY, CROSSING].sort());
}

const resync = (reason?: string) => Object.assign(new Error('API Error 409: resync'), {
  status: 409, code: 'resync_required', param: null, ...(reason ? { reason } : {}),
});

/** keel moves this key's view: the old cursor gets the 409, a walk from 0 names only what is still seen. */
function viewMoves(seen: (id: string) => boolean, reason?: string): void {
  const real = client.pullChanges!.bind(client);
  let refused = false;
  client.pullChanges = async (since, limit) => {
    if (since && !refused) { refused = true; throw resync(reason); }
    const page = await real(since, limit);
    return { ...page, changes: page.changes.filter(op => op.op === 'upsert' && seen(op.id)) };
  };
}

describe('the delete row\'s reason, read off the wire', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a hidden row carries it, as keel sent it live; a plain one carries none', async () => {
    const body = {
      cursor: '7:b', has_more: false, head: 7,
      changes: [
        { op: 'delete', type: 'character', id: SPOILER, change_seq: 6, deleted_at: '2026-10-20T07:25:39.690214+00:00', deleted_by: null, deleted_via: 'api', reason: 'hidden' },
        { op: 'delete', type: 'location', id: FERRY, change_seq: 7, deleted_at: '2026-10-20T09:41:00Z' },
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const adapter = new OwV2ClientAdapter({ apiKey: 'ow_test', apiPin: '', baseUrl: 'https://keel.test/api/v2' });
    const page = await adapter.pullChanges('5:x');
    expect(page.changes[0]).toMatchObject({ op: 'delete', id: SPOILER, reason: 'hidden' });
    expect(page.changes[1]).not.toHaveProperty('reason');
  });
});

describe('a delete row with reason hidden (I1, I2)', () => {
  it('drops an unchanged copy silently: no review, no DELETE sent, remembered as left', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.__server_hide('character', SPOILER);
    client.calls = [];
    const r = await engine.syncNow();
    expect(await ids()).toEqual([MINE, FERRY, CROSSING].sort());
    expect(r.pulled.deletes).toBe(1);
    const st = await folder.readSyncState();
    expect(st.server_deletes ?? []).toEqual([]);
    expect(st.left_view).toEqual([SPOILER]);
    expect(client.calls.filter(c => 'id' in c && c.id === SPOILER)).toEqual([]);
    expect(await folder.listTombstonesSince(null)).toEqual([]);
  });

  it('a plain delete row still goes to the review (I6)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    await client.deleteElement('location', FERRY);
    await engine.pullNow();
    expect(await ids()).toContain(FERRY);
    const st = await folder.readSyncState();
    expect((st.server_deletes ?? []).map(d => d.id)).toEqual([FERRY]);
    expect(st.left_view ?? []).toEqual([]);
  });

  it('a copy with an edit never sent is kept, said as a kept edit, never sent, never reviewed (G5)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    await folder.updateElement(SPOILER, { description: 'my note on the traitor' });
    client.__server_hide('character', SPOILER);
    const r = await engine.pullNow();
    expect(r.kept_edit_ids).toEqual([SPOILER]);
    expect((await folder.getElement(SPOILER))?.description).toBe('my note on the traitor');
    const st = await folder.readSyncState();
    expect(st.kept_outside_view).toEqual([SPOILER]);
    expect(st.server_deletes ?? []).toEqual([]);
    client.calls = [];
    await engine.pushOnce();
    expect(client.calls.filter(c => 'id' in c && c.id === SPOILER)).toEqual([]);
  });

  it('what a role change kept stays kept (conv. 151)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    await folder.updateSyncState(() => ({ kept_outside_view: [SPOILER] }));
    client.__server_hide('character', SPOILER);
    await engine.pullNow();
    expect(await ids()).toContain(SPOILER);
    expect((await folder.readSyncState()).kept_outside_view).toEqual([SPOILER]);
  });

  it('a hide and the feed naming it again in one window: back in view, not kept (G9)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    await folder.updateElement(SPOILER, { description: 'my note' });
    client.__server_hide('character', SPOILER);
    client.__server_unhide('character', SPOILER);
    await engine.pullNow();
    expect((await folder.readSyncState()).kept_outside_view ?? []).toEqual([]);
  });

  it('a hidden row for an element the same round\'s push held as a conflict is still a hide (G11)', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    await contributorWorld(engine);
    await folder.updateElement(SPOILER, { description: 'mine' });
    client.__server_mutate('character', SPOILER, { description: 'theirs' });
    // The owner hides it between this round's push (which holds the conflict) and its pull.
    const real = client.pullChanges!.bind(client);
    let hid = false;
    client.pullChanges = async (since, limit) => {
      if (!hid) { hid = true; client.__server_hide('character', SPOILER); }
      return real(since, limit);
    };
    await engine.syncNow();
    expect(hid).toBe(true);
    const st = await folder.readSyncState();
    expect(st.kept_outside_view).toEqual([SPOILER]);
    expect(st.conflicts.map(c => c.element_id)).toEqual([]);
    expect(st.server_deletes ?? []).toEqual([]);
  });
});

describe('a hidden element that reached the review before its row (G1, G10)', () => {
  it('an autosave before the pull, a Keep, then the row: kept, never sent as a create', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.strictUpdateLinks = true;
    client.__server_hide('character', SPOILER);
    await folder.updateElement(CROSSING, { description: 'the contributor wrote this' });
    await engine.pushOnce();
    expect(((await folder.readSyncState()).server_deletes ?? []).map(d => d.id)).toEqual([SPOILER]);
    await engine.resolveServerDelete(SPOILER, 'keep');
    await engine.pullNow();
    const st = await folder.readSyncState();
    expect(st.kept_outside_view).toEqual([SPOILER]);
    expect(st.server_deletes ?? []).toEqual([]);
    client.calls = [];
    const p = await engine.pushOnce();
    expect(client.calls.filter(c => JSON.stringify(c).includes(SPOILER))).toEqual([]);
    expect(p.failures).toEqual([]);
  });

  it('a Keep sent before any row: keel\'s 404 on the create keeps it, never sent again', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.__server_hide('character', SPOILER);
    await folder.updateSyncState(() => ({ server_deletes: [{ id: SPOILER, type: 'character', detected_at: '2026-01-02T00:00:00.000Z', name: 'The traitor' }] }));
    await engine.resolveServerDelete(SPOILER, 'keep');
    const p = await engine.pushOnce();
    expect(p.failures).toEqual([]);
    expect((await folder.readSyncState()).kept_outside_view).toEqual([SPOILER]);
    client.calls = [];
    await engine.pushOnce();
    expect(client.calls.filter(c => JSON.stringify(c).includes(SPOILER))).toEqual([]);
  });

  it('the same through /bulk: the 404 item is kept, the rest goes through', async () => {
    client.__enable_bulk();
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.__server_hide('character', SPOILER);
    await folder.updateSyncState(() => ({ server_deletes: [{ id: SPOILER, type: 'character', detected_at: '2026-01-02T00:00:00.000Z', name: 'The traitor' }] }));
    await engine.resolveServerDelete(SPOILER, 'keep');
    const NEW = '00000000-0000-4000-8000-0000000000a5';
    await folder.createElement('object', { id: NEW, name: 'The ledger' });
    await engine.pushOnce();
    expect((await folder.readSyncState()).kept_outside_view).toEqual([SPOILER]);
    expect((await folder.getElement(NEW))?.server_updated_at).toBeTruthy();
  });
});

describe('links to what left the view (I4)', () => {
  it('never go out in a body, and the copy keeps them', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.strictUpdateLinks = true;
    client.__server_hide('character', SPOILER);
    await engine.pullNow();
    await folder.updateElement(CROSSING, { description: 'the contributor wrote this' });
    client.calls = [];
    const p = await engine.pushOnce();
    expect(p.failures).toEqual([]);
    const sent = client.calls.find(c => c.method === 'update' && c.id === CROSSING) as { body: Record<string, unknown> } | undefined;
    expect(sent?.body.characters).toEqual([MINE]);
    expect((await folder.getElement(CROSSING))?.characters).toEqual([MINE, SPOILER]);
  });

  it('a new element naming one goes out without it', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.strictUpdateLinks = true;
    client.__server_hide('character', SPOILER);
    await engine.pullNow();
    const NEW = '00000000-0000-4000-8000-0000000000a6';
    await folder.createElement('event', { id: NEW, name: 'The betrayal', characters: [MINE, SPOILER] });
    client.calls = [];
    const p = await engine.pushOnce();
    expect(p.failures).toEqual([]);
    const sent = client.calls.find(c => (c.method === 'create' || c.method === 'bulk') && JSON.stringify(c).includes(NEW));
    expect(sent).toBeDefined();
    expect(JSON.stringify(sent)).not.toContain(SPOILER);
  });

  it('keel\'s read without the link, in a later round, does not erase it', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.__server_hide('character', SPOILER);
    await engine.pullNow();
    await client.updateElement('event', CROSSING, { name: 'The crossing', characters: [MINE], description: 'the owner wrote this' });
    await engine.pullNow();
    const ev = await folder.getElement(CROSSING);
    expect(ev?.description).toBe('the owner wrote this');
    expect(ev?.characters).toEqual([MINE, SPOILER]);
  });

  it('nor in the same round, after the hide row (G4)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.__server_hide('character', SPOILER);
    await client.updateElement('event', CROSSING, { name: 'The crossing', characters: [MINE], description: 'the owner wrote this' });
    await engine.pullNow();
    const ev = await folder.getElement(CROSSING);
    expect(ev?.description).toBe('the owner wrote this');
    expect(ev?.characters).toEqual([MINE, SPOILER]);
  });

  it('nor in the same round, before the hide row: put back from the copy as it was (G4)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    // The owner's edit lands first in the feed; keel's read of it already leaves the traitor out.
    await client.updateElement('event', CROSSING, { name: 'The crossing', characters: [MINE], description: 'the owner wrote this' });
    client.__server_hide('character', SPOILER);
    await engine.pullNow();
    const ev = await folder.getElement(CROSSING);
    expect(ev?.description).toBe('the owner wrote this');
    expect(ev?.characters).toEqual([MINE, SPOILER]);
    expect(ev?.local_updated_at).toBe(ev?.server_updated_at);
  });

  it('a replayed row whose copy already left is remembered as left (G2)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.strictUpdateLinks = true;
    client.__server_hide('character', SPOILER);
    // The round drops the copy, then its save is refused: the cursor stays and the row replays.
    const orig = folder.updateSyncState.bind(folder);
    let refused = 0;
    folder.updateSyncState = async (m) => {
      const peek = m(await folder.readSyncState());
      if ('changes_cursor' in peek && refused === 0) { refused++; throw Object.assign(new Error('busy'), { name: 'NoModificationAllowedError' }); }
      return orig(m);
    };
    await engine.pullNow();
    folder.updateSyncState = orig;
    expect(refused).toBe(1);
    expect(await ids()).not.toContain(SPOILER);
    await engine.pullNow();
    expect((await folder.readSyncState()).left_view).toEqual([SPOILER]);
    await folder.updateElement(CROSSING, { description: 'the contributor wrote this' });
    const p = await engine.pushOnce();
    expect(p.failures).toEqual([]);
  });
});

describe('an unhide gives back (I5)', () => {
  it('keel\'s 409 view and the walk from 0 that names it again: back in the copy, no longer left', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.__server_hide('character', SPOILER);
    await engine.pullNow();
    expect(await ids()).not.toContain(SPOILER);
    client.outOfView.delete(SPOILER);
    viewMoves(() => true, 'view');
    await engine.pullNow();
    expect(await ids()).toContain(SPOILER);
    expect((await folder.readSyncState()).left_view).toEqual([]);
  });
});

describe('a 409 with reason view in a writable world (I3)', () => {
  it('drops the unchanged, keeps the edited, and remembers what left', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.keyRole = 'guest';
    await folder.updateElement(FERRY, { description: 'my note on the ferry' });
    viewMoves(id => id === MINE || id === CROSSING, 'view');
    const r = await engine.pullNow();
    expect(await ids()).toEqual([MINE, FERRY, CROSSING].sort());
    expect(r.pulled.deletes).toBe(1);
    const st = await folder.readSyncState();
    expect(st.left_view).toEqual([SPOILER]);
    expect(st.kept_outside_view).toEqual([FERRY]);
    expect(st.server_deletes ?? []).toEqual([]);
  });

  it('leaves what waits in the delete review to the person (G3)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    await client.deleteElement('location', FERRY);
    await engine.pullNow();
    viewMoves(id => id !== FERRY, 'view');
    await engine.pullNow();
    expect(await ids()).toContain(FERRY);
    expect(((await folder.readSyncState()).server_deletes ?? []).map(d => d.id)).toEqual([FERRY]);
  });

  it('keeps a link to what the walk dropped, on an element the walk applied (G4)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.keyRole = 'guest';
    await client.updateElement('event', CROSSING, { name: 'The crossing', characters: [MINE], description: 'the owner wrote this' });
    viewMoves(id => id === MINE || id === CROSSING, 'view');
    await engine.pullNow();
    const ev = await folder.getElement(CROSSING);
    expect(ev?.description).toBe('the owner wrote this');
    expect(ev?.characters).toEqual([MINE, SPOILER]);
  });

  it('reason role keeps everything (conv. 151)', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    client.keyRole = 'guest';
    viewMoves(id => id === MINE || id === CROSSING, 'role');
    const r = await engine.pullNow();
    expect(await ids()).toEqual([MINE, SPOILER, FERRY, CROSSING].sort());
    expect(r.pulled.deletes).toBe(0);
    expect((await folder.readSyncState()).left_view ?? []).toEqual([]);
  });

  it('no reason keeps in a writable world, even with the role unmoved: no guess', async () => {
    const engine = new SyncEngine({ folder, client });
    await contributorWorld(engine);
    viewMoves(id => id === MINE || id === CROSSING);
    const r = await engine.pullNow();
    expect(await ids()).toEqual([MINE, SPOILER, FERRY, CROSSING].sort());
    expect(r.pulled.deletes).toBe(0);
  });
});
