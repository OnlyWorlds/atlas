/**
 * Writing setup asks for a push only when it wrote into elements (1.125.0): the label renames and the
 * promotes both count, so a re-setup that renames labels and promotes nothing still sends its renamed
 * narratives; a setup that wrote nothing asks for nothing (and says no first change of a world waiting on
 * the World PIN).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

const pushes = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../src/sync/sync-attach', async (orig) => ({
  ...(await orig<typeof import('../../src/sync/sync-attach')>()),
  requestPushIfLinked: () => { pushes.n++; },
}));

import { getState, patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';
import { mountWritingSetup } from '../../src/middle/writing-setup';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const WORLD = 'w-setup';
const toasts = { info() {}, error() {}, success() {}, warning() {} } as unknown as ToastManager;

async function openWorld(): Promise<MockFolderStore> {
  const entry = {
    id: WORLD, name: 'Tiers', state: 'api-linked', api: { world_id: 's1', api_key: 'ow_w_k' },
    writing_initialized: true, writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Beat' },
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), pin: '1234', worlds: [entry] });
  patchSlice('active', { worldId: WORLD, meta: { name: 'Tiers' } } as never);
  const store = new MockFolderStore();
  await store.open(null);
  await store.createElement('narrative', { name: 'One', supertype: 'Book' } as never);
  setActiveStore(store as never);
  patchSlice('data', { elements: await store.listElements() } as never);
  return store;
}

async function saveWith(l1: string): Promise<void> {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mountWritingSetup(target, toasts, () => {});
  const input = target.querySelector<HTMLInputElement>('[data-label-key="l1"]')!;
  input.value = l1;
  input.dispatchEvent(new Event('input'));
  const promote = target.querySelector<HTMLInputElement>('[data-role="promote-toggle"]');
  if (promote) { promote.checked = false; promote.dispatchEvent(new Event('change')); }
  target.querySelector<HTMLButtonElement>('[data-action="save"]')!.click();
  await vi.waitFor(() => expect(getState().registry.worlds[0].writing_labels?.l1).toBe(l1));
  await new Promise(r => setTimeout(r, 20));
}

afterEach(() => {
  pushes.n = 0;
  document.body.innerHTML = '';
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
});

describe('writing setup and the push', () => {
  it('a label rename that writes narratives asks for a push, with nothing promoted', async () => {
    const store = await openWorld();
    await saveWith('Tome');
    expect((await store.listElements()).map(e => (e as { supertype?: string }).supertype)).toEqual(['Tome']);
    expect(pushes.n).toBe(1);
  });

  it('a setup that wrote nothing asks for nothing', async () => {
    await openWorld();
    await saveWith('Book');
    expect(pushes.n).toBe(0);
  });
});
