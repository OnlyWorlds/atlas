/**
 * New world on OnlyWorlds keeps the PIN as the account's only once the create
 * has resolved (1.124.31): keel checks it against the account at the create,
 * and a refused one keeps nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlainError } from '../../src/core/plain-error';

const h = vi.hoisted(() => ({ createPins: [] as string[] }));

vi.mock('../../src/ui/where-choice', () => ({
  whereChoiceHtml: () => '',
  wireWhereChoice: () => {},
  takeWhereInClick: () => 'browser',
  readyWhere: async () => true,
  lockWhereChoice: () => {},
}));
vi.mock('../../src/setup/atlas-root-flow', async () => {
  const { getState, patchSlice } = await import('../../src/core/state');
  const { setActiveStore } = await import('../../src/core/active-store');
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  return {
    createWorldInRoot: async (name: string) => {
      const entry = { id: 'local-new', name, state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' }, created_at: '2026-11-20T00:00:00Z' };
      patchSlice('registry', { ...getState().registry, worlds: [entry as never] });
      const store = new MockFolderStore();
      await store.open(null);
      setActiveStore(store as never);
      patchSlice('active', { worldId: entry.id, meta: { id: entry.id, name }, opened: true } as never);
      return { entry };
    },
  };
});
vi.mock('../../src/sync/make-online', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/make-online')>()),
  createApiWorld: async ({ pin }: { pin: string }) => {
    h.createPins.push(pin);
    // A seat's secret is held back from keel (never checked there), so the create resolves without it.
    if (pin !== '1234' && !pin.startsWith('ow_s_')) throw new PlainError('OnlyWorlds did not accept this PIN. Nothing was made. Check it, then try again.');
    return { apiKey: 'ow_w_made', worldId: 'w-made', worldName: 'Hollow Reach' };
  },
}));
vi.mock('../../src/sync/sync-attach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/sync-attach')>()),
  attachSyncEngine: vi.fn(),
}));

import { NewApiWorldModal } from '../../src/ui/new-api-world-modal';
import { getState, patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';

const toasts = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } as unknown as ToastManager;

async function create(pin: string): Promise<HTMLElement> {
  new NewApiWorldModal(toasts).open();
  const body = document.querySelector<HTMLElement>('[data-modal="new-api-world"]')!;
  body.querySelector<HTMLInputElement>('input[name="api-name"]')!.value = 'Hollow Reach';
  body.querySelector<HTMLInputElement>('input[name="api-pin"]')!.value = pin;
  body.querySelector<HTMLButtonElement>('[data-action="create-api"]')!.click();
  return body;
}

beforeEach(() => {
  h.createPins.length = 0;
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', { ...defaultRegistry(), account_token: 'ow_a_token', worlds: [] });
});
afterEach(() => { document.body.innerHTML = ''; });

describe('New world on OnlyWorlds', () => {
  it('a create keel refuses for its PIN keeps no PIN', async () => {
    const body = await create('9999');
    const error = body.querySelector<HTMLElement>('[data-role="error"]')!;
    await vi.waitFor(() => expect(error.hidden).toBe(false));
    expect(error.textContent).toMatch(/did not accept this PIN. Nothing was made/);
    expect(h.createPins).toEqual(['9999']);
    expect(getState().registry.pin).toBeUndefined();
  });

  it('a create that resolves keeps the PIN, and links the world', async () => {
    await create('1234');
    await vi.waitFor(() => expect(getState().registry.worlds[0]?.state).toBe('api-linked'));
    expect(getState().registry.pin).toBe('1234');
    // The create was a write keel took with that PIN: proved.
    expect(getState().registry.pin_state).toBe('proved');
  });

  it("a seat's secret kept as the PIN is never marked proved by a create that never sent it", async () => {
    patchSlice('registry', { ...getState().registry, pin: 'ow_s_seatsecretlong0001' });
    await create('ow_s_seatsecretlong0001');
    await vi.waitFor(() => expect(getState().registry.worlds[0]?.state).toBe('api-linked'));
    expect(getState().registry.pin_state).toBeUndefined();
  });
});
