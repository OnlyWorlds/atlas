/**
 * A pick that fails leaves the world the person was on as it was (1.125.9). A pick empties the element
 * list and the selection at once, so the switch feels instant; every way the pick can fail then puts the
 * prior world back: its list read again from its store, its selection, a store parked for the switch
 * taken back. Found on master: pick w2, refuse its folder's permission, and w1 showed 0 elements.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores, getActiveStore, takeParkedStore } from '../../src/core/active-store';

const refuse = new Set<string>();
const failOpen = new Set<string>();
const slow = new Set<string>();
const failMeta = new Set<string>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async (key: string) => ({ kind: 'directory', name: key }),
  ensureWritable: async (h: { name: string }) => { if (slow.has(h.name)) await sleep(15); return !refuse.has(h.name); },
  queryWritable: async (h: { name: string }) => !refuse.has(h.name),
  deleteHandle: async () => {},
}));

vi.mock('../../src/store/folder-store-fs', async (importActual) => {
  const actual = await importActual<typeof import('../../src/store/folder-store-fs')>();
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  class ParkingStore extends MockFolderStore {
    parked = false;
    async open(handle: unknown): Promise<void> {
      const name = (handle as { name?: string } | null)?.name ?? '';
      if (failOpen.has(name)) throw new Error('the open failed');
      this.handleName = name;
      await super.open(handle as never);
    }
    handleName = '';
    async readWorldMeta(opts?: { strict?: boolean }) {
      if (failMeta.has(this.handleName)) throw new Error('a read nothing expected to fail');
      return super.readWorldMeta(opts);
    }
    park(): void { this.parked = true; }
    async unpark(): Promise<boolean> { this.parked = false; return true; }
  }
  return { ...actual, FsFolderStore: ParkingStore };
});

import { activateWorld } from '../../src/sidebar/worlds-sidebar';

const toastStub = { error() {}, info() {}, success() {}, show() {}, problem() {} } as never;

function worldEntry(id: string, name: string) {
  return { id, name, state: 'local-only', folder: { handle_key: `k-${id}`, folder_name: `f-${id}` } } as never;
}

type Parking = { parked: boolean; createElement: (t: string, d: object) => Promise<{ id: string }>; listElements: () => Promise<unknown[]> };

/** w1 open with one Character selected, on its writing room. */
async function openW1(): Promise<{ store: Parking; adaId: string }> {
  expect(await activateWorld('w1', toastStub)).toBe(true);
  const store = getActiveStore() as unknown as Parking;
  const ada = await store.createElement('character', { name: 'Ada' });
  patchSlice('data', { ...getState().data, elements: await store.listElements() as never });
  patchSlice('ui', { ...getState().ui, selectedElementId: ada.id });
  window.location.hash = '#/w/w1/writing';
  return { store, adaId: ada.id };
}

function expectW1AsItWas(store: Parking, adaId: string): void {
  expect(getState().active?.worldId).toBe('w1');
  expect(getState().data.elements.map((e) => e.name)).toEqual(['Ada']);
  expect(getState().ui.selectedElementId).toBe(adaId);
  expect(window.location.hash).toBe('#/w/w1/writing');
  expect(getActiveStore()).toBe(store);
  expect(store.parked).toBe(false);
  expect(takeParkedStore('w1')).toBeNull();
}

beforeEach(() => {
  refuse.clear();
  failOpen.clear();
  failMeta.clear();
  slow.clear();
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('registry', {
    ...defaultRegistry(),
    worlds: [worldEntry('w1', 'World One'), worldEntry('w2', 'World Two')],
  });
  window.location.hash = '#/';
});

describe('a failed pick leaves the prior world as it was', () => {
  it('the picked folder\'s permission refused (before the prior store is parked)', async () => {
    const { store, adaId } = await openW1();
    refuse.add('k-w2');
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expectW1AsItWas(store, adaId);
  });

  it('the picked world\'s open fails (after the prior store is parked)', async () => {
    const { store, adaId } = await openW1();
    failOpen.add('k-w2');
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expectW1AsItWas(store, adaId);
  });

  it('a throw nothing catches, before the picked world takes its place', async () => {
    const { store, adaId } = await openW1();
    failMeta.add('k-w2');
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expectW1AsItWas(store, adaId);
  });

  it('a change of mind: the prior world picked again while the failing pick runs', async () => {
    const { store, adaId } = await openW1();
    refuse.add('k-w2');
    slow.add('k-w2');
    const p2 = activateWorld('w2', toastStub);
    await sleep(5); // inside w2's permission ask
    const p1 = activateWorld('w1', toastStub);
    expect(await p2).toBe(false);
    expect(await p1).toBe(true);
    expect(getState().data.elements.map((e) => e.name)).toEqual(['Ada']);
    expect(getState().active?.worldId).toBe('w1');
    expect(getActiveStore()).toBe(store);
    expect(store.parked).toBe(false);
    void adaId;
  });

  it('a pick that succeeds still opens the new world empty of the old one', async () => {
    await openW1();
    expect(await activateWorld('w2', toastStub)).toBe(true);
    expect(getState().active?.worldId).toBe('w2');
    expect(getState().data.elements).toEqual([]);
    expect(getState().ui.selectedElementId).toBeNull();
  });
});
