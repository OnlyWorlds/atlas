/**
 * Bringing an OnlyWorlds world down into browser storage (1.17 bout 2,
 * conv. 129; contract §2.2): `linkExistingApiWorldInRoot({ where: 'browser' })`.
 * The make holds its lock and `.atlas/making` until the registry save; a
 * cancel, a server failure or a full origin leaves no directory and no entry;
 * a full origin stops the download at the first refused write (S370 gate B8:
 * writing on past it leaves 0-byte files and wastes the whole list).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
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

import { linkExistingApiWorldInRoot, BROWSER_STORAGE_FULL } from '../../src/setup/atlas-root-flow';
import { DownloadCancelledError } from '../../src/sync/initial-download';
import { attachSyncEngine } from '../../src/sync/sync-attach';
import { storeHandle } from '../../src/store/handle-vault';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const SERVER_WORLD = '068e5012-d77c-799d-8000-95548fbae700';
let root: FakeDirHandle;
let server: OwV2ClientAdapter;
const home = () => root.children.get(BROWSER_HOME) as FakeDirHandle | undefined;

beforeEach(async () => {
  root = new FakeDirHandle('opfs');
  setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [] });
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(...statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next }).handlers);
  server = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: TEST_BASE });
  for (const name of ['Alice', 'Bob', 'Carol']) await server.createElement('character', { name });
  await server.createElement('location', { name: 'Keep' });
  vi.mocked(attachSyncEngine).mockClear();
  vi.mocked(storeHandle).mockClear();
});
afterEach(() => {
  setOpfsRootForTests(null);
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

const link = (over: Partial<Parameters<typeof linkExistingApiWorldInRoot>[0]> = {}) =>
  linkExistingApiWorldInRoot({
    where: 'browser',
    apiKey: 'k',
    apiPin: '1234',
    knownWorld: { id: SERVER_WORLD, name: 'Hollow Reach' },
    ...over,
  });

describe('linking a world into this browser', () => {
  it('lands every element in a nonced browser directory and registers it there', async () => {
    const result = await link();
    const entry = result.entry;
    expect(result.downloaded).toBe(4);
    expect(result.failures).toEqual([]);
    expect(entry.where).toBe('browser');
    expect(entry.state).toBe('api-linked');
    expect(entry.folder.handle_key).toBe(`world-${SERVER_WORLD}`);
    expect(entry.folder.folder_name).toMatch(new RegExp(`^hollow-reach-${SERVER_WORLD.slice(0, 8)}-[0-9a-f]{4}$`));
    expect(entry.folder.last_path_hint).toBe(`browser storage/${entry.folder.folder_name}`);
    // The directory is real, the make's marker is gone, no vault handle was stored.
    const dir = home()!.children.get(entry.folder.folder_name) as FakeDirHandle;
    expect(dir).toBeTruthy();
    expect(dir.get('.atlas/making')).toBeNull();
    expect(storeHandle).not.toHaveBeenCalled();
    // world.json carries the server id and the link; the store is active with every element.
    const store = getActiveStore() as unknown as MockFolderStore;
    const meta = await store.readWorldMeta();
    expect(meta.id).toBe(SERVER_WORLD);
    expect(meta.api?.world_id).toBe(SERVER_WORLD);
    expect((await store.listElements()).map(e => e.name).sort()).toEqual(['Alice', 'Bob', 'Carol', 'Keep']);
    expect(getState().active?.worldId).toBe(entry.id);
    expect(attachSyncEngine).toHaveBeenCalledTimes(1);
  });

  it('a view-only link lands view-only, with no PIN kept', async () => {
    const { entry } = await link({ readOnly: true, apiPin: '' });
    expect(entry.where).toBe('browser');
    expect(entry.api?.read_only).toBe(true);
    expect(getState().registry.pin ?? null).toBeNull();
  });

  it('Cancel link leaves no directory and no entry', async () => {
    let writes = 0;
    const real = MockFolderStore.prototype.applyServerRecord;
    vi.spyOn(MockFolderStore.prototype, 'applyServerRecord').mockImplementation(async function (this: MockFolderStore, ...args: Parameters<typeof real>) {
      writes++;
      return real.apply(this, args);
    });
    await expect(link({ shouldStop: () => (writes >= 1 ? 'cancel' : null) })).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(writes).toBe(1);
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
  });

  it('Stop and keep registers what arrived', async () => {
    let writes = 0;
    const real = MockFolderStore.prototype.applyServerRecord;
    vi.spyOn(MockFolderStore.prototype, 'applyServerRecord').mockImplementation(async function (this: MockFolderStore, ...args: Parameters<typeof real>) {
      writes++;
      return real.apply(this, args);
    });
    const result = await link({ shouldStop: () => (writes >= 2 ? 'finish' : null) });
    expect(result.stoppedEarly).toBeTruthy();
    expect(result.downloaded).toBe(2);
    expect(result.entry.where).toBe('browser');
    expect(home()!.children.has(result.entry.folder.folder_name)).toBe(true);
  });

  it('a server failure mid-download leaves nothing behind', async () => {
    vi.spyOn(OwV2ClientAdapter.prototype, 'listElements').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(link()).rejects.toBeTruthy();
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
  });

  it('a full origin is fatal at the first refused write: the sentence, nothing kept, nothing written after', async () => {
    let calls = 0;
    const real = MockFolderStore.prototype.applyServerRecord;
    vi.spyOn(MockFolderStore.prototype, 'applyServerRecord').mockImplementation(async function (this: MockFolderStore, ...args: Parameters<typeof real>) {
      if (++calls === 2) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return real.apply(this, args);
    });
    await expect(link()).rejects.toMatchObject({ name: 'PlainError', message: BROWSER_STORAGE_FULL('downloading the world') });
    expect(calls).toBe(2);
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
    expect(attachSyncEngine).not.toHaveBeenCalled();
  });
});
