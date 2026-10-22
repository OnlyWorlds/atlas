/**
 * #527, the linked half: a world on OnlyWorlds that nobody changed stays
 * unchanged on disk through its syncs. The real store over a fake folder and
 * the fake keel: after a world has pushed and settled, more pulls and syncs
 * with nothing new on the server move no byte of the world's own files (the
 * dot paths, `.atlas/`, are the sync's own and the world-repo template's
 * ignore). The control: one change on the server moves exactly its file.
 */
import { describe, it, expect } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

function snapshot(root: FakeDirHandle): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of root.list()) if (!p.split('/').some(part => part.startsWith('.'))) out[p] = root.get(p)!;
  return out;
}
function changed(a: Record<string, string>, b: Record<string, string>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(p => a[p] !== b[p]).sort();
}

describe('an unchanged linked world', () => {
  it('pulls and syncs with nothing new on the server change no byte; one server change moves only its file', async () => {
    const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
    const root = new FakeDirHandle('w');
    root.put('world.json', j({ id: 'w1', name: 'W', producer: { tool: 'atlas', version: '1.72.1', input: 'bare' } }));
    const folder = new FsFolderStore({ clock: clock.next, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
    await folder.open(root as unknown as FileSystemDirectoryHandle);
    const client = new FakeOwApiClient();
    client.setClock(clock.next);
    client.__stamp_write_door('api');
    const engine = new SyncEngine({ folder, client, policy: 'drain-blind' });

    const place = await folder.createElement('location', { name: 'Vallaki', description: 'A walled river town.' });
    await folder.createElement('character', { name: 'Aralia', description: 'Keeps the ferry.', birthplace: place.id, birth_date: 312 });
    await folder.createElement('event', { name: 'The flood', start_date: 314 });
    await engine.syncNow();
    await engine.syncNow();

    const before = snapshot(root);
    expect(Object.keys(before).filter(p => p.startsWith('elements/')).length).toBe(3);
    await engine.pullNow();
    await engine.pullNow();
    await engine.syncNow();
    expect(changed(before, snapshot(root))).toEqual([]);

    // keel's 409 resync: the walk from 0 hands back every record, unchanged.
    const inner = client.pullChanges!;
    let refused = false;
    let walkedFromZero = 0;
    client.pullChanges = async (since, limit) => {
      if (since && !refused) {
        refused = true;
        throw Object.assign(new Error('API Error 409: resync'), { status: 409, code: 'resync_required', param: null, reason: 'view' });
      }
      const page = await inner(since, limit);
      if (refused && !since) walkedFromZero += page.changes.length;
      return page;
    };
    await engine.pullNow();
    await engine.pullNow();
    expect(refused).toBe(true);
    expect(walkedFromZero).toBeGreaterThanOrEqual(3);
    expect(changed(before, snapshot(root))).toEqual([]);

    const aralia = (await folder.listElements('character'))[0];
    client.__server_mutate('character', aralia.id, { description: 'Keeps the ferry, and the toll.' });
    await engine.pullNow();
    const moved = changed(before, snapshot(root));
    expect(moved.length).toBe(1);
    expect(moved[0]).toMatch(/^elements\/character\//);
  });
});
