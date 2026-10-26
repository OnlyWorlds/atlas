/**
 * Route 2 from the app (`sync/make-online-run.ts`): what the runner owns
 * around the merge. The old route moved the UI in its match phase, before
 * the disk (lane A H7): a failure left favourites, the URL and the element
 * list on server ids the folder never got. Now nothing moves before the
 * kernel, the screen follows the disk once, a kernel failure is finished from
 * its journal, and the id-move lock is held for the whole route (lane B N2).
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { getState, setState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { __setRegistryTabBaseForTests } from '../../src/registry/registry';
import { runRoute2, ambiguousLine, childClashLine, MergeRefusedError } from '../../src/sync/make-online-run';
import { giveForeignElementsNewIds, isRekeyRunning } from '../../src/sync/rekey-run';

// One jsdom document for every file (vitest singleFork): leave it empty.
afterEach(() => { document.body.innerHTML = ''; });

const W = 'w1';
const O = '11111111-1111-4111-8111-111111111111'; // local Alice
const N = '22222222-2222-4222-8222-222222222222'; // server Alice
const R = '33333333-3333-4333-8333-333333333333'; // local scene naming Alice

let store: MockFolderStore;
let client: FakeOwApiClient;

beforeEach(async () => {
  localStorage.clear();
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
  patchSlice('registry', reg);
  // The per-field registry merge is the path production runs (lane B N4).
  __setRegistryTabBaseForTests(reg);
  patchSlice('active', { worldId: W, meta: { id: W, name: 'W' }, opened: true } as never);
  const cur = getState();
  setState({
    ...cur,
    data: { ...cur.data, elements: await store.listElements() },
    ui: { ...cur.ui, selectedElementId: O, rightTabs: [], zoneEditing: null },
  });
  window.location.hash = `#/w/${W}/element/${O}`;
});

const base = () => ({ store, worldId: W, adapter: client, policy: 'b' as const, matchByName: true });

describe('runRoute2', () => {
  it('a merge that fails before the kernel leaves browser state untouched', async () => {
    vi.spyOn(client, 'listElements').mockRejectedValueOnce(new Error('network down'));
    const link = vi.fn(async () => {});
    await expect(runRoute2({ ...base(), link })).rejects.toThrow(/network down/);
    const w = getState().registry.worlds.find(x => x.id === W)!;
    expect(w.favorites?.protagonist_id).toBe(O);
    expect(w.active_calendar_id).toBe(O);
    expect(getState().ui.selectedElementId).toBe(O);
    expect(window.location.hash).toBe(`#/w/${W}/element/${O}`);
    expect(getState().data.elements.map(e => e.id)).toContain(O);
    expect(link).not.toHaveBeenCalled();
    expect(document.querySelector('.atlas-shell')!.hasAttribute('inert')).toBe(false);
    expect(isRekeyRunning()).toBe(false);
  });

  it('browser state follows a name match: registry, URL, selection, the element list', async () => {
    const link = vi.fn(async () => {});
    const r = await runRoute2({ ...base(), link });
    expect(r.rekeyed.get(O)).toBe(N);
    const w = getState().registry.worlds.find(x => x.id === W)!;
    expect(w.favorites?.protagonist_id).toBe(N);
    expect(w.active_calendar_id).toBe(N);
    expect(getState().ui.selectedElementId).toBe(N);
    expect(window.location.hash).toBe(`#/w/${W}/element/${N}`);
    const ids = getState().data.elements.map(e => e.id);
    expect(ids).not.toContain(O);
    expect(ids.filter(id => id === N)).toHaveLength(1);
    expect(getState().data.elements.find(e => e.id === R)!.characters).toEqual([N]);
    expect(link).toHaveBeenCalledTimes(1);
  });

  it('a link step that throws after the kernel still leaves the element list equal to the disk (gate B1)', async () => {
    // The server holds an element this world lacks: the merge downloads it.
    const S = '44444444-4444-4444-8444-444444444444';
    await client.createElement('location', { id: S, name: 'Server Only' });
    await expect(runRoute2({ ...base(), link: async () => { throw new Error('disk full'); } })).rejects.toThrow(/disk full/);
    const ids = getState().data.elements.map(e => e.id).sort();
    expect(ids).toEqual((await store.listElements()).map(e => e.id).sort());
    expect(ids).toContain(S);
    expect(ids).toContain(N);
    expect(ids).not.toContain(O);
    expect(document.querySelector('.atlas-shell')!.hasAttribute('inert')).toBe(false);
  });

  it('holds the id-move lock and the app inert for the whole route, link included', async () => {
    const seen: boolean[] = [];
    const inert: boolean[] = [];
    await runRoute2({
      ...base(),
      onProgress: () => { seen.push(isRekeyRunning()); },
      link: async () => {
        seen.push(isRekeyRunning());
        inert.push(document.querySelector('.atlas-shell')!.hasAttribute('inert'));
      },
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(Boolean)).toBe(true);
    expect(inert).toEqual([true]);
    expect(isRekeyRunning()).toBe(false);
    expect(document.querySelector('.atlas-shell')!.hasAttribute('inert')).toBe(false);
  });

  it('a kernel that fails mid-way is finished from its journal, then the merge completes', async () => {
    const real = store.deleteElement.bind(store);
    let armed = true;
    vi.spyOn(store, 'deleteElement').mockImplementation(async (id, opts) => {
      if (armed && id === O && (await store.hasRekeyJournal())) { armed = false; throw new Error('tab closed'); }
      return real(id, opts);
    });
    const link = vi.fn(async () => {});
    const r = await runRoute2({ ...base(), link });
    expect(await store.hasRekeyJournal()).toBe(false);
    expect(await store.getElement(O)).toBeNull();
    expect(await store.getElement(N)).not.toBeNull();
    expect(r.rekeyed.get(O)).toBe(N);
    expect(client.__server_count('character')).toBe(1);
    expect(link).toHaveBeenCalledTimes(1);
    expect(getState().ui.selectedElementId).toBe(N);
  });

  it('refuses beside an open zone edit and beside a running id move, touching nothing', async () => {
    // A zone draft marks the page (the ui.zoneEditing slice was never set).
    const draft = document.createElement('div');
    draft.setAttribute('data-zone-draft-overlay', '');
    document.body.appendChild(draft);
    await expect(runRoute2({ ...base(), link: async () => {} })).rejects.toBeInstanceOf(MergeRefusedError);
    draft.remove();

    // A Settings re-key in flight owns the one id-move slot.
    let release!: () => void;
    const gate = new Promise<void>(res => { release = res; });
    const other = new MockFolderStore();
    await other.open(null);
    vi.spyOn(other, 'readSyncState').mockImplementation(async () => { await gate; return {} as never; });
    const entry = { id: 'w2', name: 'W2', state: 'api-linked', api: { world_id: 'a', api_key: 'k' } } as unknown as WorldRegistryEntry;
    const running = giveForeignElementsNewIds({ store: other, entry }).catch(() => {});
    await vi.waitFor(() => expect(isRekeyRunning()).toBe(true));
    await expect(runRoute2({ ...base(), link: async () => {} })).rejects.toThrow(/already running/);
    release();
    await running;
    expect(await store.getElement(O)).not.toBeNull();
    expect(client.__server_count('character')).toBe(1);
  });
});

describe('ambiguousLine', () => {
  it('names up to three and counts the rest', () => {
    expect(ambiguousLine([])).toBeNull();
    expect(ambiguousLine([{ type: 'character', name: 'Alice' }])).toMatch(/^One name was not matched .*\(Alice\)/);
    const five = ['A', 'B', 'C', 'D', 'E'].map(name => ({ type: 'character' as const, name }));
    expect(ambiguousLine(five)).toMatch(/^5 names were not matched .*\(A, B, C and 2 more\)/);
  });
});

describe('childClashLine (gate A4/A5)', () => {
  it('says map, zone or both, names up to three, and has no em-dash', () => {
    expect(childClashLine([])).toBeNull();
    expect(childClashLine([{ type: 'map', name: 'World' }])).toBe(
      'One map was not matched because the local and the online one both have pins or markers on it (World): each stays its own element',
    );
    expect(childClashLine([{ type: 'zone', name: 'Forest' }, { type: 'zone', name: 'Moor' }])).toBe(
      '2 zones were not matched because the local and the online ones both have markers on them (Forest, Moor): each stays its own element',
    );
    const mixed = childClashLine([
      { type: 'map', name: 'A' }, { type: 'map', name: 'B' }, { type: 'zone', name: 'C' }, { type: 'zone', name: 'D' },
    ])!;
    expect(mixed).toMatch(/^4 maps and zones were not matched .*pins or markers on them \(A, B, C and 1 more\)/);
    expect(mixed).not.toContain('—');
  });
});
