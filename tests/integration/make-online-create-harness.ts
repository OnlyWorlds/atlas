/**
 * Make online, Create new, driven through the dialog: the real FsFolderStore
 * over fake-fs (`route2-gate/harness`), keel v2 played by the stateful MSW
 * server, the account steps (sign in, make the world) mounted beside it.
 * Shared by the create route's tests (`make-online-create-*.test.ts`).
 */
import { expect, vi } from 'vitest';
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
import { open, clock } from './route2-gate/harness';
import type { FakeDirHandle } from '../fixtures/fake-fs';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

export const V2 = 'https://www.onlyworlds.com/api/v2';
const AUTH = `${V2}/auth/app/v1`;
const TOKEN = 'ow_a_' + 's'.repeat(40);
export const NEW_WORLD = '0e2e0000-0000-4000-8000-000000000151';
export const WORLD_KEY = 'ow_w_' + 'k'.repeat(40);
export const KEEL_FOREIGN = 'An element with id x already exists in another world. give this element a new id (a copied world folder needs fresh ids).';

export type Keel = { server: ReturnType<typeof statefulV2Handlers>; worldsMade: () => number };

export function mountKeel(): Keel {
  const server = statefulV2Handlers({ baseUrl: V2, clock, worldId: NEW_WORLD, worldName: 'Moppetopia' });
  let made = 0;
  mswServer.use(
    http.post(`${AUTH}/auth/login`, () => HttpResponse.json({ status: 200, meta: { session_token: 'sess-1' } })),
    http.delete(`${AUTH}/auth/session`, () => new HttpResponse(null, { status: 204 })),
    http.post(`${V2}/account/tokens`, () => HttpResponse.json({ id: 'tok-1', token: TOKEN, name: 'Atlas in a browser', last4: 'ssss' }, { status: 201 })),
    http.get(`${V2}/account`, () => HttpResponse.json({ username: 'walker', email: 'walker@example.com' })),
    http.post(`${V2}/account/worlds`, () => {
      made++;
      return HttpResponse.json({ id: NEW_WORLD, name: 'Moppetopia', key: WORLD_KEY }, { status: 201 });
    }),
    ...server.handlers,
  );
  return { server, worldsMade: () => made };
}

/** keel's `/bulk` answer when the ids in `foreign` live in another world (atomic: nothing kept). A batch with none passes through. */
export function refuseBulkAsForeign(foreign?: ReadonlySet<string>): void {
  mswServer.use(http.post(`${V2}/bulk`, async ({ request }) => {
    const body = await request.clone().json() as { items: Array<{ element: { id: string } }> };
    const isForeign = (id: string) => !foreign || foreign.has(id);
    if (!body.items.some(it => isForeign(it.element.id))) return undefined;
    return HttpResponse.json({
      errors: true,
      items: body.items.map(it => isForeign(it.element.id)
        ? { status: 409, id: it.element.id, error: { code: 'id_conflict', message: KEEL_FOREIGN, param: 'id' } }
        : { status: 201, id: it.element.id }),
    });
  }));
}

/** Open `root` as the active, never-linked world 'w1', named Moppetopia. */
export async function openLocalWorld(root: FakeDirHandle): Promise<FsFolderStore> {
  const store = await open(root);
  setActiveStore(store as never);
  const entry = { id: 'w1', name: 'Moppetopia', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } };
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry as never] });
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'Moppetopia' }, opened: true } as never);
  patchSlice('data', { ...getState().data, elements: await store.listElements() });
  return store;
}

/** Fill Create new (signed out: sign-in, PIN) and submit. Returns the dialog. */
export function submitCreateNew(): HTMLElement {
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
  return modal;
}

/** Create new, then the toast that says the world is online. */
export async function createNew(): Promise<HTMLElement> {
  submitCreateNew();
  return vi.waitFor(() => {
    const t = [...document.querySelectorAll<HTMLElement>('.ow-toast')].find(el => /Moppetopia is online/.test(el.textContent ?? ''));
    expect(t).toBeDefined();
    return t!;
  }, { timeout: 5000 });
}

/** A refresh from the online world, by a fresh engine on the world's key: the elements it would flag deleted online. */
export async function deletedOnlineAfterPull(store: FsFolderStore): Promise<unknown[]> {
  detachSyncEngine();
  const engine = new SyncEngine({ folder: store, client: buildV2Adapter(WORLD_KEY, '1234'), apiWorldId: NEW_WORLD });
  await engine.pullNow();
  return engine.listServerDeletes();
}

export function onServer(keel: Keel, type: string, id: string): boolean {
  return !!keel.server.state.get(type)?.has(id);
}

export function setUp(): void {
  console.debug = () => undefined;
  console.info = () => undefined;
  document.body.innerHTML = '<div class="atlas-shell"></div>';
  __resetFailureToasts();
}

export function tearDown(): void {
  detachSyncEngine();
  mswServer.resetHandlers();
  document.body.innerHTML = '';
}
