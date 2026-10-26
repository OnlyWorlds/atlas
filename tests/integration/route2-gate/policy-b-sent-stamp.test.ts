/**
 * Promoted from the composition gate (lens A).
 * Lens A attack 4: policy b's matched path is a PUSH (PATCH the local body up)
 * but it lands the response with `applyServerRecord`, which writes the
 * server's record over the file with no sent-stamp guard (conv. 96: "Any new
 * push path must pass it"). The body it sends comes from the store CACHE
 * (`sendable` → `getElement`), and `applyServerRecordUnchained` merges its
 * atlas-only fields from the cache too, never reading the disk.
 *
 * Two shapes an outside writer (a git pull, a Dropbox sync, a toolkit skill
 * editing the folder) produces; the runner makes the app inert and holds the
 * id-move lock, so no live-folder pass adopts either before Route 2 reads:
 *   1. the file changed on disk before Make Online, not yet adopted (cache stale)
 *   2. the file changed on disk WHILE its PATCH was in flight
 *
 * These rows assert the FIXED behaviour: the outside edit is still on disk
 * after the merge, and the element is dirty (the next round sends it) or the
 * server already holds it. RED today = the edit is overwritten and the file
 * is stamped clean with the server's older copy.
 */
import { describe, it, expect } from 'vitest';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { freshServer, world, putEl, open, srv, pathOf, j } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const O = '00000000-0000-4000-8000-0000000000a1';
const N = '00000000-0000-4000-8000-0000000000b1';
const T2 = '00000000-0000-4000-8000-0000000000d3';

describe('lens A attack 4: an outside edit to a policy-b matched element survives the merge', () => {
  it('an edit on disk before Make Online that no pass adopted yet (same-id match) is kept, not overwritten and stamped clean', async () => {
    const { server, adapter } = freshServer();
    await adapter.createElement('narrative', { id: T2, name: 'Chapter Two', story: 'server two' });
    const root = world();
    putEl(root, { id: T2, type: 'narrative', name: 'Chapter Two', story: 'local two' });
    const s = await open(root);
    await s.listElements(); // the app primed its list at open: the cache holds the file as it was

    // An outside tool rewrites the file, with a fresh stamp (the toolkit rule).
    const p = pathOf(root, T2)!;
    root.put(p, j({ id: T2, type: 'narrative', name: 'Chapter Two', story: 'outside edit', local_updated_at: '2026-03-01T00:00:00.000Z' }));

    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures).toEqual([]);

    const disk = JSON.parse(root.get(p)!);
    const kept = disk.story === 'outside edit';
    const serverHasIt = srv(server, 'narrative').get(T2)?.story === 'outside edit';
    const dirty = !disk.server_updated_at || disk.local_updated_at > disk.server_updated_at;
    // Fixed: either the PATCH sent the disk body (server has it), or the file kept it dirty.
    expect(serverHasIt || (kept && dirty), `disk story="${disk.story}", server story="${srv(server, 'narrative').get(T2)?.story}", dirty=${dirty}`).toBe(true);

    // And the first round does not lose it either.
    const s2 = await open(root);
    await new SyncEngine({ folder: s2, client: adapter }).syncNow();
    expect(srv(server, 'narrative').get(T2)?.story).toBe('outside edit');
  });

  it('an edit on disk while its PATCH is in flight (renamed pair) is kept dirty, as every other push path keeps it', async () => {
    const { server, adapter } = freshServer();
    await adapter.createElement('character', { id: N, name: 'Alice', description: 'server' });
    const root = world();
    putEl(root, { id: O, type: 'character', name: 'Alice', description: 'local' });
    const s = await open(root);

    const realPatch = adapter.updateElement.bind(adapter);
    (adapter as unknown as { updateElement: typeof adapter.updateElement }).updateElement = async (type, id, body) => {
      const res = await realPatch(type, id, body);
      // The server answered; before the response lands, the outside writer saves.
      const p = pathOf(root, N)!;
      const onDisk = JSON.parse(root.get(p)!);
      root.put(p, j({ ...onDisk, description: 'typed during the PATCH', local_updated_at: '2026-06-01T00:00:00.000Z' }));
      return res;
    };

    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures).toEqual([]);
    const disk = JSON.parse(root.get(pathOf(root, N)!)!);
    expect(disk.description, 'the in-flight edit is on disk').toBe('typed during the PATCH');
    expect(disk.local_updated_at > disk.server_updated_at, 'and dirty, so the next round sends it').toBe(true);
    expect(srv(server, 'character').get(N)?.description).toBe('local');
  });
});
