/**
 * Giving foreign elements new ids from the app (`sync/rekey-run.ts`):
 * the guards only the app can check, and the one live pass after the kernel
 * (re-key gate lens 3 F5/F7/F10).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { getState, setState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { giveForeignElementsNewIds, RekeyRefusedError, foreignIdsFor } from '../../src/sync/rekey-run';

const W = 'w1';
const API = 'api-1';
const O = '11111111-1111-4111-8111-111111111111';
const R = '33333333-3333-4333-8333-333333333333';
const M = '44444444-4444-4444-8444-444444444444';

let store: MockFolderStore;
let entry: WorldRegistryEntry;

beforeEach(async () => {
  localStorage.clear();
  store = new MockFolderStore();
  store.setClock(new MonotonicClock('2026-03-01T00:00:00.000Z').next);
  await store.open(null);
  await store.createElement('map', { id: M, name: 'Map' } as Partial<Element>);
  await store.createElement('location', { id: O, name: 'Rivendell' } as Partial<Element>);
  await store.createElement('character', { id: R, name: 'Elrond', location: O } as Partial<Element>);
  await store.updateSyncState(() => ({ foreign: { api_world_id: API, ids: [{ id: O, type: 'location', first_seen: 'x' }, { id: M, type: 'map', first_seen: 'x' }] } }));
  entry = {
    id: W, name: 'W', state: 'api-linked', folder: { handle_key: 'k', folder_name: 'f' },
    api: { world_id: API, api_key: 'ow_w_x' },
  } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: W, meta: { id: W, name: 'W' }, opened: true } as never);
  const cur = getState();
  setState({
    ...cur,
    data: { ...cur.data, elements: await store.listElements() },
    ui: { ...cur.ui, selectedElementId: O, rightTabs: [{ kind: 'map', mapId: M } as never], zoneEditing: null },
  });
  window.location.hash = `#/w/${W}/map/${M}/element/${O}`;
});

describe('giveForeignElementsNewIds', () => {
  it('re-keys the live foreign set and the screen follows in one pass', async () => {
    expect((await foreignIdsFor(store, entry)).map(f => f.id).sort()).toEqual([O, M].sort());
    const r = await giveForeignElementsNewIds({ store, entry });
    const nO = r.map.get(O)!;
    const nM = r.map.get(M)!;
    const ids = getState().data.elements.map(e => e.id);
    expect(ids).not.toContain(O);
    expect(ids.filter(id => id === nO)).toHaveLength(1); // never grafted twice (lens 3 F7)
    expect(getState().data.elements.find(e => e.id === R)!.location).toBe(nO); // referrer reloaded, not stale
    expect(getState().ui.selectedElementId).toBe(nO);
    expect(getState().ui.rightTabs).toEqual([{ kind: 'map', mapId: nM }]);
    expect(window.location.hash).toBe(`#/w/${W}/map/${nM}/element/${nO}`);
    expect(await foreignIdsFor(store, entry)).toEqual([]);
  });

  it('refuses the tour world, and a world whose zone edit is open, touching nothing', async () => {
    await expect(giveForeignElementsNewIds({ store, entry: { ...entry, demo: true } }))
      .rejects.toBeInstanceOf(RekeyRefusedError);
    // A zone reshape marks the page (the ui.zoneEditing slice was never set).
    const edit = document.createElement('div');
    edit.className = 'atlas-zone-editing';
    document.body.appendChild(edit);
    await expect(giveForeignElementsNewIds({ store, entry })).rejects.toThrow(/zone/);
    edit.remove();
    expect(await store.getElement(O)).not.toBeNull();
  });

  it('a tour left running in ANOTHER world does not block this one (lens 3 F5)', async () => {
    localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true, step: 3, worldId: 'tour-world' }));
    const r = await giveForeignElementsNewIds({ store, entry });
    expect(r.map.size).toBe(2);
  });

  it('refuses when nothing is recorded foreign any more', async () => {
    await store.updateSyncState(() => ({ foreign: { api_world_id: 'another-api-world', ids: [{ id: O, type: 'location', first_seen: 'x' }] } }));
    await expect(giveForeignElementsNewIds({ store, entry })).rejects.toThrow(/Nothing here needs/);
  });
});
