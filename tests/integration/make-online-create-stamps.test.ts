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
 *
 * The real FsFolderStore over fake-fs, the modal end to end, keel v2 played
 * by the stateful MSW server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MakeOnlineModal } from '../../src/ui/make-online-modal';
import { patchSlice, getState } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry } from '../../src/core/types';
import { ToastManager } from '../../src/ui/toast-manager';
import { detachSyncEngine } from '../../src/sync/sync-attach';
import { buildV2Adapter } from '../../src/sync/make-online';
import { SyncEngine } from '../../src/sync/sync-engine';
import { __resetFailureToasts } from '../../src/sync/sync-failure-copy';
import { world, putEl, open, clock, LOCAL_T } from './route2-gate/harness';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

console.debug = () => undefined;
console.info = () => undefined;

const V2 = 'https://www.onlyworlds.com/api/v2';
const AUTH = `${V2}/auth/app/v1`;
const TOKEN = 'ow_a_' + 's'.repeat(40);
const NEW_WORLD = '0e2e0000-0000-4000-8000-000000000151';
const WORLD_KEY = 'ow_w_' + 'k'.repeat(40);
const KEEL_FOREIGN = 'An element with id x already exists in another world. give this element a new id (a copied world folder needs fresh ids).';

const A = '00000000-0000-4000-8000-0000000000a1';
const B = '00000000-0000-4000-8000-0000000000b2';

let server: ReturnType<typeof statefulV2Handlers>;
let store: FsFolderStore;

function mountKeel(): void {
  server = statefulV2Handlers({ baseUrl: V2, clock, worldId: NEW_WORLD, worldName: 'Moppetopia' });
  mswServer.use(
    http.post(`${AUTH}/auth/login`, () => HttpResponse.json({ status: 200, meta: { session_token: 'sess-1' } })),
    http.delete(`${AUTH}/auth/session`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${V2}/account/tokens`, () => HttpResponse.json({ id: 'tok-1', token: TOKEN, name: 'Atlas in a browser', last4: 'ssss' }, { status: 201 })),
    http.get(`${V2}/account`, () => HttpResponse.json({ username: 'walker', email: 'walker@example.com' })),
    http.post(`${V2}/account/worlds`, () => HttpResponse.json({ id: NEW_WORLD, name: 'Moppetopia', key: WORLD_KEY }, { status: 201 })),
    ...server.handlers,
  );
}

/** keel's answer when every id in the batch lives in another world (atomic: nothing kept). */
function refuseBulkAsForeign(): void {
  mswServer.use(http.post(`${V2}/bulk`, async ({ request }) => {
    const body = await request.json() as { items: Array<{ element: { id: string } }> };
    return HttpResponse.json({
      errors: true,
      items: body.items.map(it => ({ status: 409, id: it.element.id, error: { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' } })),
    });
  }));
}

/** Two elements stamped as a downloaded copy writes them: local and server stamps equal. */
async function stampedCopy(): Promise<void> {
  const root = world();
  putEl(root, { id: A, type: 'character', name: 'Mop', server_updated_at: LOCAL_T });
  putEl(root, { id: B, type: 'location', name: 'Bucket Hill', server_updated_at: LOCAL_T });
  store = await open(root);
  setActiveStore(store as never);
  const entry = { id: 'w1', name: 'Moppetopia', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } };
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry as never] });
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'Moppetopia' }, opened: true } as never);
  patchSlice('data', { ...getState().data, elements: await store.listElements() });
}

async function createNew(): Promise<HTMLElement> {
  document.body.insertAdjacentHTML('beforeend', '<div id="toast-container"></div>');
  const toasts = new ToastManager();
  toasts.init();
  new MakeOnlineModal(toasts).open();
  const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
  const fill = (name: string, value: string) => { modal.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value; };
  fill('signin-login', 'walker@example.com');
  fill('signin-password', 'right');
  fill('create-pin', '1234');
  modal.querySelector<HTMLFormElement>('[data-form="create-route"]')!.requestSubmit();
  return vi.waitFor(() => {
    const t = [...document.querySelectorAll<HTMLElement>('.ow-toast')].find(el => /Moppetopia is online/.test(el.textContent ?? ''));
    expect(t).toBeDefined();
    return t!;
  }, { timeout: 5000 });
}

const onServer = (type: string, id: string) => !!server.state.get(type)?.has(id);

beforeEach(() => {
  document.body.innerHTML = '<div class="atlas-shell"></div>';
  __resetFailureToasts();
  mountKeel();
});

afterEach(() => {
  detachSyncEngine();
  mswServer.resetHandlers();
  document.body.innerHTML = '';
});

describe('Make online, Create new, on a copy carrying another world\'s stamps', () => {
  it('sends every element as a create, and the toast counts them', async () => {
    await stampedCopy();
    const toast = await createNew();
    expect(onServer('character', A), 'the stamped character went up').toBe(true);
    expect(onServer('location', B), 'the stamped location went up').toBe(true);
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
    expect(text).toMatch(/Settings can give them new ids/);
    expect(onServer('character', A)).toBe(false);

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
    detachSyncEngine();
    const engine = new SyncEngine({ folder: store, client: buildV2Adapter(WORLD_KEY, '1234'), apiWorldId: NEW_WORLD });
    await engine.pullNow();
    expect(await engine.listServerDeletes()).toEqual([]);
  });
});
