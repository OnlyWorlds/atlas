/**
 * Keep the tour world (1.17, contract §7, lane K, lens A A4/A5): the
 * tri-state read of the tour world's own directory, and the keep kernel
 * (K2 un-demo, K3 re-key, K4 commit) on the real code with a mock store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';

const activations: string[] = [];
const activationOpts: unknown[] = [];
let activationOpens = false;
vi.mock('../../src/sidebar/worlds-sidebar', () => ({
  // Activation is the app's whole open path; these tests decide only whether it opened.
  activateWorld: async (id: string, _t: unknown, opts?: unknown) => { activations.push(id); activationOpts.push(opts); return activationOpens; },
}));
const toasts: string[] = [];
vi.mock('../../src/ui/toast-manager', () => {
  const t = { success: (m: string) => toasts.push(`success:${m}`), info: (m: string) => toasts.push(`info:${m}`), error: (m: string) => toasts.push(`error:${m}`), warning: (m: string) => toasts.push(`warning:${m}`), problem: (p: { sentence: string }) => toasts.push(`problem:${p.sentence}`) };
  return { toastManager: t, ToastManager: class {} };
});

import { getState, patchSlice, setState } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { exitTour, pickTourEntry, readTourState, resumeTour, tourFolderState } from '../../src/tour/tour-engine';
import { keepTourWorldNow } from '../../src/tour/tour-keep';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const dirWith = (worldJson: string | null): FileSystemDirectoryHandle => {
  const d = new FakeDirHandle('w');
  if (worldJson !== null) d.put('world.json', worldJson);
  return d as unknown as FileSystemDirectoryHandle;
};

describe('tourFolderState (contract §7.2)', () => {
  it('reads tour, kept and unknown from world.json alone', async () => {
    expect(await tourFolderState(dirWith(j({ id: 'w', name: 'H', demo: true })))).toBe('tour');
    expect(await tourFolderState(dirWith(null))).toBe('tour'); // the scaffold had not written it yet
    expect(await tourFolderState(dirWith(j({ id: 'w', name: 'H' })))).toBe('kept');
    expect(await tourFolderState(dirWith(j({ id: 'w', name: 'H', demo: false })))).toBe('kept');
    expect(await tourFolderState(dirWith(''))).toBe('unknown'); // a crash inside the write (lens A M5)
    expect(await tourFolderState(dirWith('{ not json'))).toBe('unknown');
    expect(await tourFolderState(dirWith('null'))).toBe('unknown');
  });
});

describe('pickTourEntry with the rollback\'s own id (lens A A4)', () => {
  it('a known id wins over an older stranded demo world', () => {
    const e = (id: string): WorldRegistryEntry => ({
      id, name: 'Hyperion', state: 'local-only', demo: true, where: 'browser',
      folder: { handle_key: `world-${id}`, folder_name: `hyperion-${id}` }, created_at: 'x',
    } as WorldRegistryEntry);
    expect(pickTourEntry([e('old'), e('new')], 'new')?.id).toBe('new');
  });
});

// The bundle's own ids (src/demo/hyperion-world.json): the live demo world's.
const CONSUL = '068e2ddb-83c6-71a7-8000-a45b8b711e25';
const MAP = '2d277ba6-22e4-440b-9ef3-7f28153cd291';
const W = 'tour-reg';
const FOLDER = 'hyperion-t1aaaaaa-0001';
const MINE = '99999999-9999-4999-8999-999999999999';

let store: MockFolderStore;
let opfs: FakeDirHandle;
let tourEntry: WorldRegistryEntry;

async function setUpFinale(worldJson: Record<string, unknown> = { id: 'wid', name: 'Hyperion', demo: true }): Promise<void> {
  localStorage.clear();
  activations.length = 0;
  activationOpts.length = 0;
  toasts.length = 0;
  activationOpens = false;
  opfs = new FakeDirHandle('opfs');
  opfs.put(`${BROWSER_HOME}/${FOLDER}/world.json`, j(worldJson));
  setOpfsRootForTests(async () => opfs as unknown as FileSystemDirectoryHandle);
  store = new MockFolderStore();
  store.setClock(new MonotonicClock('2026-03-01T00:00:00.000Z').next);
  await store.open(null);
  await store.writeWorldMeta(worldJson);
  await store.createElement('map', { id: MAP, name: 'Map of Unnamed planet' } as Partial<Element>);
  await store.createElement('character', { id: CONSUL, name: 'The Consul' } as Partial<Element>);
  // Something the user made in the tour world, linking to a bundle element.
  await store.createElement('character', { id: MINE, name: 'Mine', friends: [CONSUL] } as Partial<Element>);
  tourEntry = {
    id: W, name: 'Hyperion', state: 'local-only', demo: true, where: 'browser',
    folder: { handle_key: `world-${W}`, folder_name: FOLDER }, created_at: 'x',
  } as WorldRegistryEntry;
  const reg = { ...defaultRegistry(), worlds: [tourEntry] };
  localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  patchSlice('registry', reg);
  localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true, step: 16, worldId: W }));
  setActiveStore(store as never);
  patchSlice('active', { worldId: W, meta: await store.readWorldMeta(), opened: true } as never);
  const cur = getState();
  setState({ ...cur, data: { ...cur.data, elements: await store.listElements() }, ui: { ...cur.ui, zoneEditing: null } });
  window.location.hash = `#/w/${W}/element/${CONSUL}`;
}

afterEach(() => {
  setOpfsRootForTests(null);
  setActiveStore(null);
  document.querySelectorAll('.atlas-zone-editing').forEach(n => n.remove());
});

describe('the keep (contract §7.3, invariants 15-16)', () => {
  beforeEach(() => setUpFinale());

  it('un-demos world.json and the registry, gives every bundle element a new id, and ends the tour', async () => {
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('kept');
    const ids = (await store.listElements()).map(e => e.id);
    expect(ids).not.toContain(CONSUL);
    expect(ids).not.toContain(MAP);
    expect(ids).toContain(MINE); // the user's own element keeps its id
    const newConsul = (await store.listElements()).find(e => e.name === 'The Consul')!.id;
    expect((await store.getElement(MINE) as unknown as { friends: string[] }).friends).toEqual([newConsul]);
    expect((await store.readWorldMeta()).demo).toBeUndefined();
    expect(getState().active?.meta?.demo).toBeUndefined();
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    expect(reg.worlds[0].demo).toBeUndefined();
    expect(getState().registry.worlds[0].demo).toBeUndefined();
    expect(readTourState()).toBeNull();
    expect(localStorage.getItem('atlas_tour_done_v1')).toBe('1');
    expect(toasts).toContain('success:Hyperion is yours now. It lives in this browser.');
  });

  it('a refused re-key stops before the commit: the registry stays demo and the tour stays', async () => {
    const edit = document.createElement('div');
    edit.className = 'atlas-zone-editing';
    document.body.appendChild(edit);
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('refused');
    expect((await store.readWorldMeta()).demo).toBe(true); // refused before K2: nothing written
    expect(getState().registry.worlds[0].demo).toBe(true);
    expect(readTourState()?.worldId).toBe(W);
    expect(localStorage.getItem('atlas_tour_done_v1')).toBeNull();
    expect((await store.listElements()).map(e => e.id)).toContain(CONSUL);
  });

  it('a second run after a re-key interrupted by a crash finishes it and moves the rest (K3 is resumable)', async () => {
    const { startRekey } = await import('../../src/store/rekey');
    await store.writeWorldMeta({ demo: undefined });
    // The crash: the run dies after its first write, the journal on disk.
    await expect(startRekey(store, { worldId: W, ids: [CONSUL, MAP] }, {
      onProgress: (done) => { if (done === 1) throw new Error('tab closed'); },
    })).rejects.toThrow();
    expect(await store.hasRekeyJournal()).toBe(true);
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('kept');
    const ids = (await store.listElements()).map(e => e.id);
    expect(ids).not.toContain(CONSUL);
    expect(ids).not.toContain(MAP);
    expect(ids.filter(id => id !== MINE)).toHaveLength(2); // no twins
    expect(await store.hasRekeyJournal()).toBe(false);
  });

  it('a re-key that fails before moving anything undoes K2: the tour world is the sandbox again (S375 gate K2)', async () => {
    store.writeRekeyJournal = async () => { throw new Error('disk said no'); };
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('refused');
    expect((await store.readWorldMeta()).demo).toBe(true);
    expect(getState().active?.meta?.demo).toBe(true);
    expect(getState().registry.worlds[0].demo).toBe(true);
    expect(readTourState()?.worldId).toBe(W);
    expect((await store.listElements()).map(e => e.id)).toContain(CONSUL);
  });

  it('a re-key that stops halfway (its journal on disk) stays begun, and no step writes into it (S375 gate K1, K2)', async () => {
    let made = 0;
    const real = store.createElementVerbatim.bind(store);
    store.createElementVerbatim = (async (...a: Parameters<typeof real>) => {
      if (++made === 2) throw new Error('tab closed');
      return real(...a);
    }) as typeof real;
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('refused');
    expect(await store.hasRekeyJournal()).toBe(true);
    expect((await store.readWorldMeta()).demo).toBeUndefined(); // begun: the next keep, resume or teardown finishes it
    const { tourWorldIsActive, enterStep } = await import('../../src/tour/tour-engine');
    expect(tourWorldIsActive()).toBe(false);
    const before = (await store.listElements()).map(e => e.id).sort();
    await enterStep(16);
    expect((await store.listElements()).map(e => e.id).sort()).toEqual(before);
    store.createElementVerbatim = real;
    expect((await keepTourWorldNow(W)).kind).toBe('kept');
    const ids = (await store.listElements()).map(e => e.id);
    expect(ids).not.toContain(CONSUL);
    expect(ids).toHaveLength(3); // no twins
  });

  it('a failure after the re-key finished goes on to the commit (S375 gate K2)', async () => {
    const realClear = store.clearRekeyJournal.bind(store);
    const realList = store.listElements.bind(store);
    let armed = false;
    store.clearRekeyJournal = async () => { await realClear(); armed = true; };
    store.listElements = (async (...a: Parameters<typeof realList>) => {
      if (armed) { armed = false; throw new Error('the screen pass failed'); }
      return realList(...a);
    }) as typeof realList;
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('kept');
    expect(getState().registry.worlds[0].demo).toBeUndefined();
    expect(readTourState()).toBeNull();
    expect((await realList()).map(e => e.id)).not.toContain(CONSUL);
  });

  it('resume after a crash inside K3 (every id already moved) and a throw in the empty K3: the keep commits, K2 is never undone (S376 lens A A1)', async () => {
    // Boot's activation finished the journal: world.json kept, no bundle id left.
    await setUpFinale({ id: 'wid', name: 'Hyperion' });
    await store.deleteElement(CONSUL, { silent: true } as never);
    await store.deleteElement(MAP, { silent: true } as never);
    await store.createElement('character', { id: '11111111-1111-4111-8111-111111111111', name: 'The Consul' } as Partial<Element>);
    const realHas = store.hasRekeyJournal.bind(store);
    let first = true;
    store.hasRekeyJournal = async () => {
      if (first) { first = false; throw Object.assign(new Error('read failed'), { name: 'NotReadableError' }); }
      return realHas();
    };
    const out = await keepTourWorldNow(W);
    expect((await store.readWorldMeta()).demo).toBeUndefined();
    expect(getState().active?.meta?.demo).toBeUndefined();
    expect(out.kind).toBe('kept');
    expect(getState().registry.worlds[0].demo).toBeUndefined();
    const { enterStep } = await import('../../src/tour/tour-engine');
    const before = (await store.listElements()).map(e => e.id).sort();
    await enterStep(16);
    expect((await store.listElements()).map(e => e.id).sort()).toEqual(before);
  });

  it('a throw in K3 on a world this call did not un-demo never writes demo back, even with bundle ids left (S376 lens A A1)', async () => {
    await setUpFinale({ id: 'wid', name: 'Hyperion' }); // K2 ran in an earlier tab
    store.writeRekeyJournal = async () => { throw new Error('disk said no'); };
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('refused');
    expect((await store.readWorldMeta()).demo).toBeUndefined(); // still 'kept': the next boot finishes it
    expect(getState().registry.worlds[0].demo).toBe(true);
  });

  it('a commit whose registry save fails stops before the tour ends: TK and the demo entry stay (S376 lens A A2)', async () => {
    const realSet = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (k === 'atlas_worlds_registry') throw new DOMException('full', 'QuotaExceededError');
      return realSet.call(this, k, v);
    });
    try {
      const out = await keepTourWorldNow(W);
      expect(out.kind).toBe('refused');
      expect(readTourState()?.worldId).toBe(W);
      expect(getState().registry.worlds[0].demo).toBe(true);
      expect(toasts.some(t => /could not save your list of worlds, so keeping Hyperion did not finish/.test(t))).toBe(true);
      expect(toasts.some(t => /yours now/.test(t))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('K0 opens the world without the re-key toast, and its refusal from the finale names the button (S376 lens A A7, lens C C11)', async () => {
    setActiveStore(null);
    patchSlice('active', null);
    const out = await keepTourWorldNow(W);
    expect(out.kind).toBe('refused');
    expect(activationOpts[0]).toEqual({ quietRekey: true });
    expect(toasts.some(t => /then press Keep this world again/.test(t))).toBe(true);
    expect(toasts.some(t => /next time it starts/.test(t))).toBe(false);
  });

  it('refuses a 1.16 tour world (no `where`): its directory sits outside the browser home', async () => {
    const legacy = { ...tourEntry, where: undefined, folder: { ...tourEntry.folder, folder_name: 'hyperion-tour-l1aaaaaa' } };
    patchSlice('registry', { ...defaultRegistry(), worlds: [legacy as WorldRegistryEntry] });
    expect((await keepTourWorldNow(W)).kind).toBe('refused');
    expect(getState().registry.worlds[0].demo).toBe(true);
  });
});

describe('teardown and resume learn "kept" (lane K headline 2, lens A A5)', () => {
  it('teardown of a kept world.json that cannot be opened deletes nothing and un-demos nothing', async () => {
    await setUpFinale({ id: 'wid', name: 'Hyperion' });
    setActiveStore(null);
    patchSlice('active', null);
    await exitTour();
    expect(activations).toEqual([W]);
    expect(opfs.get(`${BROWSER_HOME}/${FOLDER}/world.json`)).not.toBeNull();
    expect(getState().registry.worlds.map(w => w.id)).toEqual([W]);
    expect(getState().registry.worlds[0].demo).toBe(true);
  });

  it('a keep that cannot finish stops Start fresh, keeps the done key as it was, and stops a replay (S375 gate K2, K3)', async () => {
    await setUpFinale({ id: 'wid', name: 'Hyperion' });
    setActiveStore(null);
    patchSlice('active', null);
    await exitTour();
    expect(localStorage.getItem('atlas_tour_done_v1')).toBeNull();
    expect(readTourState()?.worldId).toBe(W);
    const { startTour } = await import('../../src/tour/tour-engine');
    await expect(startTour('#/')).rejects.toThrow(/keep/i);
    expect(readTourState()?.worldId).toBe(W); // the next boot retries
  });

  it('teardown of an unreadable world.json deletes nothing', async () => {
    await setUpFinale();
    opfs.put(`${BROWSER_HOME}/${FOLDER}/world.json`, '');
    await exitTour();
    expect(opfs.get(`${BROWSER_HOME}/${FOLDER}/world.json`)).not.toBeNull();
    expect(getState().registry.worlds.map(w => w.id)).toEqual([W]);
    expect(getState().active).toBeNull(); // the sandbox is closed, not left open (gate K4)
  });

  it('control: teardown of a demo world.json removes the directory and the entry', async () => {
    await setUpFinale();
    await exitTour();
    expect(opfs.get(`${BROWSER_HOME}/${FOLDER}/world.json`)).toBeNull();
    expect(getState().registry.worlds).toEqual([]);
  });

  it('resume finds a kept world.json and finishes the keep instead of re-entering the step', async () => {
    await setUpFinale({ id: 'wid', name: 'Hyperion' });
    activationOpens = true; // the world is already the active one here
    await resumeTour();
    expect(readTourState()).toBeNull();
    expect(getState().registry.worlds[0].demo).toBeUndefined();
    expect((await store.listElements()).map(e => e.id)).not.toContain(CONSUL);
  });

  it('resume does nothing when activation fails: the tour, the entry and the ids stay', async () => {
    await setUpFinale({ id: 'wid', name: 'Hyperion' });
    setActiveStore(null);
    patchSlice('active', null);
    await resumeTour();
    expect(activations).toEqual([W]);
    expect(readTourState()?.worldId).toBe(W);
    expect(getState().registry.worlds[0].demo).toBe(true);
    expect((await store.listElements()).map(e => e.id)).toContain(CONSUL);
    expect(toasts.some(t => /tries again the next time it starts/.test(t))).toBe(true);
  });
});
