/**
 * Linking a world into the home folder (`linkExistingApiWorldInRoot({ where: 'folder' })`): a failure
 * after the store opens and before the commit point closes the store, so its heartbeat and its Web Lock
 * end with the call. Left open, this page's own lock held the folder until the page closed, and opening
 * the same folder again here asked to take it over from another tab (1.125.1). The store here is the
 * mock, whose close only marks it closed: what close releases is `FsFolderStore`'s own suite's. A list
 * failure is played by the mock server; a cancel by a stand-in for the download, which only a press makes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

const TEST_BASE = 'https://test-ow.local/api/v2';
const home = new FakeDirHandle('OnlyWorlds');
const SERVER_ERROR = () => HttpResponse.json({ error: { type: 'api_error', code: 'server_error', message: 'boom' } }, { status: 500 });

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: vi.fn(async () => {}),
  loadHandle: async (key: string) => (key === 'home-root' ? home : null),
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: vi.fn(async () => {}),
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
const failWith = vi.hoisted(() => ({ download: null as Error | null }));
vi.mock('../../src/sync/initial-download', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/sync/initial-download')>();
  return {
    ...real,
    initialDownloadAll: async (...a: Parameters<typeof real.initialDownloadAll>) => {
      if (failWith.download) throw failWith.download;
      return real.initialDownloadAll(...a);
    },
  };
});

import { linkExistingApiWorldInRoot } from '../../src/setup/atlas-root-flow';
import { DownloadCancelledError } from '../../src/sync/initial-download';
import { downloadNoPin, leftSomethingBehind } from '../../src/core/problems';
import { deleteHandle } from '../../src/store/handle-vault';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const SERVER_WORLD = '068e5012-d77c-799d-8000-95548fbae700';
let opened: MockFolderStore[] = [];

beforeEach(async () => {
  failWith.download = null;
  opened = [];
  home.children.clear();
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', {
    ...defaultRegistry(), worlds: [],
    atlas_root: { handle_key: 'home-root', folder_name: 'OnlyWorlds', set_at: '2026-01-01T00:00:00.000Z' },
  });
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(...statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next }).handlers);
  const server = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: TEST_BASE });
  await server.createElement('character', { name: 'Alice' });
  const realOpen = MockFolderStore.prototype.open;
  vi.spyOn(MockFolderStore.prototype, 'open').mockImplementation(async function (this: MockFolderStore, h) {
    opened.push(this);
    return realOpen.call(this, h);
  });
});
afterEach(() => {
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

const link = () => linkExistingApiWorldInRoot({
  where: 'folder', apiKey: 'k', apiPin: '1234', knownWorld: { id: SERVER_WORLD, name: 'Hollow Reach' },
});

describe('a folder link that fails before its commit point', () => {
  it('a list that fails mid-download closes the store it opened', async () => {
    mswServer.use(http.get(`${TEST_BASE}/character`, SERVER_ERROR));
    await expect(link()).rejects.toThrow();
    expect(opened.length).toBe(1);
    expect(opened[0].__debug_isOpen()).toBe(false);
    // Nothing kept: the folder it made is gone, as a cancel's is (1.125.10).
    expect([...home.children.keys()]).toEqual([]);
  });

  it('a world.json that cannot be written closes the store it opened', async () => {
    vi.spyOn(MockFolderStore.prototype, 'writeWorldMeta').mockRejectedValueOnce(new Error('disk full'));
    await expect(link()).rejects.toThrow('disk full');
    expect(opened.length).toBe(1);
    expect(opened[0].__debug_isOpen()).toBe(false);
    expect([...home.children.keys()]).toEqual([]);
  });

  it('a store that will not open (another tab\'s lock after a race on the name) leaves the folder, and says so', async () => {
    vi.spyOn(MockFolderStore.prototype, 'open').mockRejectedValueOnce(new Error('the open failed'));
    const err = await link().catch((e: unknown) => e);
    expect(String(err)).toContain('the open failed');
    // Not opened under this call's lock, so not shown to be its own: it stays, and the line may not say nothing changed.
    expect(home.children.size).toBe(1);
    expect(downloadNoPin(err)).toBe('may-have-left');
    // Nor its vault key: in a race on the name it can be the other tab's.
    expect(vi.mocked(deleteHandle)).not.toHaveBeenCalled();
  });

  it('a cancel whose folder cannot be removed is marked, so its line does not say nothing was kept', async () => {
    failWith.download = new DownloadCancelledError();
    vi.spyOn(home, 'removeEntry').mockRejectedValueOnce(new Error('a cloud sync app holds a file'));
    const err = await link().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DownloadCancelledError);
    expect(leftSomethingBehind(err)).toBe(true);
  });

  it('a folder that cannot be removed stays, and says so', async () => {
    failWith.download = new Error('boom');
    vi.spyOn(home, 'removeEntry').mockRejectedValueOnce(new Error('a cloud sync app holds a file'));
    const err = await link().catch((e: unknown) => e);
    expect(String(err)).toContain('boom');
    expect(home.children.size).toBe(1);
    expect(downloadNoPin(err)).toBe('may-have-left');
  });

  it('a failure whose folder is removed keeps nothing, and the line may say so', async () => {
    failWith.download = new Error('boom');
    const err = await link().catch((e: unknown) => e);
    expect(home.children.size).toBe(0);
    expect(downloadNoPin(err)).toBe(true);
  });

  it('a failed read of the world\'s settings is no failure: the link commits and its store stays open', async () => {
    mswServer.use(http.get(`${TEST_BASE}/world`, SERVER_ERROR));
    await link();
    expect(opened.length).toBe(1);
    expect(opened[0].__debug_isOpen()).toBe(true);
  });

  it('a cancel still closes the store and leaves no folder (the path it always had)', async () => {
    failWith.download = new DownloadCancelledError();
    await expect(link()).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(opened[0].__debug_isOpen()).toBe(false);
    expect([...home.children.keys()]).toEqual([]);
  });

  it('a link that succeeds keeps its store open (the control)', async () => {
    await link();
    expect(opened.length).toBe(1);
    expect(opened[0].__debug_isOpen()).toBe(true);
  });
});
