/**
 * Make online, Create new, on a world whose element files carry server stamps
 * from another world: an Explore Moppetopia copy (downloaded through
 * `applyServerRecord`, so `local_updated_at` equals `server_updated_at`), or
 * any world file exported from a linked world and opened as a new world.
 *
 * Before the fix the create route sent nothing: `pushOnce` lists only what
 * changed since the baseline, every stamped element read as clean, the toast
 * said "0 elements uploaded", and the copy was linked to an empty world (a
 * later full pull flagged every element deleted online). The link route
 * already cleared such baselines before its creates; the create route now
 * does the same (`clearForeignBaselines`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getState } from '../../src/core/state';
import { world, putEl, LOCAL_T } from './route2-gate/harness';
import {
  mountKeel, refuseBulkAsForeign, openLocalWorld, createNew, deletedOnlineAfterPull, onServer,
  setUp, tearDown, NEW_WORLD, type Keel,
} from './make-online-create-harness';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';

let keel: Keel;
let store: FsFolderStore;

/** Two elements stamped as a downloaded copy writes them: local and server stamps equal. */
async function stampedCopy(): Promise<void> {
  const root = world();
  putEl(root, { id: A, type: 'character', name: 'Mop', server_updated_at: LOCAL_T });
  putEl(root, { id: B, type: 'location', name: 'Bucket Hill', server_updated_at: LOCAL_T });
  store = await openLocalWorld(root);
}

beforeEach(() => { setUp(); keel = mountKeel(); });
afterEach(tearDown);

describe('Make online, Create new, on a copy carrying another world\'s stamps', () => {
  it('sends every element as a create, and the toast counts them', async () => {
    await stampedCopy();
    const toast = await createNew();
    expect(onServer(keel, 'character', A), 'the stamped character went up').toBe(true);
    expect(onServer(keel, 'location', B), 'the stamped location went up').toBe(true);
    expect(toast.textContent).toMatch(/Moppetopia is online · 2 elements uploaded/);
    // Each carries this server's stamp now, not the copy's.
    expect((await store.getElement(A))!.server_updated_at).not.toBe(LOCAL_T);
  });

  it('ids that belong to another world stay local, unsynced, and the toast says how to give them new ids', async () => {
    await stampedCopy();
    refuseBulkAsForeign();
    const toast = await createNew();
    const text = toast.textContent ?? '';
    expect(text).not.toMatch(/0 elements uploaded/);
    expect(text).toMatch(/2 elements could not upload because their ids already belong to another OnlyWorlds world/);
    expect(text).toMatch(/Settings, under This world, can give them new ids/);
    expect(onServer(keel, 'character', A)).toBe(false);

    // Not believed synced: no baseline, so the store lists them as waiting to go up,
    for (const id of [A, B]) expect((await store.getElement(id))!.server_updated_at).toBeUndefined();
    expect((await store.listLocallyChangedSince(null)).map(e => e.id).sort()).toEqual([A, B]);
    // recorded as foreign for this world (the Settings re-key's worklist),
    const foreign = (await store.readSyncState()).foreign;
    expect(foreign?.api_world_id).toBe(NEW_WORLD);
    expect(foreign?.ids.map(e => e.id).sort()).toEqual([A, B]);
    // the list on screen agrees once the attached engine's first round is done (Settings reads it),
    await vi.waitFor(() => expect(getState().data.elements.filter(e => e.server_updated_at)).toEqual([]), { timeout: 5000 });
    // and a refresh from the empty online world flags none of them deleted online.
    expect(await deletedOnlineAfterPull(store)).toEqual([]);
  });
});
