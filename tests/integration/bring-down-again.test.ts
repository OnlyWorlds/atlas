/**
 * Bring it down again (1.17, conv. 129; contract §3.3,
 * Skeld 2026-10-04): a linked world the browser cleared comes back from
 * onlyworlds.com as a NAMED RESTORE, not the link flow. It downloads into a
 * FRESH nonced directory (gate B6), writes world.json with the entry's OWN
 * world id and its `api` block (a made-online world keeps its local id while
 * the server's differs), updates the SAME entry (never a second one), and its
 * first sync reviews before it writes. Any failure leaves the row as it was.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore, getActiveStore } from '../../src/core/active-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

const TEST_BASE = 'https://test-ow.local/api/v2';

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: vi.fn(async () => {}),
  loadHandle: async () => null,
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
  listHandleKeys: async () => [],
}));
vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  return { FsFolderStore: MockFolderStore };
});
vi.mock('../../src/sync/make-online', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/make-online')>()),
  buildV2Adapter: (apiKey: string, apiPin: string) => new OwV2ClientAdapter({ apiKey, apiPin, baseUrl: TEST_BASE }),
}));
vi.mock('../../src/sync/sync-attach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/sync-attach')>()),
  attachSyncEngine: vi.fn(),
}));

import { bringDownAgain, ownWorldIdOf } from '../../src/setup/bring-down-again';
import { saveRegistry } from '../../src/registry/registry';
import { installFakeLocks } from '../fixtures/fake-locks';
import { MockFolderStore as PriorStore } from '../fixtures/mock-folder-store';
import { attachSyncEngine } from '../../src/sync/sync-attach';
import type { MockFolderStore } from '../fixtures/mock-folder-store';

const SERVER_WORLD = '068e5012-d77c-799d-8000-95548fbae700';
/** A world made locally and taken online: world.json kept this id, the server's differs. */
const LOCAL_ID = '0192a000-aaaa-7bbb-8ccc-000000000001';
const OLD_DIR = 'hollow-reach-0192a000-dead';
let root: FakeDirHandle;
const home = () => root.children.get(BROWSER_HOME) as FakeDirHandle | undefined;

function cleared(over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return {
    id: 'w1', name: 'Hollow Reach', state: 'api-linked', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
    created_at: '2026-10-01T00:00:00.000Z',
    api: { world_id: SERVER_WORLD, api_key: 'k', world_name: 'Hollow Reach' },
    folder: { handle_key: `world-${LOCAL_ID}`, folder_name: OLD_DIR, last_path_hint: `browser storage/${OLD_DIR}` },
    ...over,
  } as WorldRegistryEntry;
}

const updateEntry = (patch: Partial<WorldRegistryEntry>) =>
  ({ ...getState().registry, worlds: getState().registry.worlds.map(w => (w.id === 'w1' ? { ...w, ...patch } : w)) });
/** The registry in memory AND in storage, as a real tab holds it. */
const putRegistry = (reg: ReturnType<typeof defaultRegistry>) => { saveRegistry(reg); patchSlice('registry', reg); };

beforeEach(async () => {
  root = new FakeDirHandle('opfs');
  await root.getDirectoryHandle(BROWSER_HOME, { create: true });
  setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
  setActiveStore(null);
  patchSlice('active', null);
  putRegistry({ ...defaultRegistry(), pin: '1234', worlds: [cleared()] });
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(...statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next }).handlers);
  const server = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: TEST_BASE });
  for (const name of ['Alice', 'Bob']) await server.createElement('character', { name });
  vi.mocked(attachSyncEngine).mockClear();
});
afterEach(() => {
  setOpfsRootForTests(null);
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

describe('bring it down again', () => {
  it('restores the SAME entry from the server into a fresh directory, under the world\'s own id, its first sync reviewed', async () => {
    const out = await bringDownAgain('w1');
    expect(out.downloaded).toBe(2);
    const worlds = getState().registry.worlds;
    expect(worlds).toHaveLength(1);
    const e = worlds[0];
    expect(e.id).toBe('w1');
    expect(e.cleared_at).toBeUndefined();
    expect(e.where).toBe('browser');
    expect(e.review_first_sync).toBe(true);
    expect(e.folder.handle_key).toBe(`world-${LOCAL_ID}`);
    expect(e.folder.folder_name).not.toBe(OLD_DIR);
    expect(e.folder.folder_name).toMatch(/^hollow-reach-0192a000-[0-9a-f]{4}$/);
    expect(e.api).toEqual(cleared().api);
    expect([...home()!.children.keys()]).toEqual([e.folder.folder_name]);
    // world.json: the entry's OWN id (not the server's), the link from the registry.
    const meta = await (getActiveStore() as unknown as MockFolderStore).readWorldMeta();
    expect(meta).toMatchObject({ id: LOCAL_ID, api: { world_id: SERVER_WORLD, api_key: 'k' } });
    expect(getState().active?.worldId).toBe('w1');
    expect(vi.mocked(attachSyncEngine)).toHaveBeenCalledTimes(1);
  });

  it('a world linked straight from the server keeps the server id as its own (a suffixed key included)', async () => {
    putRegistry({ ...defaultRegistry(), pin: '1234', worlds: [cleared({ folder: { handle_key: `world-${SERVER_WORLD}-2`, folder_name: OLD_DIR } })] });
    await bringDownAgain('w1');
    const meta = await (getActiveStore() as unknown as MockFolderStore).readWorldMeta();
    expect(meta.id).toBe(SERVER_WORLD);
    expect(getState().registry.worlds[0].folder.handle_key).toBe(`world-${SERVER_WORLD}-2`);
  });

  it('a server failure leaves the row cleared and no directory behind', async () => {
    mswServer.resetHandlers();
    await expect(bringDownAgain('w1')).rejects.toBeTruthy();
    expect(getState().registry.worlds).toEqual([cleared()]);
    expect([...home()!.children.keys()]).toEqual([]);
  });

  it('another tab restoring the same row meanwhile: nothing commits, this directory goes', async () => {
    let once = false;
    const onProgress = () => {
      if (once) return;
      once = true;
      // The other tab's save reaches storage before this tab hears of it.
      saveRegistry(updateEntry({ cleared_at: undefined, folder: { handle_key: `world-${LOCAL_ID}`, folder_name: 'hollow-reach-0192a000-beef' } }));
    };
    await expect(bringDownAgain('w1', { onProgress })).rejects.toThrow(/another tab/);
    expect([...home()!.children.keys()]).toEqual([]);
  });

  it('a refusal or a lost save leaves the world that was open still open, its store unclosed', async () => {
    const prior = new PriorStore();
    let closed = false;
    prior.close = async () => { closed = true; };
    setActiveStore(prior as never);
    patchSlice('active', { worldId: 'other', meta: { id: 'o', name: 'Other' }, opened: true });
    saveRegistry(updateEntry({ cleared_at: undefined }));   // another tab restored it first
    await expect(bringDownAgain('w1')).rejects.toThrow(/another tab/);
    expect(getActiveStore()).toBe(prior);
    expect(closed).toBe(false);

    putRegistry({ ...defaultRegistry(), pin: '1234', worlds: [cleared()] });
    const realSet = Storage.prototype.setItem;
    let fail = false;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (fail) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      return realSet.call(this, k, v);
    };
    try {
      fail = true;
      await expect(bringDownAgain('w1')).rejects.toThrow();
    } finally { Storage.prototype.setItem = realSet; }
    expect(getActiveStore()).toBe(prior);
    expect(closed).toBe(false);
    expect([...home()!.children.keys()]).toEqual([]);
    expect(getState().registry.worlds[0].cleared_at).toBeTruthy();
  });

  it('two brings of the same row at once in one tab: one restores, the other refuses, one directory', async () => {
    const results = await Promise.allSettled([bringDownAgain('w1'), bringDownAgain('w1')]);
    expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const e = getState().registry.worlds[0];
    expect([...home()!.children.keys()]).toEqual([e.folder.folder_name]);
  });

  it('another TAB bringing the same row down holds it: this one waits, sees it restored, writes nothing', async () => {
    const { locks, uninstall } = installFakeLocks();
    try {
      const release = await locks.hold('atlas-world:bring-w1');   // tab B is mid-restore
      const mine = bringDownAgain('w1');
      await new Promise(r => setTimeout(r, 30));
      expect([...home()!.children.keys()]).toEqual([]);          // waiting, not downloading
      saveRegistry(updateEntry({ cleared_at: undefined, folder: { handle_key: `world-${LOCAL_ID}`, folder_name: 'hollow-reach-0192a000-b0b0' } }));
      release();
      await expect(mine).rejects.toThrow(/no longer cleared/);
      expect([...home()!.children.keys()]).toEqual([]);
    } finally { uninstall(); }
  });

  it("the own id is the handle key's, read whole, except a link's -N suffix on the server id", () => {
    const f = (handle_key: string, world_id?: string) => ownWorldIdOf({ folder: { handle_key, folder_name: 'x' }, api: world_id ? { world_id, api_key: 'k' } : undefined } as WorldRegistryEntry);
    expect(f(`world-${LOCAL_ID}`, SERVER_WORLD)).toBe(LOCAL_ID);
    expect(f(`world-${SERVER_WORLD}-2`, SERVER_WORLD)).toBe(SERVER_WORLD);
    expect(f(`world-${LOCAL_ID}-7`, SERVER_WORLD)).toBe(`${LOCAL_ID}-7`);   // a file's id that ends in -7 stays itself
    expect(f('world-hollow-2')).toBe('hollow-2');
  });

  it('refuses a world that is not cleared, not linked, or the tour, writing nothing', async () => {
    for (const over of [{ cleared_at: undefined }, { api: undefined, state: 'local-only' as const }, { demo: true }]) {
      putRegistry({ ...defaultRegistry(), pin: '1234', worlds: [cleared(over)] });
      await expect(bringDownAgain('w1')).rejects.toThrow();
      expect([...home()!.children.keys()]).toEqual([]);
    }
  });

  it('with the PIN in this browser, sync starts: nothing waits', async () => {
    const out = await bringDownAgain('w1');
    expect(out.syncWaits).toBeNull();
  });

  // #200: the download only reads, and keel reads a prefixed key without its
  // PIN (core/auth.py rulings 1 and 2). The fake checks no PIN at all, so the
  // instrument here is the wire: no API-Pin header leaves, and the restore is
  // the same restore, its sync waiting on the PIN.
  it('a v2 write key without the PIN comes back anyway, sending no PIN, its sync waiting on it (#200)', async () => {
    const V2_KEY = 'ow_w_restorekey'.padEnd(37, 'k');
    putRegistry({ ...defaultRegistry(), worlds: [cleared({ api: { ...cleared().api!, api_key: V2_KEY } })] });
    const pins: (string | null)[] = [];
    mswServer.events.on('request:start', ({ request }) => { pins.push(request.headers.get('API-Pin')); });
    const out = await bringDownAgain('w1');
    mswServer.events.removeAllListeners();
    expect(out.downloaded).toBe(2);
    expect(out.syncWaits).toBe('pin');
    expect(pins.length).toBeGreaterThan(0);
    expect(pins.every(p => p === null)).toBe(true);
    const e = getState().registry.worlds[0];
    expect(e.cleared_at).toBeUndefined();
    expect(e.review_first_sync).toBe(true);
  });

  it('a seat world whose secret this browser lost comes back too, its sync waiting on the seat (#200)', async () => {
    const V2_KEY = 'ow_w_seatrestore'.padEnd(37, 'k');
    putRegistry({ ...defaultRegistry(), pin: '1234', worlds: [cleared({ api: { ...cleared().api!, api_key: V2_KEY, seat: { role: 'editor' } } })] });
    const out = await bringDownAgain('w1');
    expect(out.syncWaits).toBe('seat');
  });

  it('a legacy ten-digit key without the PIN asks for it first, writing nothing (keel reads a private world with it only with the PIN)', async () => {
    putRegistry({ ...defaultRegistry(), worlds: [cleared({ api: { ...cleared().api!, api_key: '4815162342' } })] });
    await expect(bringDownAgain('w1')).rejects.toThrow(/PIN/);
    expect([...home()!.children.keys()]).toEqual([]);
  });
});
