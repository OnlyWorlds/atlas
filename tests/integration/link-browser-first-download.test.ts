/**
 * The browser link door on the REAL store and the real first download
 * (`setup/browser-first-download.ts`, 1.98.1), over a fake OPFS: what lands,
 * a cancel in the landing, a full origin in the landing, an open that fails
 * after it, Stop and keep before it, and the world that was open kept until
 * the commit. The suites on `MockFolderStore` cannot see the landing or the
 * cold open (the 1.98.1 code gate's S2; its door probe, kept).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, getActiveStore } from '../../src/core/active-store';
import { FakeDirHandle, FakeFileHandle } from '../fixtures/fake-fs';
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
vi.mock('../../src/sync/make-online', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/make-online')>()),
  buildV2Adapter: (apiKey: string, apiPin: string) => new OwV2ClientAdapter({ apiKey, apiPin, baseUrl: TEST_BASE }),
}));
vi.mock('../../src/sync/sync-attach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/sync-attach')>()),
  attachSyncEngine: vi.fn(),
}));

import { linkExistingApiWorldInRoot, BROWSER_STORAGE_FULL } from '../../src/setup/atlas-root-flow';
import { DownloadCancelledError, type DownloadStop, type InitialDownloadProgress } from '../../src/sync/initial-download';
import { FsFolderStore } from '../../src/store/folder-store-fs';

const SERVER_WORLD = '068e5012-d77c-799d-8000-95548fbae700';
let root: FakeDirHandle;
const home = () => root.children.get(BROWSER_HOME) as FakeDirHandle | undefined;
const files = (d: FakeDirHandle, p = ''): string[] => [...d.children.entries()].flatMap(([n, c]) =>
  c.kind === 'directory' ? files(c as FakeDirHandle, `${p}${n}/`) : [`${p}${n}`]);
const priorStore = () => ({ close: vi.fn(async () => {}), flushPending: async () => {} });

beforeEach(async () => {
  root = new FakeDirHandle('opfs');
  setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [] });
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(...statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next }).handlers);
  const server = new OwV2ClientAdapter({ apiKey: 'k', apiPin: '1234', baseUrl: TEST_BASE });
  for (const name of ['Alice', 'Bob', 'Carol', 'Dan', 'Eve']) await server.createElement('character', { name });
  await server.createElement('location', { name: 'Keep' });
});
afterEach(() => {
  setOpfsRootForTests(null);
  mswServer.resetHandlers();
  vi.restoreAllMocks();
  const s = getActiveStore();
  if (s) void s.close().catch(() => {});
});

const link = (over: Partial<Parameters<typeof linkExistingApiWorldInRoot>[0]> = {}) =>
  linkExistingApiWorldInRoot({ where: 'browser', apiKey: 'k', apiPin: '1234', knownWorld: { id: SERVER_WORLD, name: 'Hollow Reach' }, ...over });

describe('the browser link door, its first download landed once', () => {
  it('lands, registers and lists every element; the landing and the cold open each report', async () => {
    const seen: InitialDownloadProgress[] = [];
    const r = await link({ onProgress: p => seen.push({ ...p }) });
    expect(r.downloaded).toBe(6);
    expect(getState().registry.worlds).toHaveLength(1);
    expect(getState().data.elements).toHaveLength(6);
    const f = files(home()!.children.get(r.entry.folder.folder_name) as FakeDirHandle);
    expect(f).toContain('world.json');
    expect(f).not.toContain('.atlas/making');
    const land = seen.filter(p => p.phase === 'land');
    expect(land[land.length - 1].done).toBe(land[land.length - 1].total);
    expect(seen.some(p => p.phase === 'open')).toBe(true);
    // The phases arrive in order: no download report after the landing began.
    const firstLand = seen.findIndex(p => p.phase === 'land');
    expect(seen.slice(firstLand).every(p => p.phase === 'land' || p.phase === 'open')).toBe(true);
  });

  it('a cancel in the landing: DownloadCancelledError, no directory, no row', async () => {
    let stop: DownloadStop = null;
    await expect(link({
      onProgress: p => { if (p.phase === 'land' && p.done >= 2) stop = 'cancel'; },
      shouldStop: () => stop,
    })).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
  });

  it('a full origin in the landing: the sentence, nothing kept', async () => {
    let landing = false;
    let n = 0;
    const real = FakeFileHandle.prototype.createWritable;
    vi.spyOn(FakeFileHandle.prototype, 'createWritable').mockImplementation(async function (this: FakeFileHandle, ...a: unknown[]) {
      if (landing && ++n === 3) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      return real.apply(this, a as never);
    });
    await expect(link({ onProgress: p => { if (p.phase === 'write' && p.done === p.total) landing = true; } }))
      .rejects.toMatchObject({ name: 'PlainError', message: BROWSER_STORAGE_FULL('downloading the world') });
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
  });

  it('an open that fails after the landing: abandoned, nothing kept, the world that was open untouched', async () => {
    const prior = priorStore();
    setActiveStore(prior as never);
    let opens = 0;
    const real = FsFolderStore.prototype.open;
    vi.spyOn(FsFolderStore.prototype, 'open').mockImplementation(async function (this: FsFolderStore, h: FileSystemDirectoryHandle | null) {
      if (++opens === 2) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      return real.call(this, h);
    });
    await expect(link()).rejects.toMatchObject({ message: BROWSER_STORAGE_FULL('downloading the world') });
    expect(opens).toBe(2); // the scratch's, then the world's own
    expect(getState().registry.worlds).toHaveLength(0);
    expect(home()?.children.size ?? 0).toBe(0);
    expect(getActiveStore()).toBe(prior);
    expect(prior.close).not.toHaveBeenCalled();
    setActiveStore(null);
  });

  it('Stop and keep in the download, then the landing: what arrived is kept, and the saving still reports', async () => {
    let stop: DownloadStop = null;
    const seen: string[] = [];
    const r = await link({
      onProgress: p => { seen.push(p.phase); if (p.phase === 'write' && p.done === 2) stop = 'finish'; },
      shouldStop: () => stop,
    });
    expect(r.stoppedEarly).toBeTruthy();
    expect(r.downloaded).toBe(2);
    expect(getState().data.elements).toHaveLength(2);
    expect(seen).toContain('land');
  });

  it('the world that was open stays the active store through the whole landing, released after', async () => {
    const prior = priorStore();
    setActiveStore(prior as never);
    const atLand: boolean[] = [];
    await link({ onProgress: p => { if (p.phase === 'land') atLand.push(getActiveStore() === (prior as never) && prior.close.mock.calls.length === 0); } });
    expect(atLand.length).toBeGreaterThan(0);
    expect(atLand.every(Boolean)).toBe(true);
    expect(prior.close).toHaveBeenCalled();
  });
});
