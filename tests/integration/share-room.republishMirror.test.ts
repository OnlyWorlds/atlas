/**
 * S9 regression — republishPage must honor patchPage's boolean (parity with
 * publishPage). When the SERVER republish succeeds but the local mirror write
 * (atlas_page_pub) fails, the room must NOT toast unqualified success: the
 * public page is updated but atlas's local record is stale, and "up to date"
 * hides exactly the mirror-drift class from the 2026-07-05 live trace
 * (workplan S9).
 *
 * Reverting the fix (republishPage ignoring patchPage's return,
 * share-room.ts ~1299) makes the mirror-failure case toast success →
 * this test fails.
 *
 * This is also the first test that MOUNTS the share room in jsdom (real
 * mountShareRoom + MockFolderStore + stateful sharing fakes) — reuse this
 * bootstrap for future room-level regression tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mswServer } from '../setup';
import { statefulSharingHandlers } from '../msw-sharing-handlers';
import { SHARING_BASE_URL, SharingClient } from '../../src/sync/sharing-client';
import { mountShareRoom } from '../../src/middle/share-room';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry, Element } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';
import type { FsFolderStore } from '../../src/store/folder-store-fs';

const WORLD_ID = 'w-share-mirror';
const SLUG = 'regression-page';

function makeToasts() {
  return { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
}

function makeEntry(): WorldRegistryEntry {
  return {
    id: WORLD_ID,
    name: 'Mirror world',
    state: 'api-linked',
    api: { world_id: 'srv-mirror', api_key: 'key-alpha' },
    folder: { handle_key: 'vault-mirror', folder_name: 'mirror-world' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

describe('share room — republish honors the mirror write result (S9)', () => {
  let store: MockFolderStore;
  let page: Element;
  let toasts: ReturnType<typeof makeToasts>;
  let host: HTMLElement;
  let unmount: (() => void) | null = null;

  beforeEach(async () => {
    const fake = statefulSharingHandlers(SHARING_BASE_URL);
    mswServer.use(...fake.handlers);

    store = new MockFolderStore();
    await store.open(null as unknown as FileSystemDirectoryHandle);
    setActiveStore(store as unknown as FsFolderStore);

    page = await store.createElement('narrative', { name: 'Test page', subtype: 'page' });

    // Seed the server row the mirror points at (same account key the room will use).
    const seed = new SharingClient({ apiKey: 'key-alpha', pin: '1234' });
    const res = await seed.publish({
      slug: SLUG,
      title: 'Test page',
      intent: 'show',
      payload: { schema_version: 1, title: 'Test page', intent: 'show', theme: {}, blocks: [], elements: {} },
    });
    await store.updateElement(page.id, {
      atlas_page_pub: {
        id: res.id, slug: res.slug,
        published_at: '2026-07-01T00:00:00Z', updated_at: '2026-07-01T00:00:00Z',
        revoked: false,
      },
    });

    patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [makeEntry()] }, '1234'));
    patchSlice('active', { worldId: WORLD_ID, meta: await store.readWorldMeta(), opened: true });
    patchSlice('data', { elements: await store.listElements() });
    window.location.hash = `#/w/${WORLD_ID}/share/${page.id}`;

    toasts = makeToasts();
    host = document.createElement('div');
    document.body.appendChild(host);
    unmount = mountShareRoom(host, toasts as unknown as ToastManager);
  });

  afterEach(() => {
    unmount?.();
    unmount = null;
    host.remove();
    setActiveStore(null);
    patchSlice('active', null);
    patchSlice('data', { elements: [] });
    patchSlice('registry', defaultRegistry());
    window.location.hash = '';
  });

  function republishButton(): HTMLButtonElement {
    // T-S7 (session 248): Theme + Publish collapse behind the meta summary
    // row by default — expand it first, like a user would.
    if (!host.querySelector('[data-action="republish"]')) {
      const summary = host.querySelector<HTMLButtonElement>('.atlas-share-meta-summary');
      expect(summary, 'meta summary row should render on the detail view').toBeTruthy();
      summary!.click();
    }
    const btn = host.querySelector<HTMLButtonElement>('[data-action="republish"]');
    expect(btn, 'republish button should render for a published page').toBeTruthy();
    return btn!;
  }

  it('toasts success when the mirror write lands', async () => {
    republishButton().click();
    await vi.waitFor(() =>
      expect(toasts.success).toHaveBeenCalledWith('Republished — the public page is up to date'));
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('toasts an error, not success, when the mirror write fails', async () => {
    // Server republish will succeed; the LOCAL mirror write fails.
    store.updateElement = async () => { throw new Error('disk full'); };

    republishButton().click();
    await vi.waitFor(() =>
      expect(toasts.error).toHaveBeenCalledWith(expect.stringContaining("couldn't record it locally")));
    expect(toasts.success).not.toHaveBeenCalled();
  });
});
