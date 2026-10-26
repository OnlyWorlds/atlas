/**
 * Promoted from the composition gate (lens B).
 * Gate lens B: attacks that did NOT break (GREEN = contract upheld).
 * Tests the keeper did not construct: whole-localStorage invariant 8, the
 * settleLivePass window (invariant 16), a live pass started mid-route, the
 * journal refusal touching nothing, and recovery + rerun not re-planning.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockFolderStore } from '../../fixtures/mock-folder-store';
import { MonotonicClock } from '../../fixtures/monotonic-clock';
import { FakeOwApiClient } from '../../fixtures/fake-ow-client';
import { getState, setState, patchSlice } from '../../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../../src/core/types';
import { __setRegistryTabBaseForTests, saveRegistry } from '../../../src/registry/registry';
import { setActiveStore } from '../../../src/core/active-store';
import { rescanNow, __resetLiveFolderForTests } from '../../../src/core/live-folder';
import { runRoute2, MergeRefusedError } from '../../../src/sync/make-online-run';
import { isRekeyRunning } from '../../../src/sync/rekey-run';

// One jsdom document for every file (vitest singleFork): leave it empty.
afterEach(() => { document.body.innerHTML = ''; });

const W = 'w1';
const O = '11111111-1111-4111-8111-111111111111';
const N = '22222222-2222-4222-8222-222222222222';
const R = '33333333-3333-4333-8333-333333333333';

let store: MockFolderStore;
let client: FakeOwApiClient;

const snapshotStorage = (): Record<string, string | null> => {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    out[k] = localStorage.getItem(k);
  }
  return out;
};

beforeEach(async () => {
  localStorage.clear();
  __resetLiveFolderForTests();
  document.body.innerHTML = '<div class="atlas-shell"></div>';
  store = new MockFolderStore();
  store.setClock(new MonotonicClock('2026-03-01T00:00:00.000Z').next);
  await store.open(null);
  await store.createElement('character', { id: O, name: 'Alice', description: 'local' } as Partial<Element>);
  await store.createElement('narrative', { id: R, name: 'Tale', characters: [O] } as Partial<Element>);
  client = new FakeOwApiClient();
  await client.createElement('character', { id: N, name: 'Alice', description: 'server' });
  const entry = {
    id: W, name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' },
    favorites: { protagonist_id: O }, active_calendar_id: O,
  } as unknown as WorldRegistryEntry;
  const reg = { ...defaultRegistry(), worlds: [entry] };
  saveRegistry(reg); // persisted, so the storage snapshot has something to compare
  patchSlice('registry', reg);
  __setRegistryTabBaseForTests(reg);
  patchSlice('active', { worldId: W, meta: { id: W, name: 'W' }, opened: true } as never);
  setActiveStore(store as never);
  const cur = getState();
  setState({
    ...cur,
    data: { ...cur.data, elements: await store.listElements(), loading: false },
    ui: { ...cur.ui, selectedElementId: O, rightTabs: [], zoneEditing: null, pinPlacement: null },
  });
  window.location.hash = `#/w/${W}/element/${O}`;
});

const base = () => ({ store, worldId: W, adapter: client, policy: 'b' as const, matchByName: true });

describe('lens B, UPHELD', () => {
  it('inv 8: a failure before the kernel leaves ALL of localStorage, the hash and the list byte-identical', async () => {
    const before = snapshotStorage();
    const elsBefore = getState().data.elements;
    vi.spyOn(client, 'listElements').mockRejectedValueOnce(new Error('network down'));
    await expect(runRoute2({ ...base(), link: async () => { throw new Error('link must not run'); } })).rejects.toThrow(/network down/);
    expect(snapshotStorage()).toEqual(before);
    expect(getState().data.elements).toBe(elsBefore);
    expect(window.location.hash).toBe(`#/w/${W}/element/${O}`);
  });

  it('inv 8/10: an unfinished journal refuses with nothing read from the server and nothing stored', async () => {
    await store.writeRekeyJournal({ version: 1, world_id: W, map: {}, types: {}, stamps: {}, unrewritten: [], started_at: '' } as never);
    const before = snapshotStorage();
    const list = vi.spyOn(client, 'listElements');
    await expect(runRoute2({ ...base(), link: async () => {} })).rejects.toBeInstanceOf(MergeRefusedError);
    expect(list).not.toHaveBeenCalled();
    expect(snapshotStorage()).toEqual(before);
    expect(isRekeyRunning()).toBe(false);
  });

  it('inv 16: a live pass already in flight is waited out before the merge reads anything', async () => {
    let open!: () => void;
    const gate = new Promise<void>(res => { open = res; });
    let scanning = false;
    vi.spyOn(store, 'rescanDisk').mockImplementation(async () => { scanning = true; await gate; return { changes: [] }; });
    const pass = rescanNow({ force: true });
    await vi.waitFor(() => expect(scanning).toBe(true));
    const list = vi.spyOn(client, 'listElements');
    const route = runRoute2({ ...base(), link: async () => {} });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise(r => setTimeout(r, 20));
    expect(isRekeyRunning()).toBe(true);
    expect(list).not.toHaveBeenCalled(); // the route waits on the pass
    open();
    await pass;
    const r = await route;
    expect(r.rekeyed.get(O)).toBe(N);
  });

  it('inv 16: a pass asked for while the route runs (focus, trailing, revive) skips with "rekey"', async () => {
    const outcomes: string[] = [];
    await runRoute2({
      ...base(),
      onProgress: () => { void rescanNow({ force: true }).then(o => outcomes.push(o.skipped ?? 'ran')); },
      link: async () => {
        const o = await rescanNow({ force: true });
        outcomes.push(o.skipped ?? 'ran');
      },
    });
    expect(outcomes.length).toBeGreaterThan(0);
    expect(outcomes.every(s => s === 'rekey')).toBe(true);
  });

  it('retry-as-recovery then rerun: one kernel pass per pair, one link, the server holds one Alice and no O', async () => {
    const real = store.deleteElement.bind(store);
    let armed = true;
    vi.spyOn(store, 'deleteElement').mockImplementation(async (id, opts) => {
      if (armed && id === O && (await store.hasRekeyJournal())) { armed = false; throw new Error('tab closed'); }
      return real(id, opts);
    });
    const link = vi.fn(async () => {});
    const r = await runRoute2({ ...base(), link });
    expect(link).toHaveBeenCalledTimes(1);
    expect(r.failures).toEqual([]);
    expect([...r.rekeyed]).toEqual([[O, N]]);
    expect(r.updates).toBe(1); // Alice matched once (by id on the rerun), not twice
    expect(client.__server_count('character')).toBe(1);
    expect(getState().data.elements.map(e => e.id).sort()).toEqual([N, R].sort());
    expect(getState().registry.worlds[0].favorites?.protagonist_id).toBe(N);
  });
});
