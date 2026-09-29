/**
 * Promoted from the S367 composition gate (lens B).
 * S367 gate lens B, modal level. RED today = finding reproduced.
 *
 * B5: while Route 2 runs (the id-move lock held, the app inert), the modal
 * itself is NOT inert: its "Create new" tab and the Route 1 form stay live,
 * and Route 1 (`handleCreate`) takes no lock. A second route can start on the
 * same folder mid-merge.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../setup';
import { MockFolderStore } from '../../fixtures/mock-folder-store';
import { MakeOnlineModal } from '../../../src/ui/make-online-modal';
import { patchSlice, getState } from '../../../src/core/state';
import { setActiveStore } from '../../../src/core/active-store';
import { ToastManager } from '../../../src/ui/toast-manager';
import { setMakeOnlineBaseUrl } from '../../../src/sync/make-online';
import { isRekeyRunning } from '../../../src/sync/rekey-run';
import type { Element } from '../../../src/core/types';

// One jsdom document for every file (vitest singleFork): leave it empty.
afterEach(() => { document.body.innerHTML = ''; });

const V2 = 'http://probe.local/api/v2';
let release!: () => void;

beforeEach(async () => {
  document.body.innerHTML = '<div class="atlas-shell"></div>';
  setMakeOnlineBaseUrl('http://probe.local/api/worldapi');
  const store = new MockFolderStore();
  await store.open(null);
  await store.createElement('character', { name: 'Alice' } as Partial<Element>);
  setActiveStore(store as never);
  const entry = { id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } };
  patchSlice('registry', { ...getState().registry, worlds: [entry as never] });
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
  patchSlice('data', { ...getState().data, elements: await store.listElements() });
  const gate = new Promise<void>(res => { release = res; });
  mswServer.use(
    http.get(`${V2}/world`, () => HttpResponse.json({ id: 'api-w', name: 'Server World' })),
    // The server list hangs: the merge is mid-flight, the lock held.
    http.get(`${V2}/:type`, async () => { await gate; return HttpResponse.json({ data: [], has_more: false, next_cursor: null }); }),
    http.post('http://probe.local/api/worldsync/create-world-external/', () => HttpResponse.json({ success: true, api_key: 'k2', world_id: 'api-w2', name: 'New' })),
  );
});

afterEach(() => { release?.(); });

describe('lens B, modal (red today)', () => {
  it('B5: while Route 2 runs, Route 1 cannot be started from the same modal', async () => {
    new MakeOnlineModal(new ToastManager()).open();
    const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
    modal.querySelector<HTMLButtonElement>('[data-route-tab="link"]')!.click();
    modal.querySelector<HTMLInputElement>('input[name="link-api-key"]')!.value = 'ow_key';
    modal.querySelector<HTMLInputElement>('input[name="link-pin"]')!.value = '1234';
    modal.querySelector<HTMLFormElement>('[data-form="link-route"]')!.requestSubmit();
    await vi.waitFor(() => expect(isRekeyRunning()).toBe(true), { timeout: 3000 });

    const createTab = modal.querySelector<HTMLButtonElement>('[data-route-tab="create"]')!;
    const createSubmit = modal.querySelector<HTMLButtonElement>('[data-action="create-submit"]')!;
    // The finding: both are live; a click on the tab then the submit starts
    // handleCreate (createApiWorld + a transient engine pushOnce on this folder)
    // beside the merge, outside the id-move lock.
    const blocked = createTab.disabled || createSubmit.disabled
      || modal.closest('[inert]') !== null || modal.querySelector('[data-route-pane="create"]')!.closest('[inert]') !== null;
    expect(blocked).toBe(true);
  });
});
