/**
 * THE LIVE FOLDER's app half on a LINKED world: Titus's rulings.
 * Real FsFolderStore over the in-memory FS; the sync engine is a stub that
 * records what the pass asks of it.
 *   Q1 an outside edit carrying a fresh `local_updated_at` uploads (a push is requested).
 *   Q2 one without it is shown and marked "not synced", and nothing is pushed.
 *   Q4 above BIG_BATCH changed elements, sync is held until the user answers:
 *      "Upload them" releases, "Stay offline" pauses the world, then releases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const engine = {
  hold: vi.fn(async () => release),
  pause: vi.fn(),
};
const release = vi.fn();
const requestPushIfLinked = vi.fn();
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => engine,
  getCurrentSyncWorldId: () => 'w-linked',
  requestPushIfLinked: () => requestPushIfLinked(),
  refreshMetaCacheNow: async () => {},
}));

import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import { rescanNow, getDiskNotice, answerHeldBatch, adoptPersistedDiskHold, BIG_BATCH, __resetLiveFolderForTests } from '../../src/core/live-folder';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
const SYNCED = '2026-03-01T00:00:00.000Z';

async function linkedWorld(n: number): Promise<{ root: FakeDirHandle; store: FsFolderStore; ids: string[] }> {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  const store = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const el = await store.createElement('character', { name: `C${i}` });
    await store.stampServerUpdatedAt(el.id, 'character', SYNCED);
    ids.push(el.id);
  }
  setActiveStore(store);
  const entry = { id: 'w-linked', name: 'W', state: 'api-linked', folder: { handle_key: 'k', folder_name: 'w' }, created_at: SYNCED } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: 'w-linked', meta: await store.readWorldMeta(), opened: true } as never);
  patchSlice('data', { elements: await store.listElements(), loading: false } as never);
  return { root, store, ids };
}

function editOutside(root: FakeDirHandle, id: string, patch: Record<string, unknown>): void {
  const p = root.list().find(x => x.startsWith('elements/') && x.includes(id.slice(-8)))!;
  root.put(p, j({ ...JSON.parse(root.get(p)!), ...patch }));
}

beforeEach(() => {
  // localStorage outlives a test FILE here (vitest singleFork): another file's
  // tour flag would make every pass a no-op (the live folder skips the tour).
  localStorage.clear();
  __resetLiveFolderForTests();
  engine.hold.mockClear();
  engine.pause.mockClear();
  release.mockClear();
  requestPushIfLinked.mockClear();
});

describe('the live folder on a linked world', () => {
  it('Q1: an edit with a fresh local_updated_at is shown and requests a push', async () => {
    const { root, ids } = await linkedWorld(2);
    editOutside(root, ids[0], { description: 'agent', local_updated_at: '2026-04-01T00:00:00.000Z' });
    await rescanNow({ force: true });
    expect(getState().data.elements.find(e => e.id === ids[0])?.description).toBe('agent');
    expect(requestPushIfLinked).toHaveBeenCalledTimes(1);
    expect(getDiskNotice()?.marked.has(ids[0])).toBe(true);
    expect(getDiskNotice()?.notSynced.size).toBe(0);
  });

  it('Q2: an edit without a new stamp is shown, marked not synced, and pushes nothing', async () => {
    const { root, ids } = await linkedWorld(2);
    editOutside(root, ids[1], { description: 'by hand' });
    await rescanNow({ force: true });
    expect(getState().data.elements.find(e => e.id === ids[1])?.description).toBe('by hand');
    expect(requestPushIfLinked).not.toHaveBeenCalled();
    expect([...getDiskNotice()!.notSynced]).toEqual([ids[1]]);
  });

  it('Q4: a batch above the threshold holds sync; "Upload them" releases it', async () => {
    const { root, ids } = await linkedWorld(BIG_BATCH + 1);
    for (const id of ids) editOutside(root, id, { description: 'branch b', local_updated_at: '2026-04-01T00:00:00.000Z' });
    await rescanNow({ force: true });
    expect(engine.hold).toHaveBeenCalledWith('disk');
    expect(requestPushIfLinked).not.toHaveBeenCalled();
    expect(getDiskNotice()?.held?.count).toBe(BIG_BATCH + 1);
    await answerHeldBatch(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(engine.pause).not.toHaveBeenCalled();
    expect(getDiskNotice()?.held).toBeNull();
  });

  it('Q4: "Stay offline" pauses the world before releasing the hold', async () => {
    const { root, ids } = await linkedWorld(BIG_BATCH + 1);
    for (const id of ids) editOutside(root, id, { description: 'branch b', local_updated_at: '2026-04-01T00:00:00.000Z' });
    await rescanNow({ force: true });
    await answerHeldBatch(false);
    expect(engine.pause).toHaveBeenCalledWith('manual');
    expect(getState().registry.worlds[0].sync_paused).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
    expect(engine.pause.mock.invocationCallOrder[0]).toBeLessThan(release.mock.invocationCallOrder[0]);
  });

  it('B11: a big batch of edits WITHOUT new stamps holds nothing (they upload nothing)', async () => {
    const { root, ids } = await linkedWorld(BIG_BATCH + 1);
    for (const id of ids) editOutside(root, id, { description: 'git checkout' });
    await rescanNow({ force: true });
    expect(engine.hold).not.toHaveBeenCalled();
    expect(requestPushIfLinked).not.toHaveBeenCalled();
    expect(getDiskNotice()?.notSynced.size).toBe(BIG_BATCH + 1);
  });

  it('a batch at the threshold does not hold', async () => {
    const { root, ids } = await linkedWorld(BIG_BATCH);
    for (const id of ids) editOutside(root, id, { description: 'x', local_updated_at: '2026-04-01T00:00:00.000Z' });
    await rescanNow({ force: true });
    expect(engine.hold).not.toHaveBeenCalled();
    expect(requestPushIfLinked).toHaveBeenCalledTimes(1);
  });
});

describe('a held batch outlives the world switch and the reload', () => {
  it('is persisted, and a new engine is held again at attach, before its flush could push', async () => {
    const { root, ids } = await linkedWorld(BIG_BATCH + 1);
    for (const id of ids) editOutside(root, id, { description: 'x', local_updated_at: '2026-04-01T00:00:00.000Z' });
    await rescanNow({ force: true });
    expect(JSON.parse(localStorage.getItem('atlas_disk_held')!)).toEqual({ 'w-linked': BIG_BATCH + 1 });

    // A reload: module state gone, the persisted question stays.
    __resetLiveFolderForTests();
    localStorage.setItem('atlas_disk_held', JSON.stringify({ 'w-linked': BIG_BATCH + 1 }));
    const fresh = { hold: vi.fn(async () => release) };
    adoptPersistedDiskHold('w-linked', fresh);
    expect(fresh.hold).toHaveBeenCalledWith('disk');
    expect(getDiskNotice()?.held?.count).toBe(BIG_BATCH + 1);
    await answerHeldBatch(true);
    await new Promise(r => setTimeout(r, 0)); // the release rides the hold's promise
    expect(release).toHaveBeenCalled();
    expect(localStorage.getItem('atlas_disk_held')).toBe('{}');
  });
});
