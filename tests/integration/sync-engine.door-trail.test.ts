/**
 * The trail after Atlas's own write (#760): keel stamps the write's door on the
 * element and answers with it, and the copy keeps that answer's `doors` with the
 * stamp, so the trail names this write and not only what the last pull read.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { doorTrail } from '../../src/core/door-trail';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-10-29T10:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
  client.__stamp_doors('atlas');
  engine = new SyncEngine({ folder, client });
});

describe('the trail after a push', () => {
  it('names Atlas first after an edit here, with the tool a pull brought in before it', async () => {
    const el = await folder.createElement('character', { name: 'Rhea' });
    await engine.syncNow();

    const doors = { lantern: '2026-10-29T09:30:00Z', atlas: '2026-10-29T09:00:00Z' };
    client.__server_mutate('character', el.id, { description: 'from Lantern', changed_client: 'lantern', doors });
    await engine.pullNow();
    // The feed serves no `doors`: the pulled copy names its last write alone, and the trail
    // is whole with what keel answers on a read of the element (sync/element-doors.ts).
    const pulled = (await folder.getElement(el.id))!;
    expect((pulled as Record<string, unknown>).doors).toBeUndefined();
    expect(doorTrail(pulled).map(s => s.where)).toEqual(['in Lantern']);
    const read = (await client.getElement('character', el.id)) as Record<string, unknown>;
    expect(read.doors).toEqual(doors);
    const answer = { doors: read.doors as Record<string, unknown>, updated_at: read.updated_at as string };
    expect(doorTrail(pulled, answer).map(s => s.where)).toEqual(['in Lantern', 'in Atlas']);

    await folder.updateElement(el.id, { name: 'Rhea (mine)' });
    const result = await engine.syncNow();
    expect(result.failures).toEqual([]);
    const after = (await folder.getElement(el.id))! as Record<string, unknown>;
    const trail = doorTrail(after as never);
    expect(trail.map(s => s.where)).toEqual(['in Atlas', 'in Lantern']);
    expect(trail[0].at).toBe(after.server_updated_at);
  });

  it('the echo of the copy\'s own write keeps its doors; a newer write does not', async () => {
    const el = await folder.createElement('character', { name: 'Ivo' });
    await engine.syncNow();
    const stamped = (await folder.getElement(el.id))! as Record<string, unknown>;
    expect(Object.keys((stamped.doors ?? {}) as object)).toEqual(['atlas']);
    // Apply the same write again as the feed serves it (no doors, the same stamp).
    const same = { ...stamped, doors: undefined } as Record<string, unknown>;
    delete same.doors;
    await folder.applyServerRecord('character', same, stamped.server_updated_at as string);
    expect(((await folder.getElement(el.id))! as Record<string, unknown>).doors).toEqual(stamped.doors);
    // A newer write without doors is another write: its record is keel's to say, not this copy's.
    await folder.applyServerRecord('character', same, '2099-01-01T00:00:00Z');
    expect(((await folder.getElement(el.id))! as Record<string, unknown>).doors).toBeUndefined();
  });

  it('never sends doors back', async () => {
    const el = await folder.createElement('character', { name: 'Bram' });
    await engine.syncNow();
    await folder.updateElement(el.id, { description: 'An edit.' });
    client.calls.length = 0;
    await engine.syncNow();
    const sent = client.calls.filter(c => c.method === 'update' || c.method === 'create');
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) expect(JSON.stringify(c)).not.toContain('"doors"');
  });
});
