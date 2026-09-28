/**
 * S361 (gate F3): a CREATE whose response was lost, with an edit made while
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
  it('an edit made while the lost create was in flight still reaches the server', async () => {
    const el = await folder.createElement('character', { name: 'Rhea', description: 'one' });
    loseFirstCreateResponse(() => folder.updateElement(el.id, { description: 'two' }).then(() => {}));

    await engine.syncNow(); // create commits "one", response lost, local says "two"
    await engine.syncNow(); // 409 id_conflict → adopt
    await engine.syncNow(); // the edit goes out as an UPDATE

    expect((await client.getElement('character', el.id))!.description).toBe('two');
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(0);
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
});
