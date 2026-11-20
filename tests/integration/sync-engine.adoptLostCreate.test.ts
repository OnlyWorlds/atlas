/**
 * A CREATE whose response was lost, with an edit made while
 * it was in flight, must still upload the edit.
 *
 * Round N sends the element; the user edits it; the server commits the ORIGINAL
 * body after the edit (its clock reads later) and the response never arrives.
 * Round N+1 re-POSTs, gets 409 `id_conflict`, and adopts the server's copy as
 * the baseline. Adopting used to stamp clean unconditionally: the file's
 * `local_updated_at` sorts below the server's commit, so the edit read as
 * synced and was never sent. Now the adopt compares content and keeps the
 * element dirty when the server holds a different body.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

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
  engine = new SyncEngine({ folder, client });
});

/** The first create commits on the server, then its response is "lost". */
function loseFirstCreateResponse(onInFlight?: () => Promise<void>): void {
  const realCreate = client.createElement.bind(client);
  let once = true;
  client.createElement = async (type, body) => {
    if (!once) return realCreate(type, body);
    once = false;
    if (onInFlight) await onInFlight();
    await realCreate(type, body);
    throw new Error('network: response lost');
  };
}

describe('adopting a create that is already on the server', () => {
  it('an edit made while the lost create was in flight is a review row like any differing copy, and Keep this copy sends it', async () => {
    // conv. 192, ruling 1: no record of the create sent, so the edit and a member's edit look
    // alike from here. Never pushed unseen; the person's choice sends it as an UPDATE.
    const el = await folder.createElement('character', { name: 'Rhea', description: 'one' });
    loseFirstCreateResponse(() => folder.updateElement(el.id, { description: 'two' }).then(() => {}));

    await engine.syncNow(); // create commits "one", response lost, local says "two"
    await engine.syncNow(); // held: nothing sent
    await engine.syncNow();

    expect((await client.getElement('character', el.id))!.description).toBe('one');
    expect(client.calls.filter(c => (c as { method: string }).method === 'update')).toHaveLength(0);
    expect((await folder.readSyncState()).conflicts.map(c => [c.element_id, c.no_baseline])).toEqual([[el.id, true]]);

    await engine.resolveConflict(el.id, 'overwrite-mine');
    expect((await client.getElement('character', el.id))!.description).toBe('two');
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(0);
    expect((await folder.readSyncState()).conflicts).toEqual([]);
  });

  it('an unchanged element adopts clean and sends nothing more', async () => {
    const el = await folder.createElement('character', { name: 'Rhea', description: 'one' });
    loseFirstCreateResponse();

    await engine.syncNow();
    await engine.syncNow(); // adopt: bodies match
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(0);
    const updates = client.calls.filter(c => (c as { method: string }).method === 'update');
    expect(updates).toHaveLength(0);
    expect((await client.getElement('character', el.id))!.description).toBe('one');
  });

  it('a read-back that fails on the network is one failure, not the end of the round (lane b L2)', async () => {
    const a = await folder.createElement('character', { name: 'Rhea' });
    loseFirstCreateResponse();
    // Push only: a full sync's pull would adopt A already (gate A L3:
    // same content on the server, never stamped = our own create).
    await engine.pushOnce(); // A committed, response lost
    await folder.createElement('character', { name: 'Ione' }); // B, never pushed
    const realGet = client.getElement.bind(client);
    client.getElement = async (type, id) => {
      if (id === a.id) throw new TypeError('Failed to fetch');
      return realGet(type, id);
    };
    const result = await engine.syncNow(); // A: 409 + failed read-back; B must still go out
    expect(result.failures.some(f => f.element_id === a.id)).toBe(true);
    expect(client.__server_count('character')).toBe(2);
  });

  it('a pull adopts our own lost create instead of reporting a conflict with ourselves (gate A L3)', async () => {
    const a = await folder.createElement('character', { name: 'Rhea', description: 'one' });
    loseFirstCreateResponse();
    const result = await engine.syncNow(); // push: committed, response lost; pull: same content
    expect(result.conflicts).toHaveLength(0);
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(0);
    expect((await folder.getElement(a.id))!.server_updated_at).toBeTruthy();
  });

  it('a pull still reports a conflict when our unstamped copy differs from the server', async () => {
    const a = await folder.createElement('character', { name: 'Rhea', description: 'one' });
    loseFirstCreateResponse(() => folder.updateElement(a.id, { description: 'two' }).then(() => {}));
    const result = await engine.syncNow();
    expect(result.conflicts.map(c => c.element_id)).toContain(a.id);
  });
});
