/**
 * Linking a world into the home folder (`linkExistingApiWorldInRoot({ where: 'folder' })`): a failure
 * after the store opens and before the commit point closes the store, so its heartbeat and its Web Lock
 * end with the call. Left open, this page's own lock held the folder until the page closed, and opening
 * the same folder again here asked to take it over from another tab (1.125.1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: vi.fn(async () => {}),
  loadHandle: async (key: string) => (key === 'home-root' ? home : null),
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
const failWith = vi.hoisted(() => ({ download: null as Error | null, seed: null as Error | null }));
vi.mock('../../src/sync/initial-download', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/sync/initial-download')>();
  return {
    ...real,
    initialDownloadAll: async (...a: Parameters<typeof real.initialDownloadAll>) => {
      if (failWith.download) throw failWith.download;
      return real.initialDownloadAll(...a);
    },
    seedLinkedWorldMeta: async (...a: Parameters<typeof real.seedLinkedWorldMeta>) => {
      if (failWith.seed) throw failWith.seed;
      return real.seedLinkedWorldMeta(...a);
    },
  };
});

import { linkExistingApiWorldInRoot } from '../../src/setup/atlas-root-flow';
import { DownloadCancelledError } from '../../src/sync/initial-download';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const SERVER_WORLD = '068e5012-d77c-799d-8000-95548fbae700';
let opened: MockFolderStore[] = [];

beforeEach(() => {
  failWith.download = null;
  failWith.seed = null;
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
    failWith.download = new Error('list failed');
    await expect(link()).rejects.toThrow('list failed');
    expect(opened.length).toBe(1);
    expect(opened[0].__debug_isOpen()).toBe(false);
  });

  it('a failure fetching the world\'s settings closes the store it opened', async () => {
    failWith.seed = new Error('settings failed');
    await expect(link()).rejects.toThrow('settings failed');
    expect(opened.length).toBe(1);
    expect(opened[0].__debug_isOpen()).toBe(false);
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
