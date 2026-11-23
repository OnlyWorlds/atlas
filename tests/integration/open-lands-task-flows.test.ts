/**
 * The flows that open a world as one task end where the person is (1.125.8,
 * conv. 195): Download a world, View a shared world, a join link, Start a
 * world and import as a new world, each driven through its own dialog or
 * room with the long call held (an account world and Bring it down again have
 * theirs in `tests/integration/account-worlds.test.ts` and
 * `tests/integration/open-lands-where-you-are.test.ts`).
 *
 * For each: nothing pressed, the flow's own landing; the address moved while
 * the task ran, the place read onto the world it opened. And a world picked
 * while the task ran: when the task's world is still the one open, the place
 * is read onto it (so the queued pick starts from an address naming the
 * world on screen). A pick that took the screen first is the restore's case
 * in `tests/integration/open-lands-where-you-are.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores } from '../../src/core/active-store';

// Each held call: `held.release` lands it; the flow's world becomes the open one as the real call makes it.
const held = vi.hoisted(() => ({ release: null as null | (() => void), calls: 0, alreadyHere: false }));
function holdThen<T>(worldId: string, value: T): Promise<T> {
  held.calls++;
  return new Promise<T>((res) => {
    held.release = () => {
      // What every one of these calls does at its end: its world is the open one.
      patchSlice('active', { worldId, meta: { id: worldId, name: worldId }, opened: true } as never);
      res(value);
    };
  });
}

vi.mock('../../src/ui/where-choice', () => ({
  whereChoiceHtml: () => '',
  wireWhereChoice: () => {},
  lockWhereChoice: () => {},
  takeWhereInClick: () => 'browser',
  readyWhere: async () => true,
  askWhere: async () => 'browser',
}));

vi.mock('../../src/setup/atlas-root-flow', async (orig) => {
  const real = await orig<typeof import('../../src/setup/atlas-root-flow')>();
  return {
    ...real,
    linkExistingApiWorldInRoot: () => holdThen('wl', { entry: { id: 'wl', name: 'Linked', api: {} }, downloaded: 0, failures: [] }),
    createWorldInRoot: () => holdThen('wn', { entry: { id: 'wn', name: 'Made' } }),
    createWorldFromImportedData: () => holdThen('wi', { entry: { id: 'wi', name: 'Imported' }, applied: { created: 1, updated: 0, failures: [] } }),
  };
});

vi.mock('../../src/setup/join-door', async (orig) => {
  const real = await orig<typeof import('../../src/setup/join-door')>();
  return {
    ...real,
    redeemJoin: async () => ({ world: { id: 'srv-j', name: 'Joined' }, role: 'contributor', key: 'ow_w_k', secret: 's' }),
    openJoinedWorld: () => held.alreadyHere
      ? holdThen('wj', { kind: 'already-here', entry: { id: 'wj', name: 'Joined' }, sameSeat: true })
      : holdThen('wj', { kind: 'downloaded', result: { entry: { id: 'wj', name: 'Joined' }, downloaded: 0, failures: [] } }),
  };
});

import { activateWorld } from '../../src/sidebar/worlds-sidebar';
import { LinkWorldModal } from '../../src/ui/link-world-modal';
import { ViewWorldModal } from '../../src/ui/view-world-modal';
import { CreateWorldModal } from '../../src/ui/create-world-modal';
import { JoinWorldModal } from '../../src/ui/join-world-modal';
import { mountImportRoom } from '../../src/middle/import-room';
import type { ToastManager } from '../../src/ui/toast-manager';

const toasts = { success() {}, error() {}, info() {}, warning() {}, show() {}, dismiss() {}, problem() {} } as unknown as ToastManager;
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));

function submit(form: HTMLFormElement): void {
  form.dispatchEvent(new Event('submit', { cancelable: true }));
}

/** Each flow, started from the open world `w1`; it resolves once the long call is held. */
const FLOWS: Array<{ name: string; world: string; landing: (w: string) => string; start: () => Promise<void> }> = [
  {
    name: 'Download a world', world: 'wl', landing: w => `#/w/${w}`,
    start: async () => {
      new LinkWorldModal(toasts).open();
      const form = document.querySelector<HTMLFormElement>('.atlas-modal-overlay form')!;
      form.querySelector<HTMLInputElement>('input[name="api-key"]')!.value = 'ow_r_k';
      submit(form);
    },
  },
  {
    name: 'View a shared world', world: 'wl', landing: w => `#/w/${w}`,
    start: async () => {
      new ViewWorldModal(toasts).open();
      const form = document.querySelector<HTMLFormElement>('.atlas-modal-overlay form')!;
      form.querySelector<HTMLInputElement>('input[name="api-key"]')!.value = 'ow_r_k';
      submit(form);
    },
  },
  {
    name: 'Start a world', world: 'wn', landing: w => `#/w/${w}`,
    start: async () => {
      new CreateWorldModal(toasts).open();
      const form = document.querySelector<HTMLFormElement>('.atlas-modal-overlay form')!;
      form.querySelector<HTMLInputElement>('input[name="world-name"]')!.value = 'Made';
      submit(form);
    },
  },
  {
    name: 'A join link', world: 'wj', landing: w => `#/w/${w}`,
    start: async () => {
      new JoinWorldModal(toasts, 'CODE', {
        reader: 'agent', world: { name: 'Joined', description: '' }, invitedBy: null, ownerCharacter: null,
        role: 'contributor', withCharacter: false, expiresAt: '2099-01-01T00:00:00Z',
      }).open();
      submit(document.querySelector<HTMLFormElement>('form[data-form="join-world"]')!);
    },
  },
  {
    name: 'A join link to a world already here and open', world: 'wj', landing: w => `#/w/${w}`,
    start: async () => {
      held.alreadyHere = true;
      await FLOWS.find(f => f.name === 'A join link')!.start();
    },
  },
  {
    name: 'Import as a new world (the Data room)', world: 'wi', landing: w => `#/w/${w}/import`,
    start: async () => {
      window.location.hash = '#/w/w1/import';
      const target = document.createElement('div');
      document.body.appendChild(target);
      mountImportRoom(target, toasts);
      target.querySelector<HTMLTextAreaElement>('[data-role="paste"]')!.value = JSON.stringify({ Character: [{ name: 'Ada' }] });
      target.querySelector<HTMLButtonElement>('[data-action="load"]')!.click();
      await vi.waitFor(() => expect(target.querySelector('[data-action="import"]')).not.toBeNull());
      const asNew = target.querySelector<HTMLInputElement>('input[name="imp-mode"][value="new"]');
      if (asNew && !asNew.checked) { asNew.checked = true; asNew.dispatchEvent(new Event('change')); }
      target.querySelector<HTMLButtonElement>('[data-action="import"]')!.click();
    },
  },
];

beforeEach(() => {
  held.release = null;
  held.calls = 0;
  held.alreadyHere = false;
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('data', { elements: [] });
  patchSlice('registry', defaultRegistry());
  // The person is on w1 (no store is needed: none of these flows reads it before its held call).
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'World One' }, opened: true } as never);
  window.location.hash = '#/w/w1/writing';
});

afterEach(() => { document.body.innerHTML = ''; });

async function startHeld(flow: (typeof FLOWS)[number]): Promise<void> {
  // The Data room's own address is where it starts.
  await flow.start();
  await vi.waitFor(() => expect(held.calls).toBe(1));
  await vi.waitFor(() => expect(held.release).not.toBeNull());
}

async function landed(): Promise<void> {
  await tick(10);
}

for (const flow of FLOWS) {
  describe(flow.name, () => {
    it('nothing pressed: its own landing, as before', async () => {
      await startHeld(flow);
      held.release!();
      await vi.waitFor(() => expect(window.location.hash).toBe(flow.landing(flow.world)));
    });

    it('the address moved while it ran: the place, read onto the world it opened', async () => {
      await startHeld(flow);
      window.location.hash = '#/w/w1/share';
      held.release!();
      await landed();
      await vi.waitFor(() => expect(window.location.hash).toBe(`#/w/${flow.world}/share`));
    });

    it('a world picked while it ran, its world still the open one: the place is read onto that world', async () => {
      await startHeld(flow);
      const room = window.location.hash.replace('#/w/w1', '');
      // A world this list does not hold: the pick is asked for, and opens nothing.
      const pick = activateWorld('gone', toasts);
      held.release!();
      expect(await pick).toBe(false);
      await landed();
      expect(getState().active?.worldId).toBe(flow.world);
      expect(window.location.hash).toBe(`#/w/${flow.world}${room}`);
    });
  });
}
