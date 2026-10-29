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

    client.__server_mutate('character', el.id, { description: 'from Lantern', doors: { lantern: '2026-10-29T09:30:00Z', atlas: '2026-10-29T09:00:00Z' } });
    await engine.pullNow();
    expect(doorTrail((await folder.getElement(el.id))!).map(s => s.where)).toEqual(['in Lantern', 'in Atlas']);

    await folder.updateElement(el.id, { name: 'Rhea (mine)' });
    const result = await engine.syncNow();
    expect(result.failures).toEqual([]);
    const after = (await folder.getElement(el.id))! as Record<string, unknown>;
    const trail = doorTrail(after as never);
    expect(trail.map(s => s.where)).toEqual(['in Atlas', 'in Lantern']);
    expect(trail[0].at).toBe(after.server_updated_at);
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
