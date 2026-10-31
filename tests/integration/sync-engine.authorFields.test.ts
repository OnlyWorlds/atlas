/**
 * Who wrote an element (SDK 4.26): every server write records
 * `changed_by` and `changed_via`, and every read hands them back, beside
 * `created_by`. They are the server's, never a difference anyone made
 * (`SERVER_AUTHOR_FIELDS`): a conflict never names them, and our own lost
 * create is still ours when the server stamped its door on it.
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
  client.__stamp_write_door('api');
  engine = new SyncEngine({ folder, client, policy: 'drain-blind' });
});

describe('the author fields are the server\'s', () => {
  it('a conflict names the field a person changed, never who wrote it', async () => {
    const el = await folder.createElement('character', { name: 'Rhea' });
    await engine.syncNow();
    await folder.updateElement(el.id, { name: 'Rhea (mine)' });
    client.__server_mutate('character', el.id, {
      name: 'Rhea (theirs)', changed_by: 'b1c2d3e4-0000-4000-8000-000000000001', changed_via: 'seat',
    });

    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fields).toEqual(['name']);
  });

  it('a pull adopts our own lost create though the server stamped its door on it', async () => {
    const a = await folder.createElement('character', { name: 'Rhea', description: 'one' });
    const realCreate = client.createElement.bind(client);
    let once = true;
    client.createElement = async (type, body) => {
      if (!once) return realCreate(type, body);
      once = false;
      await realCreate(type, body);
      throw new Error('network: response lost');
    };

    const result = await engine.syncNow(); // push: committed, response lost; pull: same content
    expect(client.__server_get('character', a.id)?.changed_via).toBe('api');
    expect(result.conflicts).toHaveLength(0);
    expect(await folder.listLocallyChangedSince(null)).toHaveLength(0);
  });

  // Never SENT is the adapter's (tests/integration/ow-v2-client-adapter.test.ts):
  // this fake strips them before its call log, as the adapter does.
  it('a pulled element keeps who wrote it on disk', async () => {
    const el = await folder.createElement('character', { name: 'Rhea' });
    await engine.syncNow();
    client.__server_mutate('character', el.id, { description: 'from a seat', changed_by: null, changed_via: 'seat' });
    await engine.pullNow();
    const onDisk = (await folder.getElement(el.id))!;
    expect(onDisk.description).toBe('from a seat');
    expect(onDisk.changed_via).toBe('seat');
  });

  it("the client that wrote it is the server's too: kept on disk, never a field anyone changed", async () => {
    const el = await folder.createElement('character', { name: 'Rhea' });
    await engine.syncNow();
    await folder.updateElement(el.id, { name: 'Rhea (mine)' });
    client.__server_mutate('character', el.id, { name: 'Rhea (theirs)', changed_via: 'api', changed_client: 'lantern' });
    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fields).toEqual(['name']);

    const other = await folder.createElement('character', { name: 'Bram' });
    await engine.syncNow();
    client.__server_mutate('character', other.id, { description: 'from Lantern', changed_client: 'lantern' });
    await engine.pullNow();
    expect((await folder.getElement(other.id))!.changed_client).toBe('lantern');
  });

  it("the tools that wrote it are the server's too: kept on disk, never a field anyone changed", async () => {
    const doors = { lantern: '2026-10-29T10:00:00Z', atlas: '2026-10-29T09:00:00Z' };
    const el = await folder.createElement('character', { name: 'Rhea' });
    await engine.syncNow();
    await folder.updateElement(el.id, { name: 'Rhea (mine)' });
    client.__server_mutate('character', el.id, { name: 'Rhea (theirs)', doors });
    const result = await engine.syncNow();
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].fields).toEqual(['name']);

    const other = await folder.createElement('character', { name: 'Bram' });
    await engine.syncNow();
    client.__server_mutate('character', other.id, { description: 'from Lantern', doors });
    await engine.pullNow();
    // keel's feed serves no `doors` (the trail reads them from the element, sync/element-doors.ts),
    // so a pulled copy holds none: never a field that went up or came in as a change.
    expect((await folder.getElement(other.id))!.doors).toBeUndefined();
  });
});
