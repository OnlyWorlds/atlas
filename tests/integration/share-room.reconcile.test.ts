/**
 * Regressions: the Pages room's once-per-mount mirror
 * reconcile (reconcilePubMirrors).
 *
 * C4: a world switch while world A's list call is out must not heal world B's
 * mirrors against A's rows (it used to null B's atlas_page_pub, orphaning the
 * live public page).
 * C5: a server row that differs from the mirror only by timestamps is not a
 * heal (publish stamps local times), and a real heal keeps content_sig so the
 * "edited since publish" reminder survives.
 *
 * Bootstrap follows share-room.republishMirror.test.ts.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { mswServer } from '../setup';
import { statefulSharingHandlers } from '../msw-sharing-handlers';
import { SHARING_BASE_URL, SharingClient } from '../../src/sync/sharing-client';
import { mountShareRoom } from '../../src/middle/share-room';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

function entry(id: string, key: string): WorldRegistryEntry {
  return {
    id, name: id, state: 'api-linked',
    api: { world_id: `srv-${id}`, api_key: key },
    folder: { handle_key: `vault-${id}`, folder_name: id },
    created_at: '2026-01-01T00:00:00Z',
  } as WorldRegistryEntry;
}

const makeToasts = () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() });
const EMPTY_PAYLOAD = { schema_version: 1, title: 'x', intent: 'show', theme: {}, blocks: [], elements: {} };

async function openStore(): Promise<MockFolderStore> {
  const s = new MockFolderStore();
  await s.open(null as unknown as FileSystemDirectoryHandle);
  return s;
}

async function activate(store: MockFolderStore, worldId: string): Promise<void> {
  setActiveStore(store as unknown as FsFolderStore);
  patchSlice('active', { worldId, meta: await store.readWorldMeta(), opened: true });
  patchSlice('data', { elements: await store.listElements() });
}

async function pubOf(store: MockFolderStore, id: string): Promise<Record<string, unknown> | null> {
  const el = (await store.listElements()).find(e => e.id === id) as Record<string, unknown>;
  return (el.atlas_page_pub as Record<string, unknown> | null | undefined) ?? null;
}

describe('share room reconcile', () => {
  const hosts: HTMLElement[] = [];
  const unmounts: Array<() => void> = [];
  afterEach(() => {
    unmounts.forEach(u => u()); unmounts.length = 0;
    hosts.forEach(h => h.remove()); hosts.length = 0;
    setActiveStore(null);
    patchSlice('active', null);
    patchSlice('data', { elements: [] });
    patchSlice('registry', defaultRegistry());
    window.location.hash = '';
  });

  function mount(toasts = makeToasts()): ReturnType<typeof makeToasts> {
    const h = document.createElement('div');
    document.body.appendChild(h);
    hosts.push(h);
    unmounts.push(mountShareRoom(h, toasts as unknown as ToastManager));
    return toasts;
  }

  it("C4: a world switch during A's list call leaves world B's publish mirror intact", async () => {
    const fake = statefulSharingHandlers(SHARING_BASE_URL);
    mswServer.use(...fake.handlers);
    let alphaAnswered = false;
    mswServer.use(http.get(`${SHARING_BASE_URL}/pages/`, async ({ request }) => {
      const auth = `${request.headers.get('API-Key') ?? ''} ${request.headers.get('Authorization') ?? ''}`;
      if (auth.includes('key-alpha')) {
        await delay(300);
        alphaAnswered = true;
        return HttpResponse.json([]);
      }
      return undefined;
    }));

    const storeA = await openStore();
    const storeB = await openStore();
    const pageB = await storeB.createElement('narrative', { name: 'Player handout', subtype: 'page' });
    const res = await new SharingClient({ apiKey: 'key-beta', pin: '1234' }).publish({
      slug: 'player-handout', title: 'Player handout', intent: 'show', payload: EMPTY_PAYLOAD,
    });
    const pub = { id: res.id, slug: res.slug, published_at: 't', updated_at: 't', revoked: false };
    await storeB.updateElement(pageB.id, { atlas_page_pub: pub } as never);
    patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [entry('wA', 'key-alpha'), entry('wB', 'key-beta')] }, '1234'));

    // Land on Pages in world A: the list view starts A's reconcile.
    await activate(storeA, 'wA');
    window.location.hash = '#/w/wA/share';
    mount();
    patchSlice('data', { elements: await storeA.listElements() });

    // Switch to B before A's list call answers (app.ts remounts on a world change).
    unmounts.shift()!();
    await activate(storeB, 'wB');
    window.location.hash = '#/w/wB/share';
    mount();

    await vi.waitFor(() => expect(alphaAnswered).toBe(true), { timeout: 3000 });
    await delay(100); // let any heal writes the stale step might attempt land
    expect(await pubOf(storeB, pageB.id)).toMatchObject({ id: res.id, slug: 'player-handout', revoked: false });
  });

  it('C5: a timestamp-only difference is not a heal; content_sig survives, no refresh toast', async () => {
    const fake = statefulSharingHandlers(SHARING_BASE_URL);
    mswServer.use(...fake.handlers);
    let listed = false;
    mswServer.events.on('response:mocked', ({ request }) => {
      if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/pages/')) listed = true;
    });

    const store = await openStore();
    const page = await store.createElement('narrative', { name: 'Handout', subtype: 'page' });
    const res = await new SharingClient({ apiKey: 'key-alpha', pin: '1234' }).publish({
      slug: 'handout-page', title: 'Handout', intent: 'show', payload: EMPTY_PAYLOAD,
    });
    // The mirror publishPage writes: local clock stamps, never equal to the server's.
    await store.updateElement(page.id, { atlas_page_pub: {
      id: res.id, slug: res.slug, published_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-01T00:00:00Z',
      revoked: false, content_sig: 'sig-at-publish',
    } } as never);
    patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [entry('wS', 'key-alpha')] }, '1234'));
    await activate(store, 'wS');
    window.location.hash = '#/w/wS/share';
    const toasts = mount();
    patchSlice('data', { elements: await store.listElements() });

    await vi.waitFor(() => expect(listed).toBe(true), { timeout: 3000 });
    await delay(100);
    mswServer.events.removeAllListeners();
    expect(toasts.info).not.toHaveBeenCalled();
    expect(await pubOf(store, page.id)).toMatchObject({ content_sig: 'sig-at-publish', revoked: false });
  });

  it('C5: a real heal (server-side revoke) keeps content_sig', async () => {
    const fake = statefulSharingHandlers(SHARING_BASE_URL);
    mswServer.use(...fake.handlers);
    const store = await openStore();
    const page = await store.createElement('narrative', { name: 'Handout', subtype: 'page' });
    const client = new SharingClient({ apiKey: 'key-alpha', pin: '1234' });
    const res = await client.publish({ slug: 'handout-page', title: 'Handout', intent: 'show', payload: EMPTY_PAYLOAD });
    await store.updateElement(page.id, { atlas_page_pub: {
      id: res.id, slug: res.slug, published_at: 't', updated_at: 't', revoked: false, content_sig: 'sig-at-publish',
    } } as never);
    await client.revoke(res.slug); // e.g. revoked from another device
    patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [entry('wS', 'key-alpha')] }, '1234'));
    await activate(store, 'wS');
    window.location.hash = '#/w/wS/share';
    const toasts = mount();
    patchSlice('data', { elements: await store.listElements() });

    await vi.waitFor(() => expect(toasts.info).toHaveBeenCalledWith(expect.stringContaining('Publish state refreshed')), { timeout: 3000 });
    expect(await pubOf(store, page.id)).toMatchObject({ revoked: true, content_sig: 'sig-at-publish' });
  });
});
