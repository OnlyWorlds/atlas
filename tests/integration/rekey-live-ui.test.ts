/**
 * The screen after ids move (`rekeyLiveUi`, `sync/rekey-run.ts`). Ported from
 * the retired `sync-attach.idSwap.test.ts` (Route 2 moves ids through
 * the re-key kernel now, and `handleIdSwap` went with its last caller). What
 * the old test covered on disk or in storage (camera, chart scopes,
 * favourites) is the kernel's and `rekeyPersistedState`'s, tested there.
 *
 * The disk here is already re-keyed: `rekeyLiveUi` reloads the element list
 * from it and moves only the live state that still names the old ids.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// A stub engine, so the live folder's pass can record a "not synced" mark.
let syncWorld: string | null = null;
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => (syncWorld ? { hold: async () => () => {}, pause: () => {} } : null),
  getCurrentSyncWorldId: () => syncWorld,
  requestPushIfLinked: () => {},
  refreshMetaCacheNow: async () => {},
}));

import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { getState, setState, patchSlice, subscribe } from '../../src/core/state';
import { defaultRegistry, type Element, type ElementType, type WorldRegistryEntry } from '../../src/core/types';
import type { DiskChange } from '../../src/store/folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { rescanNow, getDiskNotice, __resetLiveFolderForTests } from '../../src/core/live-folder';
import { rekeyLiveUi } from '../../src/sync/rekey-run';

const W = 'w1';
const MAP = new Map([['old-id', 'new-id'], ['m-old', 'm-new']]);

let store: MockFolderStore;

beforeEach(async () => {
  localStorage.clear();
  __resetLiveFolderForTests();
  syncWorld = null;
  store = new MockFolderStore();
  store.setClock(new MonotonicClock('2026-03-01T00:00:00.000Z').next);
  await store.open(null);
  await store.createElement('character', { id: 'new-id', name: 'Moved' } as Partial<Element>);
  await store.createElement('map', { id: 'm-new', name: 'Map' } as Partial<Element>);
  await store.createElement('location', { id: 'other', name: 'Untouched' } as Partial<Element>);
  setActiveStore(store as never);
  const entry = { id: W, name: 'W', state: 'api-linked', folder: { handle_key: 'k', folder_name: 'f' }, api: { world_id: 'api-1', api_key: 'k' } };
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry as unknown as WorldRegistryEntry] });
  patchSlice('active', { worldId: W, meta: { id: W, name: 'W' }, opened: true } as never);
  const cur = getState();
  setState({
    ...cur,
    data: {
      elements: [
        { id: 'old-id', type: 'character', name: 'Moved', local_updated_at: 't' },
        { id: 'm-old', type: 'map', name: 'Map', local_updated_at: 't' },
        { id: 'other', type: 'location', name: 'Untouched', local_updated_at: 't' },
      ] as Element[],
    },
    ui: {
      ...cur.ui,
      selectedElementId: null,
      rightTabs: [{ kind: 'map-index' }],
      rightActiveIndex: 0,
      pinPlacement: null,
      zoneEditing: null,
      knowledgeLens: null,
    },
  });
  window.location.hash = '#/';
});

afterEach(() => {
  window.location.hash = '#/';
  setActiveStore(null);
  patchSlice('active', null);
  __resetLiveFolderForTests();
});

const ui = (patch: Partial<ReturnType<typeof getState>['ui']>) => patchSlice('ui', { ...getState().ui, ...patch });
const run = () => rekeyLiveUi(store, W, MAP);

describe('rekeyLiveUi: the live state follows the ids', () => {
  it('moves the selected element, and leaves another selection alone', async () => {
    ui({ selectedElementId: 'old-id' });
    await run();
    expect(getState().ui.selectedElementId).toBe('new-id');

    ui({ selectedElementId: 'other' });
    await run();
    expect(getState().ui.selectedElementId).toBe('other');
  });

  it('the strand mark\'s mirror is read from disk, even when the mirror was already stale', async () => {
    await store.writeWorldMeta({ id: W, name: 'W', x_strand: { narrative: 'new-id', event: null, location: null } } as never);
    patchSlice('active', { ...getState().active!, meta: { id: W, name: 'W', x_strand: { narrative: 'stale' } } as never });
    await run();
    expect((getState().active!.meta as unknown as Record<string, unknown>).x_strand)
      .toEqual({ narrative: 'new-id', event: null, location: null });
  });

  it('reloads the elements from disk: the new id resolves, the old one is gone', async () => {
    await run();
    const ids = getState().data.elements.map(e => e.id).sort();
    expect(ids).toEqual(['m-new', 'new-id', 'other']);
  });

  it('moves an open map tab, keeping its label, world stamp and the active index', async () => {
    ui({
      rightTabs: [
        { kind: 'map-index' },
        { kind: 'map', mapId: 'm-old', label: 'Map', worldId: W },
        { kind: 'map', mapId: 'other-map', label: 'Other' },
      ],
      rightActiveIndex: 1,
    });
    await run();
    expect(getState().ui.rightTabs).toEqual([
      { kind: 'map-index' },
      { kind: 'map', mapId: 'm-new', label: 'Map', worldId: W },
      { kind: 'map', mapId: 'other-map', label: 'Other' },
    ]);
    expect(getState().ui.rightActiveIndex).toBe(1);
  });

  it('moves pin placement, and leaves one for another element alone', async () => {
    ui({ pinPlacement: { elementId: 'old-id' } });
    await run();
    expect(getState().ui.pinPlacement).toEqual({ elementId: 'new-id' });

    ui({ pinPlacement: { elementId: 'other' } });
    await run();
    expect(getState().ui.pinPlacement).toEqual({ elementId: 'other' });
  });

  it('moves the knowledge lens with its knower', async () => {
    ui({ knowledgeLens: { knowerId: 'old-id' } });
    await run();
    expect(getState().ui.knowledgeLens).toEqual({ knowerId: 'new-id' });
  });

  it('changes the state once, with data and ui agreeing', async () => {
    ui({ selectedElementId: 'old-id' });
    const seen: Array<{ sel: string | null; hasOld: boolean; hasNew: boolean }> = [];
    const unsub = subscribe(() => {
      const s = getState();
      seen.push({
        sel: s.ui.selectedElementId,
        hasOld: s.data.elements.some(e => e.id === 'old-id'),
        hasNew: s.data.elements.some(e => e.id === 'new-id'),
      });
    });
    await run();
    unsub();
    expect(seen).toEqual([{ sel: 'new-id', hasOld: false, hasNew: true }]);
  });
});

describe('rekeyLiveUi: the URL follows, replacing history', () => {
  const cases: Array<[string, string, string]> = [
    ['element route', `#/w/${W}/element/old-id`, `#/w/${W}/element/new-id`],
    ['map route', `#/w/${W}/map/m-old`, `#/w/${W}/map/m-new`],
    ['map + element route', `#/w/${W}/map/m-old/element/old-id`, `#/w/${W}/map/m-new/element/new-id`],
    ['element on a map that kept its id', `#/w/${W}/map/keep/element/old-id`, `#/w/${W}/map/keep/element/new-id`],
    ['timeline route stays in the timeline', `#/w/${W}/timeline/old-id`, `#/w/${W}/timeline/new-id`],
    ['writing route', `#/w/${W}/writing/old-id`, `#/w/${W}/writing/new-id`],
    ['knowledge route', `#/w/${W}/knowledge/old-id`, `#/w/${W}/knowledge/new-id`],
    ['knowledge knower route', `#/w/${W}/knowledge/knower/old-id`, `#/w/${W}/knowledge/knower/new-id`],
  ];
  for (const [label, from, to] of cases) {
    it(label, async () => {
      window.location.hash = from;
      const before = window.history.length;
      await run();
      expect(window.location.hash).toBe(to);
      expect(window.history.length).toBe(before);
    });
  }

  it('leaves a URL naming another element, or no element, alone', async () => {
    window.location.hash = `#/w/${W}/element/other`;
    await run();
    expect(window.location.hash).toBe(`#/w/${W}/element/other`);

    window.location.hash = `#/w/${W}/worlds`;
    ui({ selectedElementId: 'old-id' });
    await run();
    expect(window.location.hash).toBe(`#/w/${W}/worlds`);
    expect(getState().ui.selectedElementId).toBe('new-id');
  });
});

describe('rekeyLiveUi: another world is never touched', () => {
  it('does nothing with no active world', async () => {
    patchSlice('active', null);
    ui({ selectedElementId: 'old-id' });
    window.location.hash = `#/w/${W}/element/old-id`;
    const unsub = vi.fn();
    const off = subscribe(unsub);
    await run();
    off();
    expect(unsub).not.toHaveBeenCalled();
    expect(getState().ui.selectedElementId).toBe('old-id');
    expect(window.location.hash).toBe(`#/w/${W}/element/old-id`);
  });

  it('does nothing when a different world is active', async () => {
    patchSlice('active', { worldId: 'w2', meta: { id: 'w2', name: 'W2' }, opened: true } as never);
    ui({ selectedElementId: 'old-id', pinPlacement: { elementId: 'old-id' } });
    window.location.hash = `#/w/${W}/element/old-id`;
    const before = getState().data.elements;
    await run();
    expect(getState().ui.selectedElementId).toBe('old-id');
    expect(getState().ui.pinPlacement).toEqual({ elementId: 'old-id' });
    expect(getState().data.elements).toBe(before);
    expect(window.location.hash).toBe(`#/w/${W}/element/old-id`);
  });
});

describe('rekeyLiveUi: the live folder\'s marks follow the ids (lane B N8)', () => {
  /** One live-folder pass that reports these ids as changed on disk. */
  async function markChanged(ids: Array<[string, ElementType]>): Promise<void> {
    const changes: DiskChange[] = ids.map(([id, type]) => ({ id, type, kind: 'changed' }));
    store.rescanDisk = async () => ({ changes });
    await rescanNow({ force: true });
    store.rescanDisk = async () => ({ changes: [] });
  }

  it('moves a marked element to its new id', async () => {
    await store.createElement('character', { id: 'old-id', name: 'Before the move' } as Partial<Element>);
    await markChanged([['old-id', 'character'], ['other', 'location']]);
    expect([...getDiskNotice()!.marked].sort()).toEqual(['old-id', 'other']);
    await store.deleteElement('old-id');

    await run();
    expect([...getDiskNotice()!.marked].sort()).toEqual(['new-id', 'other']);
  });

  it('moves a "not synced" mark too', async () => {
    syncWorld = W;
    await store.createElement('character', { id: 'old-id', name: 'Before the move' } as Partial<Element>);
    await store.stampServerUpdatedAt('old-id', 'character', '2027-01-01T00:00:00.000Z');
    await markChanged([['old-id', 'character']]);
    expect([...getDiskNotice()!.notSynced]).toEqual(['old-id']);
    await store.deleteElement('old-id');

    await run();
    expect([...getDiskNotice()!.notSynced]).toEqual(['new-id']);
    expect([...getDiskNotice()!.marked]).toEqual(['new-id']);
  });
});
