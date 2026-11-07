/**
 * Make online, Create new, on a copy that mixes stamped elements with ones
 * made since, and holds a stub (keel's `known_of`) with a stamp of its own:
 * A and B stamped as a downloaded copy writes them, C new and linking to A,
 * D new, S a stamped stub.
 *
 * Every stamp is cleared before the push (`clearForeignBaselines`), the stub's
 * included: a stub is never sent (the store never lists one as changed), and
 * left stamped it would read as deleted online on the next full pull.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { world, putEl, LOCAL_T } from './route2-gate/harness';
import {
  mountKeel, refuseBulkAsForeign, openLocalWorld, createNew, deletedOnlineAfterPull, onServer,
  setUp, tearDown, WORLD_KEY, NEW_WORLD, type Keel,
} from './make-online-create-harness';
import { buildV2Adapter } from '../../src/sync/make-online';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';
const C = '00000000-0000-4000-8000-0000000000c3';
const D = '00000000-0000-4000-8000-0000000000d4';
const S = '00000000-0000-4000-8000-0000000000e5';

let keel: Keel;
let store: FsFolderStore;

async function mixedCopy(): Promise<void> {
  const root = world();
  putEl(root, { id: A, type: 'location', name: 'Mop Hall', server_updated_at: LOCAL_T });
  putEl(root, { id: B, type: 'location', name: 'Bucket Hill', server_updated_at: LOCAL_T });
  putEl(root, { id: C, type: 'location', name: 'New Cellar', parent_location: A });
  putEl(root, { id: D, type: 'character', name: 'New Person' });
  putEl(root, { id: S, type: 'character', name: 'Stub', known_of: true, server_updated_at: LOCAL_T });
  store = await openLocalWorld(root);
}

beforeEach(() => { setUp(); keel = mountKeel(); });
afterEach(tearDown);

describe('Make online, Create new, on a mixed copy with a stub', () => {
  it('no foreign ids: all four go up with the link kept, the stub is never sent, and a pull flags nothing', async () => {
    await mixedCopy();
    const toast = await createNew();
    expect(toast.textContent).toMatch(/Moppetopia is online · 4 elements uploaded/);
    for (const [type, id] of [['location', A], ['location', B], ['location', C], ['character', D]] as const) {
      expect(onServer(keel, type, id), `${type} ${id.slice(-2)} went up`).toBe(true);
    }
    expect(keel.server.state.get('location')?.get(C)?.parent_location, "C's link to A").toBe(A);
    expect(onServer(keel, 'character', S), 'the stub was never sent').toBe(false);
    const stub = await store.getElement(S);
    expect(stub?.known_of, 'the stub stays a stub').toBe(true);
    expect(stub?.server_updated_at, "the stub's old stamp is gone").toBeUndefined();

    expect(await deletedOnlineAfterPull(store)).toEqual([]);
    expect(await store.getElement(S), 'the stub is still here').toBeTruthy();
  });

  it('A and B foreign: D goes up, C waits for A, A B C keep no baseline, and a pull flags nothing', async () => {
    await mixedCopy();
    refuseBulkAsForeign(new Set([A, B]));
    const toast = await createNew();
    expect(toast.textContent).toMatch(/2 elements could not upload because their ids already belong to another OnlyWorlds world/);
    expect(onServer(keel, 'character', D), 'D went up').toBe(true);
    for (const id of [A, B, C]) expect(onServer(keel, 'location', id), `${id.slice(-2)} is not online`).toBe(false);

    expect(await deletedOnlineAfterPull(store)).toEqual([]);
    // A later round still refuses A and B and holds C back; none of them reads as synced.
    const engine = new SyncEngine({ folder: store, client: buildV2Adapter(WORLD_KEY, '1234'), apiWorldId: NEW_WORLD });
    const round = await engine.pushOnce();
    expect(round.failures.find(f => f.element_id === C)?.message).toMatch(/waits for an element/);
    for (const id of [A, B, C]) expect((await store.getElement(id))!.server_updated_at, `${id.slice(-2)} has no baseline`).toBeUndefined();
    expect((await store.getElement(D))!.server_updated_at).toBeTruthy();
  });
});
