/**
 * A lowered or removed member keeps their copy (Titus 2026-10-20; conv. 151).
 * keel's answers to a lowered guest, probed live: `/me` says
 * guest, the old cursor 409s `resync_required` (no reason yet), the walk from
 * 0 names only what the guest made, and a read or PATCH of anything else 404s
 * exactly as a deleted element.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

const A = '00000000-0000-4000-8000-0000000r0001';
const B = '00000000-0000-4000-8000-0000000r0002';
const C = '00000000-0000-4000-8000-0000000r0003';

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
  realPull = undefined;
});

const resync = (reason?: string) => Object.assign(new Error('API Error 409: resync'), {
  status: 409, code: 'resync_required', param: null, ...(reason ? { reason } : {}),
});

/** keel moves this key's view: an old cursor gets the 409, a walk from 0 names only what is still seen. */
let realPull: FakeOwApiClient['pullChanges'];
function viewMoves(seen: Set<string>, reason?: string): void {
  if (!realPull) realPull = client.pullChanges!.bind(client);
  const real = realPull!;
  let refused = false;
  client.pullChanges = async (since, limit) => {
    if (since && !refused) { refused = true; throw resync(reason); }
    const page = await real(since, limit);
    return { ...page, changes: page.changes.filter(op => seen.has(op.id)) };
  };
}

async function worldOfThree(engine: SyncEngine): Promise<void> {
  await client.createElement('character', { id: A, name: 'Cy, made by the member' });
  await client.createElement('character', { id: B, name: 'Ana, the owner\'s' });
  await client.createElement('location', { id: C, name: 'The Ferry' });
  await engine.pullNow();
  expect((await folder.listElements()).map(e => e.id).sort()).toEqual([A, B, C]);
}

const ids = async () => (await folder.listElements()).map(e => e.id).sort();

describe('a role change keeps the copy (I1, I7)', () => {
  it('a writable world lowered to guest keeps everything, and marks what it no longer sees', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    expect((await folder.readSyncState()).walked_as_role).toBe('co_builder');

    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    const r = await engine.pullNow();
    expect(await ids()).toEqual([A, B, C]);
    expect(r.pulled.deletes).toBe(0);
    expect(r.own_role).toBe('guest');
    expect(r.kept).toBe(2);
    const st = await folder.readSyncState();
    expect([...(st.kept_outside_view ?? [])].sort()).toEqual([B, C]);
    expect(st.walked_as_role).toBe('guest');
    expect(st.server_deletes ?? []).toEqual([]);
  });

  it('a view-only world whose role moved keeps too, with no reason from keel', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    const r = await engine.pullNow();
    expect(await ids()).toEqual([A, B, C]);
    expect(r.pulled.deletes).toBe(0);
    expect(r.kept).toBe(2);
  });

  it('keel\'s reason `role` keeps even when the role did not move (the roster moved)', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    viewMoves(new Set([A]), 'role');
    await engine.pullNow();
    expect(await ids()).toEqual([A, B, C]);
  });

  it('an unknown role keeps (the /me read fails): Titus\'s side of the error', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    client.meFails = true;
    viewMoves(new Set([A]));
    const r = await engine.pullNow();
    expect(await ids()).toEqual([A, B, C]);
    expect(r.own_role).toBeUndefined();
    expect((await folder.readSyncState()).walked_as_role).toBe('guest');
  });

  it('a world never walked under a known role keeps on its first resync', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true });
    client.meFails = true;
    await worldOfThree(engine);
    expect((await folder.readSyncState()).walked_as_role).toBeUndefined();
    client.meFails = false;
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    expect(await ids()).toEqual([A, B, C]);
  });
});

describe('keel\'s word that the view moved still drops in a view-only world (I6)', () => {
  it('no reason and the same role: what left the view goes, as 1.55 does', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    viewMoves(new Set([A, B]));
    const r = await engine.pullNow();
    expect(await ids()).toEqual([A, B]);
    expect(r.pulled.deletes).toBe(1);
  });

  it('reason `view` drops what left, never what a role change kept', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A, C]));
    await engine.pullNow();
    expect((await folder.readSyncState()).kept_outside_view).toEqual([B]);

    viewMoves(new Set([A]), 'view');
    const r = await engine.pullNow();
    expect(await ids()).toEqual([A, B]);
    expect(r.pulled.deletes).toBe(1);
    expect((await folder.readSyncState()).kept_outside_view).toEqual([B]);
  });

  it('reason `view` drops even when the role cannot be read: keel said so', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    client.meFails = true;
    viewMoves(new Set([A]), 'view');
    const r = await engine.pullNow();
    expect(await ids()).toEqual([A]);
    expect(r.pulled.deletes).toBe(2);
  });

  it('a writable world drops only on keel\'s own `view` (one-rule §3, which narrowed an earlier "never drops")', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    viewMoves(new Set([A]), 'view');
    const r = await engine.pullNow();
    expect(await ids()).toEqual([A]);
    expect(r.pulled.deletes).toBe(2);
    expect([...((await folder.readSyncState()).left_view ?? [])].sort()).toEqual([B, C]);
  });
});

describe('a raise gives back (I8)', () => {
  it('what the walk names again leaves the kept set and syncs again', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    expect([...((await folder.readSyncState()).kept_outside_view ?? [])].sort()).toEqual([B, C]);

    client.keyRole = 'contributor';
    viewMoves(new Set([A, B, C]));
    await engine.pullNow();
    expect((await folder.readSyncState()).kept_outside_view).toEqual([]);

    await folder.updateElement(C, { description: 'back in view' });
    const p = await engine.pushOnce();
    expect(p.pushed.updates).toBe(1);
    expect(p.kept_edit_ids).toBeUndefined();
  });
});

describe('an edit to what this key no longer sees stays here (I2, I3)', () => {
  it('a kept element is skipped by the push, unread and unsent, and never reviewed for deletion', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();

    await folder.updateElement(B, { description: 'the member\'s own note on Ana' });
    client.calls = [];
    const p = await engine.pushOnce();
    expect(p.kept_edit_ids).toEqual([B]);
    expect(client.calls.filter(c => 'id' in c && c.id === B)).toEqual([]);
    expect((await folder.getElement(B))?.description).toBe('the member\'s own note on Ana');
    expect((await folder.readSyncState()).server_deletes ?? []).toEqual([]);
  });

  it('a guest\'s 404 on an element not yet kept is kept, never sent to the delete review', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    client.outOfView.add(B);

    await folder.updateElement(B, { description: 'edited after the owner lowered me' });
    const p = await engine.pushOnce();
    expect(p.kept_edit_ids).toEqual([B]);
    const st = await folder.readSyncState();
    expect(st.server_deletes ?? []).toEqual([]);
    expect(st.kept_outside_view).toEqual([B]);
    expect(await ids()).toEqual([A, B, C]);

    // The next round does not ask again.
    client.calls = [];
    const again = await engine.pushOnce();
    expect(again.kept_edit_ids).toEqual([B]);
    expect(client.calls.filter(c => 'id' in c && c.id === B)).toEqual([]);
  });

  it('a lowering while the world is open: the push reads the role afresh', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);           // the engine has read co_builder
    client.keyRole = 'guest';             // lowered; no pull since
    client.outOfView.add(B);
    await folder.updateElement(B, { description: 'edited after the lowering' });
    const p = await engine.pushOnce();
    expect(p.kept_edit_ids).toEqual([B]);
    expect((await folder.readSyncState()).server_deletes ?? []).toEqual([]);
  });

  it('the push reports the role its round read, so the attach can say it before any pull', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    client.outOfView.add(B);
    await folder.updateElement(B, { description: 'edited after the lowering' });
    const p = await engine.pushOnce();
    expect(p.own_role).toBe('guest');
  });

  it('a push that never needed the role reports none and asks keel nothing', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    await folder.updateElement(A, { description: 'my own, still in view' });
    const before = client.meReads;
    const p = await engine.pushOnce();
    expect(p.own_role).toBeUndefined();
    expect(client.meReads).toBe(before);
  });

  it('a round whose push and pull read different roles reports the pull\'s, the later read', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.outOfView.add(B);
    await folder.updateElement(B, { description: 'mine' });
    // The push reads guest; by the pull's resync the owner has raised the key.
    const realMe = client.me.bind(client);
    let reads = 0;
    client.me = async () => (reads++ === 0 ? { role: 'guest' } : realMe());
    client.keyRole = 'contributor';
    viewMoves(new Set([A, B, C]));
    const r = await engine.syncNow();
    expect(reads).toBeGreaterThan(1);
    expect(r.own_role).toBe('contributor');
  });

  it('an unknown role on a 404: neither kept nor reviewed, the edit waits for the next round (G5)', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    client.meFails = true;
    client.outOfView.add(B);
    await folder.updateElement(B, { description: 'mine' });
    const p = await engine.pushOnce();
    expect(p.own_role).toBeUndefined();       // unknown is not news
    const st = await folder.readSyncState();
    expect(st.server_deletes ?? []).toEqual([]);
    expect(st.kept_outside_view ?? []).toEqual([]);
    expect((await folder.listLocallyChangedSince(null)).map(e => e.id)).toEqual([B]);
  });

  it('a review row already written for a kept element goes (G4: 1.59.1 wrote them)', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    await folder.updateSyncState(() => ({ server_deletes: [{ id: B, type: 'character', detected_at: '2026-01-01T00:00:00Z', name: 'Ana' }] }));
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    expect((await folder.readSyncState()).server_deletes ?? []).toEqual([]);
  });

  it('a kept element deleted here leaves the kept set (G10)', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    await folder.deleteElement(B);
    await engine.pushOnce();
    expect((await folder.readSyncState()).kept_outside_view).toEqual([C]);
  });

  it('a raise in the same round as the push: the edit is not said to stay (G9)', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    await folder.updateElement(B, { description: 'mine' });
    client.keyRole = 'contributor';
    viewMoves(new Set([A, B, C]));
    const r = await engine.syncNow();
    expect(r.kept_edit_ids).toBeUndefined();
    expect((await folder.readSyncState()).kept_outside_view).toEqual([]);
  });

  it('a contributor\'s 404 is a real delete and still goes to the review', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'contributor';
    await worldOfThree(engine);
    client.__server_evict('character', B);

    await folder.updateElement(B, { description: 'edited after it was deleted online' });
    const p = await engine.pushOnce();
    expect(p.kept_edit_ids).toBeUndefined();
    expect(((await folder.readSyncState()).server_deletes ?? []).map(d => d.id)).toEqual([B]);
  });
});

describe('links to what this key no longer sees (keel probed live)', () => {
  const EV = '00000000-0000-4000-8000-0000000r0004';

  it('a guest\'s own element goes out without the kept link, and the copy keeps it', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    await client.createElement('event', { id: EV, name: 'The crossing', characters: [A, B] });
    await engine.pullNow();
    client.keyRole = 'guest';
    viewMoves(new Set([A, EV]));
    await engine.pullNow();
    expect((await folder.readSyncState()).kept_outside_view).toEqual(expect.arrayContaining([B, C]));

    await folder.updateElement(EV, { description: 'the guest wrote this' });
    client.calls = [];
    const p = await engine.pushOnce();
    expect(p.pushed.updates).toBe(1);
    const sent = client.calls.find(c => c.method === 'update' && c.id === EV) as { body: Record<string, unknown> } | undefined;
    expect(sent?.body.characters).toEqual([A]);
    expect((await folder.getElement(EV))?.characters).toEqual([A, B]);
    expect((await folder.readSyncState()).server_deletes ?? []).toEqual([]);
  });

  it('keel\'s read without the kept link does not erase it from the copy', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    await client.createElement('event', { id: EV, name: 'The crossing', characters: [A, B] });
    await engine.pullNow();
    client.keyRole = 'guest';
    viewMoves(new Set([A, EV]));
    await engine.pullNow();
    // The owner writes the event; the guest's read of it leaves Ana's id out.
    await client.updateElement('event', EV, { name: 'The crossing', characters: [A], description: 'the owner wrote this' });
    await engine.pullNow();
    const ev = await folder.getElement(EV);
    expect(ev?.description).toBe('the owner wrote this');
    expect(ev?.characters).toEqual([A, B]);
  });

  it('a guest\'s link keel says does not exist: the peer is kept, never reviewed, and no failure is said', async () => {
    // Hex ids: keel's invalid_link message carries a real uuid, and the engine parses only that.
    const ANA = '00000000-0000-4000-8000-00000000a0a1';
    const CROSSING = '00000000-0000-4000-8000-00000000e0e1';
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'guest';
    client.strictUpdateLinks = true;
    await client.createElement('character', { id: ANA, name: 'Ana' });
    await client.createElement('event', { id: CROSSING, name: 'The crossing', characters: [] });
    await engine.pullNow();
    // Ana is out of this key's view online, never kept yet; the guest links her here.
    client.outOfView.add(ANA);
    await folder.updateElement(CROSSING, { characters: [ANA] });
    const p = await engine.pushOnce();
    expect(p.failures).toEqual([]);
    const st = await folder.readSyncState();
    expect(st.server_deletes ?? []).toEqual([]);
    expect(st.kept_outside_view).toEqual([ANA]);
    const again = await engine.pushOnce();
    expect(again.pushed.updates).toBe(1);
  });
});

describe('the second gate round', () => {
  const ANA = '00000000-0000-4000-8000-00000000a0a1';
  const OWNEV = '00000000-0000-4000-8000-00000000e0e1';
  const NEWEV = '00000000-0000-4000-8000-00000000e0e2';
  const NEWEV2 = '00000000-0000-4000-8000-00000000e0e3';

  it('H1: a link to an element out of view, lowered while open, no pull: kept, never reviewed', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    client.strictUpdateLinks = true;
    await client.createElement('character', { id: ANA, name: 'Ana' });
    await client.createElement('event', { id: OWNEV, name: 'Mine', characters: [] });
    await engine.pullNow();
    client.keyRole = 'guest';
    client.outOfView.add(ANA);
    await folder.updateElement(OWNEV, { characters: [ANA] });
    const p = await engine.pushOnce();
    expect(p.failures).toEqual([]);
    const st = await folder.readSyncState();
    expect(st.server_deletes ?? []).toEqual([]);
    expect(st.kept_outside_view).toEqual([ANA]);
  });

  it('H2: a peer never sent is a local create, not out of view: never kept, and the link reaches keel', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'guest';
    client.strictUpdateLinks = true;
    await client.createElement('character', { id: ANA, name: 'Ana' });
    await client.createElement('event', { id: OWNEV, name: 'Mine', triggers: [] });
    await engine.pullNow();
    client.outOfView.add(ANA);
    // A new local event naming Ana (out of view, not kept yet), and the guest's own event naming it.
    await folder.createElement('event', { id: NEWEV, name: 'New', characters: [ANA] });
    await folder.updateElement(OWNEV, { triggers: [NEWEV] });
    await engine.pushOnce();
    const st1 = await folder.readSyncState();
    expect(st1.kept_outside_view).toEqual([ANA]);
    await engine.pushOnce();
    expect(client.__server_get('event', NEWEV)?.characters).toEqual([]);
    expect(client.__server_get('event', OWNEV)?.triggers).toEqual([NEWEV]);
    expect((await folder.readSyncState()).kept_outside_view).toEqual([ANA]);
  });

  it('a /bulk create goes out without the kept link (H6)', async () => {
    client.__enable_bulk();
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    await folder.createElement('event', { id: NEWEV, name: 'New one', characters: [A, B] });
    await folder.createElement('event', { id: NEWEV2, name: 'New two', characters: [B] });
    const p = await engine.pushOnce();
    expect(p.pushed.creates).toBe(2);
    expect(client.__server_get('event', NEWEV)?.characters).toEqual([A]);
    expect(client.__server_get('event', NEWEV2)?.characters).toEqual([]);
    expect((await folder.getElement(NEWEV))?.characters).toEqual([A, B]);
  });

  it('a push drops an old review row for a kept element too (H6, the push side of G4)', async () => {
    const engine = new SyncEngine({ folder, client });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    await folder.updateSyncState(() => ({ server_deletes: [{ id: B, type: 'character', detected_at: '2026-01-01T00:00:00Z', name: 'Ana' }] }));
    await engine.pushOnce();
    expect((await folder.readSyncState()).server_deletes ?? []).toEqual([]);
  });

  it('Keep mine on an element already kept sends nothing and keeps it (H6)', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    await client.updateElement('character', B, { name: 'Ana', description: 'online' });
    await folder.updateElement(B, { description: 'here' });
    await engine.syncNow();
    await folder.updateSyncState(() => ({ kept_outside_view: [B] }));
    client.calls = [];
    await engine.resolveConflict(B, 'overwrite-mine');
    expect(client.calls.filter(c => 'id' in c && c.id === B)).toEqual([]);
    const st = await folder.readSyncState();
    expect(st.conflicts).toEqual([]);
    expect(st.kept_outside_view).toEqual([B]);
  });
});

describe('a conflict on what this key no longer sees', () => {
  it('a resync that keeps an element drops its conflict', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    client.keyRole = 'co_builder';
    await worldOfThree(engine);
    await client.updateElement('character', B, { name: 'Ana', description: 'online' });
    await folder.updateElement(B, { description: 'here' });
    await engine.syncNow();
    expect((await folder.readSyncState()).conflicts.map(c => c.element_id)).toEqual([B]);

    client.keyRole = 'guest';
    viewMoves(new Set([A]));
    await engine.pullNow();
    expect((await folder.readSyncState()).conflicts).toEqual([]);
  });

  it('Keep mine on a guest\'s 404 keeps it here, never a review row', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    await client.updateElement('character', B, { name: 'Ana', description: 'online' });
    await folder.updateElement(B, { description: 'here' });
    await engine.syncNow();
    client.outOfView.add(B);
    await engine.resolveConflict(B, 'overwrite-mine');
    const st = await folder.readSyncState();
    expect(st.conflicts).toEqual([]);
    expect(st.server_deletes ?? []).toEqual([]);
    expect(st.kept_outside_view).toEqual([B]);
    expect((await folder.getElement(B))?.description).toBe('here');
  });

  it('Take theirs on a guest\'s 404 clears the conflict and keeps the copy', async () => {
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    client.keyRole = 'guest';
    await worldOfThree(engine);
    await client.updateElement('character', B, { name: 'Ana', description: 'online' });
    await folder.updateElement(B, { description: 'here' });
    await engine.syncNow();
    client.outOfView.add(B);
    await expect(engine.resolveConflict(B, 'pull-theirs')).resolves.toBeUndefined();
    expect((await folder.readSyncState()).conflicts).toEqual([]);
    expect((await folder.getElement(B))?.description).toBe('here');
  });
});
