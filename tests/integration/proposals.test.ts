/**
 * keel #519, a seat's write that lands as a proposal (conv. 163; contract
 * `Forge/Notes/2026-10-22-s454-seat-proposals-contract.md`, P1 to P6).
 * The engine on FakeOwApiClient's `__propose_writes` seam, and the real
 * adapter against an MSW route that answers as keel did live (Seethe's read,
 * h29 #10600).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { isOwProposed } from '../../src/sync/proposals';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;
let engine: SyncEngine;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client, policy: 'pause-on-conflict' });
});

/** An element synced as the owner made it, then the key turns into a seat on a reviewed world. */
async function seatOnReviewedWorld(name = 'Ada') {
  const el = await folder.createElement('character', { name, description: 'As written.' });
  await engine.syncNow();
  client.__propose_writes(true);
  return el;
}

const updatesSent = () => client.calls.filter(c => c.method === 'update').length;

describe('P1, P2: a 202 is never an element', () => {
  it('a seat\'s edit becomes a proposal: no failure, no stamp, the edit stays here, keel unchanged', async () => {
    const el = await seatOnReviewedWorld();
    const baseline = (await folder.getElement(el.id))!.server_updated_at;
    await folder.updateElement(el.id, { description: 'Proposed by the seat.' });
    const r = await engine.syncNow();
    expect(r.failures).toEqual([]);
    expect(r.auth_blocked).toBeFalsy();
    expect(r.proposed_ids).toEqual([el.id]);
    expect(r.pushed.updates).toBe(0);
    const local = (await folder.getElement(el.id))!;
    expect(local.description).toBe('Proposed by the seat.');
    expect(local.server_updated_at).toBe(baseline);
    expect(client.__server_get('character', el.id)?.description).toBe('As written.');
    const state = await folder.readSyncState();
    expect(state.proposed?.map(e => e.element_id)).toEqual([el.id]);
    expect(client.__proposals()).toHaveLength(1);
  });
});

describe('P3: a proposed version is sent once', () => {
  it('the next round sends nothing; an edit after it proposes again and withdraws the old row', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'First.' });
    await engine.syncNow();
    const first = client.__proposals()[0].id;
    const sent = updatesSent();
    await engine.syncNow();
    expect(updatesSent()).toBe(sent);
    expect(client.__proposals()).toHaveLength(1);

    await folder.updateElement(el.id, { description: 'Second.' });
    const r = await engine.syncNow();
    expect(r.proposed_ids).toEqual([el.id]);
    expect(updatesSent()).toBe(sent + 1);
    const rows = client.__proposals();
    expect(rows.map(p => p.id)).not.toContain(first);
    expect(rows).toHaveLength(1);
    expect(rows[0].fields.description).toBe('Second.');
    expect((await folder.readSyncState()).proposed).toHaveLength(1);
  });
});

describe('P5: settled by keel\'s queue', () => {
  it('accepted: the copy takes the keeper\'s write, no conflict, nothing left pending', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__accept_proposal(client.__proposals()[0].id);
    const r = await engine.syncNow();
    expect(r.proposals_accepted).toEqual([el.id]);
    expect(r.conflicts).toEqual([]);
    const local = (await folder.getElement(el.id))!;
    expect(local.description).toBe('Proposed.');
    expect(local.server_updated_at).toBe(client.__server_get('character', el.id)?.updated_at);
    expect(local.local_updated_at <= local.server_updated_at!).toBe(true);
    const state = await folder.readSyncState();
    expect(state.proposed ?? []).toEqual([]);
    expect(state.conflicts).toEqual([]);
  });

  it('a refresh (a pull-only round) meets the accept before it settles: no conflict, then settled', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__accept_proposal(client.__proposals()[0].id);
    const r = await engine.pullNow();
    expect(r.conflicts).toEqual([]);
    expect(r.proposals_accepted).toEqual([el.id]);
    const state = await folder.readSyncState();
    expect(state.conflicts).toEqual([]);
    expect(state.proposed ?? []).toEqual([]);
    expect((await folder.getElement(el.id))!.description).toBe('Proposed.');
  });

  it('accepted while edited since: the newer edit stays and goes out on the new baseline', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__accept_proposal(client.__proposals()[0].id);
    client.__propose_writes(false); // the keeper turned the switch off meanwhile
    await folder.updateElement(el.id, { name: 'Ada Byron' });
    // The settle runs first in the round, so the newer edit goes out in the same round.
    const r = await engine.syncNow();
    expect(r.conflicts).toEqual([]);
    expect(r.proposals_accepted).toEqual([el.id]);
    expect(client.__server_get('character', el.id)?.name).toBe('Ada Byron');
    expect(client.__server_get('character', el.id)?.description).toBe('Proposed.');
  });

  it('accepted, then edited before any round settled it: no conflict, the edit is the next proposal', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__accept_proposal(client.__proposals()[0].id);
    await folder.updateElement(el.id, { name: 'Ada Byron' });
    const r = await engine.syncNow();
    expect(r.conflicts).toEqual([]);
    expect(r.proposals_accepted).toEqual([el.id]);
    expect(r.proposed_ids).toEqual([el.id]);
    const open = client.__proposals().filter(p => p.state === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].fields.name).toBe('Ada Byron');
    expect((await folder.readSyncState()).conflicts).toEqual([]);
  });

  it('declined: the review holds it with the keeper\'s reason, and it is not sent again on its own', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__decline_proposal(client.__proposals()[0].id, 'Not canon.');
    const r = await engine.syncNow();
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts[0].proposal).toEqual({ outcome: 'declined', reason: 'Not canon.' });
    const state = await folder.readSyncState();
    expect(state.proposed ?? []).toEqual([]);
    expect(state.conflicts.map(c => c.element_id)).toEqual([el.id]);
    const sent = updatesSent();
    await engine.syncNow();
    expect(updatesSent()).toBe(sent);
    expect((await folder.getElement(el.id))!.description).toBe('Proposed.');
  });

  it('declined, then Overwrite proposes again; declined, then Pull drops the edit', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__decline_proposal(client.__proposals()[0].id);
    await engine.syncNow();
    await engine.resolveConflict(el.id, 'overwrite-mine');
    let state = await folder.readSyncState();
    expect(state.conflicts).toEqual([]);
    expect(state.proposed?.map(e => e.element_id)).toEqual([el.id]);
    expect(client.__proposals().filter(p => p.state === 'open')).toHaveLength(1);

    client.__decline_proposal(client.__proposals().find(p => p.state === 'open')!.id);
    await engine.syncNow();
    await engine.resolveConflict(el.id, 'pull-theirs');
    state = await folder.readSyncState();
    expect(state.conflicts).toEqual([]);
    expect((await folder.getElement(el.id))!.description).toBe('As written.');
  });

  it('lapsed and withdrawn rows go to the review too', async () => {
    const a = await seatOnReviewedWorld('Ana');
    const b = await folder.createElement('character', { name: 'Bo' });
    client.__propose_writes(false);
    await engine.syncNow();
    client.__propose_writes(true);
    await folder.updateElement(a.id, { description: 'A.' });
    await folder.updateElement(b.id, { description: 'B.' });
    await engine.syncNow();
    const rows = client.__proposals();
    client.__lapse_proposal(rows.find(p => p.element_id === a.id)!.id);
    await client.withdrawProposal('character', b.id, rows.find(p => p.element_id === b.id)!.id);
    const r = await engine.syncNow();
    const byId = Object.fromEntries(r.conflicts.map(c => [c.element_id, c.proposal?.outcome]));
    expect(byId).toEqual({ [a.id]: 'lapsed', [b.id]: 'withdrawn' });
  });

  it('a queue that cannot be read leaves every entry for the next round', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    const list = client.listProposals.bind(client);
    client.listProposals = async () => { throw new TypeError('Failed to fetch'); };
    client.__accept_proposal(client.__proposals()[0].id);
    const r = await engine.syncNow();
    expect(r.proposals_accepted).toBeUndefined();
    expect((await folder.readSyncState()).proposed).toHaveLength(1);
    client.listProposals = list;
    expect((await engine.syncNow()).proposals_accepted).toEqual([el.id]);
  });
});

describe('P6: a delete keel keeps for the keeper', () => {
  it('is no dead key: the element comes back, the tombstone goes, the round carries on', async () => {
    const el = await seatOnReviewedWorld();
    await folder.deleteElement(el.id);
    const r = await engine.syncNow();
    expect(r.auth_blocked).toBeFalsy();
    expect(r.failures).toEqual([]);
    expect(r.delete_refused).toEqual([{ id: el.id, type: 'character', name: 'Ada' }]);
    expect((await folder.getElement(el.id))?.name).toBe('Ada');
    expect(await folder.listTombstonesSince(null)).toEqual([]);
    expect(engine.getState().kind).not.toBe('error');
  });

  it('the seat\'s own element still deletes', async () => {
    await seatOnReviewedWorld();
    const mine = await folder.createElement('character', { name: 'Made by the seat' });
    await engine.syncNow();
    await folder.deleteElement(mine.id);
    const r = await engine.syncNow();
    expect(r.delete_refused).toBeUndefined();
    expect(client.__server_get('character', mine.id)).toBeUndefined();
  });
});

describe('the adapter reads keel\'s 202 (P1)', () => {
  const BASE = 'https://test-ow.local/api/v2';
  const adapter = () => new OwV2ClientAdapter({ apiKey: 'ow_w_seat', apiPin: 'ow_s_secret', baseUrl: BASE });

  it('a 202 carrying a proposal throws OwProposed, never returns a record', async () => {
    mswServer.use(http.patch(`${BASE}/character/:id`, () => HttpResponse.json({
      proposal: { id: 'p-1', element_type: 'character', element_id: 'c-1', state: 'open', fields: { description: 'x' }, via: 'seat', client: 'atlas' },
    }, { status: 202 })));
    const out = await adapter().updateElement('character', 'c-1', { description: 'x' }).then(() => 'returned', e => e);
    expect(isOwProposed(out)).toBe(true);
    expect((out as { proposal: { id: string } }).proposal.id).toBe('p-1');
  });

  it('reads the queue across pages', async () => {
    let calls = 0;
    mswServer.use(http.get(`${BASE}/world/proposals`, ({ request }) => {
      calls++;
      const cursor = new URL(request.url).searchParams.get('cursor');
      return cursor
        ? HttpResponse.json({ data: [{ id: 'p-2', state: 'declined', decline_reason: 'no' }], has_more: false, next_cursor: null })
        : HttpResponse.json({ data: [{ id: 'p-1', state: 'open' }], has_more: true, next_cursor: 'p-1' });
    }));
    const { rows, complete } = await adapter().listProposals();
    expect(rows.map(r => r.id)).toEqual(['p-1', 'p-2']);
    expect(complete).toBe(true);
    expect(calls).toBe(2);
  });

  it('keel\'s 403 proposed_only arrives with its code', async () => {
    mswServer.use(http.delete(`${BASE}/character/:id`, () => HttpResponse.json({
      error: { type: 'permission_error', code: 'proposed_only', message: 'a seat deletes only what it created', param: null },
    }, { status: 403 })));
    const out = await adapter().deleteElement('character', 'c-1').then(() => 'deleted', e => e);
    expect((out as { code?: string }).code).toBe('proposed_only');
  });
});

describe('the S454 gate\'s findings, each held', () => {
  it('G1: a refused delete whose read-back fails keeps the tombstone and says nothing; the next round brings it back', async () => {
    const el = await seatOnReviewedWorld();
    await folder.deleteElement(el.id);
    const get = client.getElement.bind(client);
    client.getElement = async () => { throw new TypeError('Failed to fetch'); };
    const r1 = await engine.syncNow().catch(() => null);
    client.getElement = get;
    expect(r1?.delete_refused).toBeUndefined();
    expect((await folder.listTombstonesSince(null)).map(t => t.id)).toEqual([el.id]);
    const r2 = await engine.syncNow();
    expect(r2.delete_refused?.map(d => d.id)).toEqual([el.id]);
    expect((await folder.getElement(el.id))?.name).toBe('Ada');
  });

  it('G2: a proposal is recorded when keel answers, so a later auth bail does not send it again', async () => {
    const a = await seatOnReviewedWorld('Ana');
    const b = await folder.createElement('character', { name: 'Bo' });
    client.__propose_writes(false);
    await engine.syncNow();
    client.__propose_writes(true);
    await folder.updateElement(a.id, { description: 'A.' });
    await folder.updateElement(b.id, { description: 'B.' });
    client.__inject_failure('update', b.id, 'API Error 401: key revoked');
    await engine.syncNow().catch(() => null);
    expect((await folder.readSyncState()).proposed?.map(e => e.element_id)).toContain(a.id);
    const engine2 = new SyncEngine({ folder, client, policy: 'pause-on-conflict' });
    await engine2.syncNow();
    expect(client.__proposals().filter(p => p.element_id === a.id && p.state === 'open')).toHaveLength(1);
  });

  it('G4: under local-wins a declined proposal is never told as "your version replaced the online one"', async () => {
    const { __test_emitConflictToasts } = await import('../../src/sync/sync-attach');
    const { toastManager } = await import('../../src/ui/toast-manager');
    const said: string[] = [];
    const info = toastManager.info.bind(toastManager);
    toastManager.info = (m: string) => { said.push(m); return info(m); };
    try {
      __test_emitConflictToasts('push', {
        pushed: { creates: 0, updates: 0, deletes: 0 }, pulled: { creates: 0, updates: 0, deletes: 0 }, failures: [],
        conflicts: [{ element_id: 'x', type: 'character', detected_at: '', local_updated_at: '', server_updated_at: '', fields: [], proposal: { outcome: 'declined' } }],
      }, { worldId: null, current: true, policy: 'local-wins' });
    } finally { toastManager.info = info; }
    expect(said.filter(m => /replaced the online one/.test(m))).toEqual([]);
  });

  it('G5: Overwrite on a plain conflict withdraws the open proposal it replaces', async () => {
    engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'v1' });
    await engine.syncNow();
    client.__propose_writes(false);
    client.__server_mutate('character', el.id, { name: 'Ada (online)' });
    client.__propose_writes(true);
    await folder.updateElement(el.id, { description: 'v2' });
    await engine.syncNow();
    expect((await folder.readSyncState()).conflicts.map(c => c.element_id)).toEqual([el.id]);
    await engine.resolveConflict(el.id, 'overwrite-mine');
    const open = client.__proposals().filter(p => p.state === 'open');
    expect(open).toHaveLength(1);
    expect(open[0].fields.description).toBe('v2');
  });

  it('G7: a row the queue walk did not reach is still open, never withdrawn', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__cut_proposal_walk(0);
    const r = await engine.syncNow();
    expect(r.conflicts).toEqual([]);
    expect((await folder.readSyncState()).proposed).toHaveLength(1);
    client.__cut_proposal_walk(null);
  });

  it('G8: an element deleted online goes to the server-delete review, not a proposal row', async () => {
    const el = await seatOnReviewedWorld();
    await folder.updateElement(el.id, { description: 'Proposed.' });
    await engine.syncNow();
    client.__propose_writes(false);
    await client.deleteElement('character', el.id); // the keeper deletes it; keel drops its open rows
    for (const p of client.__proposals()) await client.withdrawProposal('character', el.id, p.id);
    const r = await engine.syncNow();
    expect(r.conflicts.filter(c => c.proposal)).toEqual([]);
    const state = await folder.readSyncState();
    expect((state.server_deletes ?? []).map(d => d.id)).toEqual([el.id]);
    expect(state.proposed ?? []).toEqual([]);
  });
});

describe('the review line (S454 live read)', () => {
  it('a reason that ends its own sentence takes no second stop', async () => {
    const { proposalReviewLine } = await import('../../src/sync/proposal-lines');
    expect(proposalReviewLine({ outcome: 'declined', reason: 'Not canon here.' })).toContain('"Not canon here." Overwrite');
    expect(proposalReviewLine({ outcome: 'declined', reason: 'Not canon' })).toContain('"Not canon". Overwrite');
  });
});
