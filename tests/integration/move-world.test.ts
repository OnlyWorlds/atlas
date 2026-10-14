/**
 * Move to a folder (1.17 bout 4, contract §4, §9 invariants 4-8; S370 gate
 * lens A runway: the crash matrix, the token, the lock holder, 5a; lens B
 * B3-B5, B26). The REAL FsFolderStore on fake-fs: the browser home and the
 * drive are two fake trees, the world is open in this tab.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { getActiveStore, setActiveStore } from '../../src/core/active-store';
import { FakeDirHandle, FakeFileHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { ELockHeld, FsFolderStore } from '../../src/store/folder-store-fs';
import { installFakeLocks, type FakeLocks } from '../fixtures/fake-locks';

const vault = vi.hoisted(() => ({
  puts: [] as string[],
  deletes: [] as string[],
  writable: true,
  failPut: false,
  root: null as unknown,
}));
vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async (key: string) => { if (vault.failPut) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); vault.puts.push(key); },
  deleteHandle: async (key: string) => { vault.deletes.push(key); },
  loadHandle: async () => vault.root,
  queryWritable: async () => vault.writable,
  ensureWritable: async () => vault.writable,
}));
const sync = vi.hoisted(() => ({ worldId: null as string | null, holds: [] as string[], releases: 0, attached: [] as unknown[] }));
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncWorldId: () => sync.worldId,
  getCurrentSyncEngine: () => ({ hold: async (r: string) => { sync.holds.push(r); return () => { sync.releases++; }; } }),
  attachSyncEngine: (entry: unknown, store: unknown, opts?: unknown) => { sync.attached.push({ entry, store, opts }); return null; },
  detachSyncEngine: () => {},
}));
vi.mock('../../src/sync/rekey-run', () => ({
  isRekeyRunning: () => false,
  withIdMoveLock: <T>(work: () => Promise<T>) => work(),
}));

import { moveBrowserWorldToFolder, recoverBrowserMove } from '../../src/setup/browser-world-move';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const asDir = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;
const DIR = 'hollow-reach-0192a000-1a2b';
const WORLD_ID = '0192a000-aaaa-7bbb-8ccc-000000000001';
const TO = 'hollow-reach-0192a000';

let opfs: FakeDirHandle;
let home: FakeDirHandle;   // browser-worlds/
let drive: FakeDirHandle;  // the home folder on the drive
let source: FsFolderStore;
let webLocks: FakeLocks;
let uninstallLocks: () => void;

function entry(over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return {
    id: 'w1', name: 'Hollow Reach', state: 'local-only', where: 'browser', created_at: '2026-10-05T00:00:00.000Z',
    folder: { handle_key: `world-${WORLD_ID}`, folder_name: DIR, last_path_hint: `browser storage/${DIR}` },
    ...over,
  };
}
const cur = () => getState().registry.worlds.find(w => w.id === 'w1')!;
const browserDir = () => home.children.get(DIR) as FakeDirHandle | undefined;
/** Every file of the world as bytes, transient ones left out. */
const snapshot = (d: FakeDirHandle | undefined) =>
  Object.fromEntries((d?.list() ?? []).filter(p => !/^\.atlas\/(lock|making|move[^/]*\.json)$/.test(p)).map(p => [p, d!.get(p)]));

async function setup(over: Partial<WorldRegistryEntry> = {}): Promise<void> {
  opfs = new FakeDirHandle('opfs');
  home = await opfs.getDirectoryHandle(BROWSER_HOME, { create: true });
  drive = new FakeDirHandle('OnlyWorlds');
  vault.root = drive;
  const d = await home.getDirectoryHandle(DIR, { create: true });
  d.put('world.json', j({ id: WORLD_ID, name: 'Hollow Reach' }));
  d.put('media/map.png', 'PNGBYTES');
  d.put('.atlas/charts.json', '[]');
  setOpfsRootForTests(async () => asDir(opfs));
  source = new FsFolderStore({ tabId: 'tab-a', disableHeartbeat: true });
  await source.open(asDir(d));
  await source.createElement('character', { name: 'Ana' } as never);
  await source.createElement('location', { name: 'The Reach' } as never);
  setActiveStore(source);
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry(over)] });
  patchSlice('active', { worldId: 'w1', meta: { id: WORLD_ID, name: 'Hollow Reach' }, opened: true } as never);
}

const move = () => moveBrowserWorldToFolder(cur(), { home: asDir(drive), homeHint: 'OnlyWorlds' });

beforeEach(async () => {
  ({ locks: webLocks, uninstall: uninstallLocks } = installFakeLocks());
  vault.puts = []; vault.deletes = []; vault.writable = true; vault.failPut = false;
  sync.worldId = null; sync.holds = []; sync.releases = 0; sync.attached = [];
  await setup();
});
afterEach(async () => {
  const s = getActiveStore();
  if (s && s !== source) await s.close().catch(() => {});
  await source.close().catch(() => {});
  setActiveStore(null);
  setOpfsRootForTests(null);
  patchSlice('active', null);
  uninstallLocks();
  vi.restoreAllMocks();
});

describe('moving a browser world to a folder', () => {
  it('the folder holds the world byte for byte; the registry, the vault and the store follow; the browser copy is gone', async () => {
    const before = snapshot(browserDir());
    const out = await move();
    expect(out).toMatchObject({ ok: true, folderName: TO, leftBrowserCopy: false });
    const dest = drive.children.get(TO) as FakeDirHandle;
    expect(snapshot(dest)).toEqual(before);                                    // invariant 4
    expect(dest.list().filter(p => /\.atlas\/move[^/]*\.json$/.test(p))).toEqual([]); // no move file left
    expect(cur()).toMatchObject({ folder: { folder_name: TO, last_path_hint: `OnlyWorlds/${TO}` } });
    expect(cur().where).toBeUndefined();
    expect(cur().move).toBeUndefined();
    expect(cur().moved_from).toBeUndefined();
    expect(vault.puts).toEqual([`world-${WORLD_ID}`]);                          // the world's own key (gate A8)
    expect(browserDir()).toBeUndefined();
    const now = getActiveStore()!;
    expect(now).not.toBe(source);
    expect((await now.listElements()).map(e => e.name).sort()).toEqual(['Ana', 'The Reach']);
    await now.createElement('character', { name: 'Bel' } as never);            // the folder takes edits
    expect(dest.list().some(p => p.startsWith('elements/character/bel--'))).toBe(true);
  });

  it('saves the journal before the folder exists on the drive (gate B26)', async () => {
    let journalAtCreate: unknown = 'never created';
    const real = drive.getDirectoryHandle.bind(drive);
    drive.getDirectoryHandle = async (name: string, opts?: { create?: boolean }) => {
      if (opts?.create) journalAtCreate = cur().move;
      return real(name, opts);
    };
    await move();
    expect(journalAtCreate).toMatchObject({ to_folder_name: TO });
  });

  it('never moves into a folder that exists: an unrelated world with the same name is left whole', async () => {
    drive.put(`${TO}/world.json`, j({ id: 'someone-else', name: 'Hollow Reach' }));
    const out = await move();
    expect(out).toMatchObject({ ok: true, folderName: `${TO}-2` });
    expect(drive.get(`${TO}/world.json`)).toBe(j({ id: 'someone-else', name: 'Hollow Reach' }));
  });

  it('a linked world is held for the move and its sync follows the folder', async () => {
    await setup({ state: 'api-linked', api: { world_id: 'srv-1', api_key: 'k' } });
    sync.worldId = 'w1';
    await move();
    expect(sync.holds).toEqual(['move']);
    expect(sync.releases).toBe(1);
    expect(sync.attached).toHaveLength(1);
    expect((sync.attached[0] as { store: unknown }).store).toBe(getActiveStore());
    expect((sync.attached[0] as { entry: WorldRegistryEntry }).entry.where).toBeUndefined();
    // What waits is the user's own editing in the browser: never held as "changed on disk" (gate F7).
    expect((sync.attached[0] as { opts?: { justMoved?: boolean } }).opts?.justMoved).toBe(true);
  });

  it("holds the world's Web Lock from the journal to the removal, so no other tab recovers or opens it meanwhile (gate F1)", async () => {
    const seen: boolean[] = [];
    const realGet = drive.getDirectoryHandle.bind(drive);
    drive.getDirectoryHandle = async (name: string, opts?: { create?: boolean }) => {
      seen.push(webLocks.isHeld(`atlas-world:${DIR}`));
      return realGet(name, opts);
    };
    const realRemove = home.removeEntry.bind(home);
    home.removeEntry = async (name: string, opts?: { recursive?: boolean }) => {
      seen.push(webLocks.isHeld(`atlas-world:${DIR}`));
      return realRemove(name, opts);
    };
    await move();
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every(Boolean)).toBe(true);
    expect(webLocks.isHeld(`atlas-world:${DIR}`)).toBe(false);
  });

  it('a commit whose registry save fails is no commit: the browser copy stays the world (gate F4)', async () => {
    const before = snapshot(browserDir());
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, v: string) {
      if (v.includes('"moved_from"')) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      return realSet.call(this, k, v);
    });
    const out = await move();
    expect(out.ok).toBe(false);
    expect(snapshot(browserDir())).toEqual(before);
    expect(drive.children.has(TO)).toBe(false);
    expect(cur().where).toBe('browser');
    expect(getActiveStore()).toBe(source);
  });

  it('an earlier move that never committed is resolved by the next Move click, not left beside it (gate F5)', async () => {
    await setup({ move: { move_id: 'old', to_folder_name: TO, started_at: '2026-10-05T00:00:00.000Z' } });
    drive.put(`${TO}/.atlas/move-incoming.json`, j({ move_id: 'old' }));
    drive.put(`${TO}/world.json`, j({ id: WORLD_ID, name: 'Hollow Reach' }));
    const out = await move();
    expect(out).toMatchObject({ ok: true, folderName: TO });
    expect(drive.children.has(`${TO}-2`)).toBe(false);
  });

  it('a folder that appears under the chosen name before the copy is never written into (gate F10)', async () => {
    const realGet = drive.getDirectoryHandle.bind(drive);
    drive.getDirectoryHandle = async (name: string, opts?: { create?: boolean }) => {
      if (opts?.create && name === TO && !drive.children.has(TO)) drive.put(`${TO}/notes.md`, 'someone else');
      return realGet(name, opts);
    };
    const out = await move();
    expect(out.ok).toBe(false);
    expect(drive.list()).toEqual([`${TO}/notes.md`]);
    expect(cur().move).toBeUndefined();
    expect(cur().where).toBe('browser');
  });

  it('another tab cannot open the browser copy while it is copied (invariant 7)', async () => {
    let tabB: unknown = 'not tried';
    const realCreate = FakeFileHandle.prototype.createWritable;
    let fired = false;
    FakeFileHandle.prototype.createWritable = async function (this: FakeFileHandle, o?: { keepExistingData?: boolean }) {
      if (!fired && this.name === 'map.png') {
        fired = true;
        const b = new FsFolderStore({ tabId: 'tab-b', disableHeartbeat: true, forceTakeLock: true });
        tabB = await b.open(asDir(browserDir()!)).then(() => 'opened', e => e);
      }
      return realCreate.call(this, o);
    };
    try { await move(); } finally { FakeFileHandle.prototype.createWritable = realCreate; }
    expect(tabB).toBeInstanceOf(ELockHeld);
    expect((tabB as ELockHeld).moving).toBe(true);
  });

  it('refuses the tour world and a world with an unfinished id update, touching nothing', async () => {
    await setup({ demo: true });
    await expect(move()).rejects.toThrow(/tour world/);
    await setup();
    browserDir()!.put('.atlas/rekey-journal.json', j({ version: 1, pairs: [] }));
    await expect(move()).rejects.toThrow(/id update/);
    expect(drive.list()).toEqual([]);
    expect(cur().move).toBeUndefined();
  });
});

describe('the crash matrix: a failure before the commit changes nothing (invariant 5)', () => {
  async function failAtWrite(k: number): Promise<{ out: Awaited<ReturnType<typeof move>>; before: Record<string, string | null> }> {
    const before = snapshot(browserDir());
    const realCreate = FakeFileHandle.prototype.createWritable;
    let n = 0;
    const destFiles = new Set<FakeFileHandle>();
    const realGet = FakeDirHandle.prototype.getFileHandle;
    FakeDirHandle.prototype.getFileHandle = async function (this: FakeDirHandle, name: string, o?: { create?: boolean }) {
      const h = await realGet.call(this, name, o);
      if (o?.create && isUnder(this, drive)) destFiles.add(h);
      return h;
    };
    FakeFileHandle.prototype.createWritable = async function (this: FakeFileHandle, o?: { keepExistingData?: boolean }) {
      if (destFiles.has(this) && ++n === k) throw Object.assign(new Error('disk full'), { name: 'QuotaExceededError' });
      return realCreate.call(this, o);
    };
    try {
      return { out: await move(), before };
    } finally {
      FakeFileHandle.prototype.createWritable = realCreate;
      FakeDirHandle.prototype.getFileHandle = realGet;
    }
  }

  // Two rows below wait out a removal's real busy backoff (100 + 250 + 500 +
  // 1000 ms, REMOVE_RETRY_MS in browser-world-move.ts and browser-worlds.ts):
  // about 1.9 s alone, past 15 s once in a loaded full run (Boss, h11 #4238).
  // The wait is the code's own, not work, so the limit is wide.
  const BACKOFF_TIMEOUT_MS = 30_000;

  it('a throw at every write of the copy', async () => {
    const total = snapshot(browserDir());
    const writes = Object.keys(total).length + 1; // + the token
    for (let k = 1; k <= writes; k++) {
      await setup();
      const { out, before } = await failAtWrite(k);
      expect(out.ok, `write ${k}`).toBe(false);
      expect(drive.children.has(TO), `write ${k}: the unfinished folder is gone`).toBe(false);
      expect(cur().where).toBe('browser');
      expect(cur().move).toBeUndefined();
      expect(cur().folder.folder_name).toBe(DIR);
      expect(snapshot(browserDir())).toEqual(before);
      expect(getActiveStore()).toBe(source);
      // The source takes edits again, and its lock is an ordinary one.
      await expect(source.createElement('character', { name: `after ${k}` } as never)).resolves.toBeTruthy();
      expect((await source.__debug_readLock())?.moving).toBeUndefined();
    }
  });

  it('a destination that cannot be removed keeps the journal, so recovery finishes it (gate F6)', async () => {
    vault.failPut = true;
    const realRemove = drive.removeEntry.bind(drive);
    drive.removeEntry = async () => { throw Object.assign(new Error('held'), { name: 'NoModificationAllowedError' }); };
    const out = await move();
    expect(out.ok).toBe(false);
    expect(drive.children.has(TO)).toBe(true);
    expect(cur().move).toMatchObject({ to_folder_name: TO });
    drive.removeEntry = realRemove;
    expect(await recoverBrowserMove('w1')).toBe('undone');
    expect(drive.children.has(TO)).toBe(false);
    expect(cur().move).toBeUndefined();
  }, BACKOFF_TIMEOUT_MS);

  it('a throw storing the folder handle (5b) removes the folder and forgets the handle', async () => {
    vault.failPut = true;
    const before = snapshot(browserDir());
    const out = await move();
    expect(out.ok).toBe(false);
    expect(drive.children.has(TO)).toBe(false);
    expect(cur().where).toBe('browser');
    expect(snapshot(browserDir())).toEqual(before);
  });

  it('a held writable at the browser copy\'s removal (step 7) leaves moved_from, and recovery finishes it', async () => {
    const realRemove = home.removeEntry.bind(home);
    home.removeEntry = async () => { throw Object.assign(new Error('busy'), { name: 'NoModificationAllowedError' }); };
    const out = await move();
    expect(out).toMatchObject({ ok: true, leftBrowserCopy: true });
    expect(cur().where).toBeUndefined();
    expect(cur().moved_from).toBe(DIR);
    expect(browserDir()).toBeDefined();
    home.removeEntry = realRemove;
    expect(await recoverBrowserMove('w1')).toBe('finished');
    expect(browserDir()).toBeUndefined();
    expect(cur().moved_from).toBeUndefined();
  }, BACKOFF_TIMEOUT_MS);
});

describe('recovery', () => {
  const journal = { move_id: 'm-1', to_folder_name: TO, started_at: '2026-10-05T00:00:00.000Z' };

  it('before the commit: removes the folder that carries this move\'s token, then the journal', async () => {
    await setup({ move: journal });
    drive.put(`${TO}/.atlas/move-incoming.json`, j({ move_id: 'm-1' }));
    drive.put(`${TO}/elements/character/ana.json`, '{}');
    expect(await recoverBrowserMove('w1')).toBe('undone');
    expect(drive.children.has(TO)).toBe(false);
    expect(cur().move).toBeUndefined();
    expect(cur().where).toBe('browser');
  });

  it('never removes a folder without the matching token: a zip-borne or older journal cannot delete a user\'s world (gate A1)', async () => {
    await setup({ move: journal });
    drive.put(`${TO}/world.json`, j({ id: WORLD_ID, name: 'Hollow Reach' }));        // the user's real folder, edited since
    drive.put(`${TO}/.atlas/move-incoming.json`, j({ move_id: 'some-other-move' }));
    expect(await recoverBrowserMove('w1')).toBe('undone');
    expect(drive.get(`${TO}/world.json`)).toBe(j({ id: WORLD_ID, name: 'Hollow Reach' }));
    expect(cur().move).toBeUndefined();
  });

  it('without the home folder\'s permission it waits, touching nothing', async () => {
    await setup({ move: journal });
    drive.put(`${TO}/.atlas/move-incoming.json`, j({ move_id: 'm-1' }));
    vault.writable = false;
    expect(await recoverBrowserMove('w1')).toBe('waiting');
    expect(drive.children.has(TO)).toBe(true);
    expect(cur().move).toEqual(journal);
  });

  it('while another tab is moving the world it waits (its lock is fresh, moving, not ours)', async () => {
    await setup({ move: journal });
    drive.put(`${TO}/.atlas/move-incoming.json`, j({ move_id: 'm-1' }));
    const now = new Date().toISOString();
    browserDir()!.put('.atlas/lock', j({ tab_id: 'tab-b', started_at: now, last_heartbeat: now, moving: true }));
    expect(await recoverBrowserMove('w1')).toBe('waiting');
    expect(drive.children.has(TO)).toBe(true);
  });

  it("while another tab holds the world's Web Lock (a live move, before its lock file says so) it waits (gate F1)", async () => {
    await setup({ move: journal });
    drive.put(`${TO}/.atlas/move-incoming.json`, j({ move_id: 'm-1' }));
    const release = await webLocks.hold(`atlas-world:${DIR}`);
    expect(await recoverBrowserMove('w1')).toBe('waiting');
    expect(drive.children.has(TO)).toBe(true);
    expect(cur().move).toEqual(journal);
    release();
  });

  it('a source lock that cannot be read means waiting, never "not moving" (gate F1, fail closed)', async () => {
    await setup({ move: journal });
    drive.put(`${TO}/.atlas/move-incoming.json`, j({ move_id: 'm-1' }));
    browserDir()!.put('.atlas/lock', '{ not json');
    expect(await recoverBrowserMove('w1')).toBe('waiting');
    expect(drive.children.has(TO)).toBe(true);
  });

  it('after the commit: removes only the browser directory the commit named', async () => {
    await setup({ where: undefined, moved_from: DIR, folder: { handle_key: `world-${WORLD_ID}`, folder_name: TO } });
    await home.getDirectoryHandle('another-world-0192b000-ffff', { create: true });
    expect(await recoverBrowserMove('w1')).toBe('finished');
    expect(browserDir()).toBeUndefined();
    expect(home.children.has('another-world-0192b000-ffff')).toBe(true);
    expect(cur().moved_from).toBeUndefined();
  });
});

function isUnder(d: FakeDirHandle, root: FakeDirHandle): boolean {
  if (d === root) return true;
  for (const c of root.children.values()) if (c.kind === 'directory' && isUnder(d, c as FakeDirHandle)) return true;
  return false;
}
