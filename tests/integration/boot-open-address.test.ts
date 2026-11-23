/**
 * The boot's open of the world in the address (1.125.8): when it finishes it
 * navigates only if the address is still the one it started from; a person
 * who moved meanwhile stays where they went. The open is held by its folder
 * permission, which the boot only queries, or by what runs before it on the
 * activation chain, as the boot's reconciliation does.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores } from '../../src/core/active-store';
import { enqueueActivationTask } from '../../src/core/activation-chain';
import { settingsHash } from '../../src/core/router';

const gate = vi.hoisted(() => ({ asked: 0, wait: null as null | Promise<boolean> }));

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async () => ({ kind: 'directory', name: 'fake' }),
  ensureWritable: async () => true,
  queryWritable: async () => { gate.asked++; return gate.wait ?? true; },
  deleteHandle: async () => {},
}));

vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  class ParkingStore extends MockFolderStore {
    park(): void {}
    async unpark(): Promise<boolean> { return true; }
  }
  class ELockHeld extends Error {}
  return { FsFolderStore: ParkingStore, ELockHeld };
});

import { activateWorld } from '../../src/sidebar/worlds-sidebar';

const toasts = { error() {}, info() {}, success() {}, show() {}, dismiss() {}, problem() {} } as never;
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));

function worldEntry(id: string, name: string) {
  return { id, name, state: 'local-only', folder: { handle_key: `k-${id}`, folder_name: `f-${id}` } } as never;
}

/** As `tryAutoActivateFromUrl` in `src/app.ts` asks for it. */
const bootOpen = (id: string) => activateWorld(id, toasts, { silent: true, preserveSelection: true, permissionMode: 'query', sayLockHeld: true });

/** The boot's open of w1 from `hash`, under way and held until the returned `finish`. */
async function heldBoot(hash: string): Promise<{ finish: () => Promise<boolean> }> {
  window.location.hash = hash;
  await tick();
  let grant: (ok: boolean) => void = () => {};
  gate.wait = new Promise<boolean>(r => { grant = r; });
  const open = bootOpen('w1');
  await vi.waitFor(() => expect(gate.asked).toBe(1));
  expect(getState().active).toBeNull();
  return {
    finish: async () => {
      grant(true);
      const ok = await open;
      await tick();
      return ok;
    },
  };
}

beforeEach(() => {
  gate.asked = 0;
  gate.wait = null;
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('registry', { ...defaultRegistry(), worlds: [worldEntry('w1', 'World One'), worldEntry('w2', 'World Two')] });
  window.location.hash = '#/';
});

describe('the boot\'s open, the person moved meanwhile', () => {
  it('Settings pressed (the gear, with no world open yet): the address stays Settings', async () => {
    const boot = await heldBoot('#/w/w1');
    window.location.hash = settingsHash(getState().active?.worldId ?? null);
    expect(await boot.finish()).toBe(true);
    expect(getState().active?.worldId).toBe('w1');
    expect(window.location.hash).toBe('#/settings');
  });

  it('Settings pressed while the open still waits its turn on the chain: the same', async () => {
    window.location.hash = '#/w/w1';
    let settle: () => void = () => {};
    void enqueueActivationTask(() => new Promise<void>(r => { settle = r; }));
    await tick();
    const open = bootOpen('w1');
    window.location.hash = '#/settings';
    settle();
    expect(await open).toBe(true);
    await tick();
    expect(window.location.hash).toBe('#/settings');
  });

  it('the Data room with no world: the address stays its own, for the shell to hand to the open world', async () => {
    const boot = await heldBoot('#/w/w1');
    window.location.hash = '#/import';
    expect(await boot.finish()).toBe(true);
    expect(window.location.hash).toBe('#/import');
  });

  it('another room of the same world: the address stays that room, and nothing fires on it', async () => {
    const boot = await heldBoot('#/w/w1');
    window.location.hash = '#/w/w1/knowledge';
    await tick();
    let fired = 0;
    const count = () => { fired++; };
    window.addEventListener('hashchange', count);
    expect(await boot.finish()).toBe(true);
    window.removeEventListener('hashchange', count);
    expect(window.location.hash).toBe('#/w/w1/knowledge');
    expect(fired).toBe(0);
  });

  it('Back, to a place with no world: the address stays where Back led, with no entry added', async () => {
    window.location.hash = '#/settings/general';
    await tick();
    const boot = await heldBoot('#/w/w1');
    history.back();
    await vi.waitFor(() => expect(window.location.hash).toBe('#/settings/general'));
    const entries = history.length;
    expect(await boot.finish()).toBe(true);
    expect(getState().active?.worldId).toBe('w1');
    expect(window.location.hash).toBe('#/settings/general');
    expect(history.length).toBe(entries);
  });

  // As Back does at any other moment: Atlas opens no world on Back.
  it('Back, to another world\'s address: the address stays where Back led', async () => {
    window.location.hash = '#/w/w2/timeline';
    await tick();
    const boot = await heldBoot('#/w/w1');
    history.back();
    await vi.waitFor(() => expect(window.location.hash).toBe('#/w/w2/timeline'));
    expect(await boot.finish()).toBe(true);
    expect(getState().active?.worldId).toBe('w1');
    expect(window.location.hash).toBe('#/w/w2/timeline');
  });
});

describe('the boot\'s open, nothing pressed: as before', () => {
  for (const hash of ['#/w/w1', '#/w/w1/element/e1', '#/w/w1/settings/world']) {
    it(`${hash} stays, announced once more, with no entry added`, async () => {
      const boot = await heldBoot(hash);
      const entries = history.length;
      const seen: string[] = [];
      const on = () => { seen.push(window.location.hash); };
      window.addEventListener('hashchange', on);
      expect(await boot.finish()).toBe(true);
      window.removeEventListener('hashchange', on);
      expect(getState().active?.worldId).toBe('w1');
      expect(window.location.hash).toBe(hash);
      expect(seen).toEqual([hash]);
      expect(history.length).toBe(entries);
    });
  }

  it('moved and back at the start again counts as not moved', async () => {
    const boot = await heldBoot('#/w/w1/writing');
    window.location.hash = '#/settings';
    window.location.hash = '#/w/w1/writing';
    await tick();
    let fired = 0;
    const count = () => { fired++; };
    window.addEventListener('hashchange', count);
    expect(await boot.finish()).toBe(true);
    window.removeEventListener('hashchange', count);
    expect(window.location.hash).toBe('#/w/w1/writing');
    expect(fired).toBe(1);
  });
});
