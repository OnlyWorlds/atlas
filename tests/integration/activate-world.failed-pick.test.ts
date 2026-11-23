/**
 * A pick that fails leaves the world the person was on as it was (1.125.9). A pick empties the element
 * list, the selection, the lenses and the world's styles at once, so the switch feels instant; every way
 * the pick can fail then puts the prior world back: its list and styles read again from its own store, its
 * selection and lenses, a store parked for the switch taken back. Found on master: pick w2, refuse its
 * folder's permission, and w1 showed 0 elements until the page was reloaded. Once the picked world's store
 * has taken the prior one's place, a later throw leaves the person in the picked world.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { EMPTY_STYLES } from '../../src/core/world-styles';
import { setActiveStore, clearParkedStores, getActiveStore, takeParkedStore } from '../../src/core/active-store';

const refuse = new Set<string>();
const failOpen = new Set<string>();
const lockHeld = new Set<string>();
const slow = new Set<string>();
const failMeta = new Set<string>();
const flags = { throwAttach: false, unparkRefused: false };
const opened: Array<{ handleName: string; closed: boolean }> = [];
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
    closed = false;
    handleName = '';
    constructor(private readonly o: { forceTakeLock?: boolean } = {}) { super(); }
    async open(handle: unknown): Promise<void> {
      const name = (handle as { name?: string } | null)?.name ?? '';
      if (failOpen.has(name)) throw new Error('the open failed');
      if (lockHeld.has(name) && !this.o.forceTakeLock) {
        throw new actual.ELockHeld({ tab_id: 'other', last_heartbeat: new Date().toISOString() } as never);
      }
      this.handleName = name;
      opened.push(this);
      await super.open(handle as never);
    }
    async close(): Promise<void> { this.closed = true; await super.close(); }
    async readWorldMeta(opts?: { strict?: boolean }) {
      if (failMeta.has(this.handleName)) throw new Error('a read nothing expected to fail');
      return super.readWorldMeta(opts);
    }
    park(): void { this.parked = true; }
    async unpark(): Promise<boolean> {
      if (flags.unparkRefused) return false;
      this.parked = false;
      return true;
    }
  }
  return { ...actual, FsFolderStore: ParkingStore };
});

vi.mock('../../src/sync/sync-attach', async (importActual) => {
  const actual = await importActual<typeof import('../../src/sync/sync-attach')>();
  return {
    ...actual,
    attachSyncEngine: (...args: Parameters<typeof actual.attachSyncEngine>) => {
      if (flags.throwAttach) throw new Error('a step after the picked world took its place');
      return actual.attachSyncEngine(...args);
    },
  };
});

import { activateWorld } from '../../src/sidebar/worlds-sidebar';

const toastStub = { error() {}, info() {}, success() {}, show() {}, problem() {} } as never;

function worldEntry(id: string, name: string) {
  return { id, name, state: 'local-only', folder: { handle_key: `k-${id}`, folder_name: `f-${id}` } } as never;
}

type Parking = {
  parked: boolean;
  closed: boolean;
  createElement: (t: string, d: object) => Promise<{ id: string }>;
  listElements: () => Promise<unknown[]>;
  writeStyles: (s: object) => Promise<void>;
};

const W1_STYLES = { ...EMPTY_STYLES, rules: [{ type: 'location', color: '#3b82f6' }] };

/** w1 open with one Character selected, a style rule and lenses of its own, on its writing room. */
async function openW1(): Promise<{ store: Parking; adaId: string }> {
  expect(await activateWorld('w1', toastStub)).toBe(true);
  const store = getActiveStore() as unknown as Parking;
  const ada = await store.createElement('character', { name: 'Ada' });
  await store.writeStyles(W1_STYLES);
  patchSlice('styles', W1_STYLES as never);
  patchSlice('data', { ...getState().data, elements: await store.listElements() as never });
  patchSlice('ui', { ...getState().ui, selectedElementId: ada.id, mutedTypes: ['location'] as never, hideRoom: false });
  window.location.hash = '#/w/w1/writing';
  return { store, adaId: ada.id };
}

function expectW1AsItWas(store: Parking, adaId: string): void {
  expect(getState().active?.worldId).toBe('w1');
  expect(getState().data.elements.map((e) => e.name)).toEqual(['Ada']);
  expect(getState().ui.selectedElementId).toBe(adaId);
  expect(getState().ui.mutedTypes).toEqual(['location']);
  expect(getState().ui.hideRoom).toBe(false);
  expect(getState().styles).toEqual(W1_STYLES);
  expect(window.location.hash).toBe('#/w/w1/writing');
  expect(getActiveStore()).toBe(store);
  expect(store.parked).toBe(false);
  expect(takeParkedStore('w1')).toBeNull();
}

beforeEach(() => {
  for (const s of [refuse, failOpen, lockHeld, slow, failMeta]) s.clear();
  flags.throwAttach = false;
  flags.unparkRefused = false;
  opened.length = 0;
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

afterEach(() => { vi.restoreAllMocks(); });

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

  it('the picked world is open in another tab and the take-over is declined', async () => {
    const { store, adaId } = await openW1();
    lockHeld.add('k-w2');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expectW1AsItWas(store, adaId);
  });

  it('a throw nothing catches, before the picked world takes its place: its store is closed too', async () => {
    const { store, adaId } = await openW1();
    failMeta.add('k-w2');
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expectW1AsItWas(store, adaId);
    const w2 = opened.find((s) => s.handleName === 'k-w2');
    expect(w2?.closed).toBe(true);
  });

  it('a throw after the picked world took its place leaves the person there', async () => {
    const { store } = await openW1();
    flags.throwAttach = true;
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expect(getState().active?.worldId).toBe('w2');
    expect(getActiveStore()).not.toBe(store);
    expect(window.location.hash).toBe('#/w/w2/writing');
    // The picked world's store is the active one now: it stays open.
    expect(opened.find((s) => s.handleName === 'k-w2')?.closed).toBe(false);
  });

  it('a pick from the first screen with nothing open: a failure goes back there, a later throw stays', async () => {
    failOpen.add('k-w2');
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expect(window.location.hash).toBe('#/');
    expect(getActiveStore()).toBeNull();
    failOpen.clear();
    failMeta.add('k-w2');
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expect(window.location.hash).toBe('#/');
    expect(opened.find((s) => s.handleName === 'k-w2')?.closed).toBe(true);
    failMeta.clear();
    flags.throwAttach = true;
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expect(getState().active?.worldId).toBe('w2');
    expect(window.location.hash).toMatch(/^#\/w\/w2/);
  });

  it('a take-over accepted, then a throw before its store takes the place: that store is closed', async () => {
    const { store, adaId } = await openW1();
    lockHeld.add('k-w2');
    failMeta.add('k-w2');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    expect(await activateWorld('w2', toastStub)).toBe(false);
    expectW1AsItWas(store, adaId);
    expect(opened.filter((s) => s.handleName === 'k-w2').map((s) => s.closed)).toEqual([true]);
  });

  it('the prior world taken by another tab meanwhile is closed here and says so; a click opens it the ordinary way', async () => {
    const { store } = await openW1();
    failOpen.add('k-w2');
    flags.unparkRefused = true;
    const said: string[] = [];
    const toasts = { ...(toastStub as object), show: (line: string) => { said.push(line); } } as never;
    expect(await activateWorld('w2', toasts)).toBe(false);
    // Nothing here holds it open: no store an edit could write through into the other tab's files.
    expect(getActiveStore()).toBeNull();
    expect(getState().active).toBeNull();
    expect(window.location.hash).toBe('#/');
    expect(getState().data.elements).toEqual([]);
    expect(said).toContain('"World One" was closed here: another Atlas tab may have it open now. Open it again to take it back.');
    // Closed here, not parked: nothing keeps a handle into the other tab's folder.
    expect(store.closed).toBe(true);
    expect(takeParkedStore('w1')).toBeNull();
    // A click on it takes the ordinary path, not the already-open shortcut: a cold open meets the other tab's
    // lock, so the take-over is asked.
    lockHeld.add('k-w1');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    expect(await activateWorld('w1', toastStub)).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(store.closed).toBe(true);
    expect(takeParkedStore('w1')).toBeNull();
    expect(getActiveStore()).toBeNull();
    // Taken back: a fresh store, this tab's.
    confirm.mockReturnValue(true);
    expect(await activateWorld('w1', toastStub)).toBe(true);
    expect(getState().active?.worldId).toBe('w1');
    expect(getActiveStore()).not.toBe(store);
  });

  it('a change of mind: the prior world picked again while the failing pick runs', async () => {
    const { store } = await openW1();
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
  });

  it('a pick that succeeds still opens the new world empty of the old one', async () => {
    await openW1();
    expect(await activateWorld('w2', toastStub)).toBe(true);
    expect(getState().active?.worldId).toBe('w2');
    expect(getState().data.elements).toEqual([]);
    expect(getState().ui.selectedElementId).toBeNull();
  });
});
