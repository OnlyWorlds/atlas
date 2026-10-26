/**
 * Promoted from the composition gate (lens A).
 * Lens A attack 6: stale `server_updated_at` in a LOCAL-ONLY world (the reason
 * `allowStaleBaseline` exists: a folder copied out of an api world, a world
 * unlinked without a reset). Route 2 plans every such element as a CREATE
 * (its id is not on this server). When that create FAILS (one /bulk network
 * error, a transient 5xx, a validation refusal), the element keeps its stale
 * baseline. If it was clean under that baseline, the engine after linking
 * reads it as synced: it is never pushed, the /changes round never mentions
 * it, and the toast's "sync retries" (lane B Titus Q1 default) does not hold.
 *
 * Asserts the FIXED behaviour: after the failed create, linking and one sync
 * round, the element is on the server (or at the very least reads as not
 * synced). RED today = silently local-only forever, shown as synced.
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../setup';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { V2, freshServer, world, putEl, open, srv, LOCAL_T } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const E = '00000000-0000-4000-8000-0000000000d1';
const K = '00000000-0000-4000-8000-0000000000d2';

describe('lens A attack 6: a stale-stamped element whose Route 2 create failed', () => {
  it('is uploaded by the first sync round after linking (clean under its stale baseline)', async () => {
    const { server, adapter } = freshServer();
    const root = world();
    // Stale baseline from an earlier, unrelated link; untouched since (clean).
    putEl(root, { id: E, type: 'object', name: 'Cup', description: 'cup', server_updated_at: LOCAL_T });
    const s = await open(root);

    // One transient failure on the create.
    let down = true; // the server is unreachable for creates during the merge only
    mswServer.use(http.post(`${V2}/object`, () => {
      if (!down) return undefined as unknown as Response; // fall through to the stateful handler
      return HttpResponse.json({ error: { type: 'api_error', code: 'server_error', message: 'boom', param: null } }, { status: 503 });
    }));

    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures.map(f => f.element_id)).toEqual([E]); // the toast shows one failure
    down = false;

    // Linked: the engine runs its first rounds.
    const engine = new SyncEngine({ folder: s, client: adapter });
    await engine.syncNow();
    await engine.syncNow();
    const el = (await s.getElement(E))!;
    const readsSynced = !!el.server_updated_at && !(el.local_updated_at > el.server_updated_at);
    expect(srv(server, 'object').has(E) || !readsSynced, `on server: ${srv(server, 'object').has(E)}, reads synced: ${readsSynced}`).toBe(true);
    expect(srv(server, 'object').has(E), 'sync retried the create').toBe(true);
  });

  it('variant: dirty under its stale baseline, the engine pushes it as an UPDATE of an id this server never had', async () => {
    const { server, adapter } = freshServer();
    const root = world();
    putEl(root, { id: E, type: 'object', name: 'Cup', server_updated_at: LOCAL_T, local_updated_at: '2026-01-05T00:00:00.000Z' });
    const s = await open(root);
    let down = true;
    mswServer.use(http.post(`${V2}/object`, () => {
      if (!down) return undefined as unknown as Response;
      return HttpResponse.json({ error: { type: 'api_error', code: 'server_error', message: 'boom', param: null } }, { status: 503 });
    }));
    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures.map(f => f.element_id)).toEqual([E]);
    down = false;
    const engine = new SyncEngine({ folder: s, client: adapter });
    const r1 = await engine.syncNow();
    const r2 = await engine.syncNow();
    const el = await s.getElement(E);
    expect(srv(server, 'object').has(E), 'uploaded').toBe(true);
    expect(el, 'still local').not.toBeNull();
  });

  it('control: the same element created fine takes a fresh baseline', async () => {
    const { server, adapter } = freshServer();
    const root = world();
    putEl(root, { id: K, type: 'object', name: 'Plate', server_updated_at: LOCAL_T });
    const s = await open(root);
    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures).toEqual([]);
    expect(srv(server, 'object').has(K)).toBe(true);
    expect((await s.getElement(K))!.server_updated_at).not.toBe(LOCAL_T);
  });
});
