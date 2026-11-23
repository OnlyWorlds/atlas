/**
 * The registry's landed copy (`src/registry/registry-copy.ts`): a kill of the
 * browser seconds after a save loses the `localStorage` write, while a
 * finished IndexedDB write survives it. Every save leaves a copy in its own
 * database, numbered inside the registry JSON (`saved_seq`); the boot puts
 * the copy back only when it is newer than what `localStorage` gave back, no
 * other Atlas tab is live, and the read finished inside its bounds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REGISTRY_COPY_DB, REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { loadRegistry, saveRegistry, __setRegistryTabBaseForTests } from '../../src/registry/registry';
import {
  __resetRegistryCopyForTests,
  registryCopyLanded,
  restoreRegistryAtBoot,
  stopRegistryCopyWrites,
  resumeRegistryCopyWrites,
  writeRegistryCopy,
  type RestoreLocks,
} from '../../src/registry/registry-copy';
import { FORGET_PARTIAL_LINE, forgetEverything } from '../../src/setup/forget-browser';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { patchSlice } from '../../src/core/state';
import { toastManager } from '../../src/ui/toast-manager';

vi.mock('../../src/ui/toast-manager', () => ({
  toastManager: { show: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ToastManager: class {},
}));

const STORE = 'copy';
const RECORD = 'registry';

const entry = (id: string): WorldRegistryEntry => ({
  id, name: `World ${id}`, state: 'local-only', created_at: '2026-01-01T00:00:00.000Z',
  folder: { handle_key: `world-${id}`, folder_name: id },
} as WorldRegistryEntry);

const regJson = (seq: number | undefined, ids: string[]): string =>
  JSON.stringify({ version: 1, worlds: ids.map(entry), ...(seq === undefined ? {} : { saved_seq: seq }) });

function openCopy(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(REGISTRY_COPY_DB, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function copyRecord(): Promise<{ saved_seq: number; registry: string } | undefined> {
  if (!((await indexedDB.databases()) ?? []).some(d => d.name === REGISTRY_COPY_DB)) return undefined;
  const db = await openCopy();
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD);
      req.onsuccess = () => resolve(req.result as { saved_seq: number; registry: string } | undefined);
      req.onerror = () => reject(req.error);
    });
  } finally { db.close(); }
}

async function seedCopy(registry: string, seq: number): Promise<void> {
  const db = await openCopy();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ saved_seq: seq, registry }, RECORD);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}

const dropCopy = (): Promise<void> => new Promise(resolve => {
  const req = indexedDB.deleteDatabase(REGISTRY_COPY_DB);
  req.onsuccess = () => resolve();
  req.onerror = () => resolve();
  req.onblocked = () => resolve();
});

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Web Locks across "tabs" of one browser (jsdom has none): exclusive and
 * shared modes, a queue per name in request order, a signal that aborts a
 * wait, and `query()` as the browser answers it.
 */
class LockHub {
  held: Array<{ name: string; mode: string; client: string }> = [];
  queue: Array<{ name: string; mode: string; client: string; cb: (l: unknown) => unknown; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];

  tab(client: string): RestoreLocks {
    return {
      request: (name, opts, cb) => this.request(client, name, opts, cb),
      query: async () => ({
        held: this.held.map(h => ({ name: h.name, mode: h.mode, clientId: h.client })),
        pending: this.queue.map(q => ({ name: q.name, mode: q.mode, clientId: q.client })),
      }),
    } as RestoreLocks;
  }

  request(client: string, name: string, opts: { mode?: string; signal?: AbortSignal }, cb: (l: unknown) => unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (opts.signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
      const r = { name, mode: opts.mode ?? 'exclusive', client, cb, resolve, reject };
      opts.signal?.addEventListener('abort', () => {
        const i = this.queue.indexOf(r);
        if (i < 0) return;
        this.queue.splice(i, 1);
        reject(new DOMException('aborted', 'AbortError'));
        this.pump();
      });
      this.queue.push(r);
      this.pump();
    });
  }

  private pump(): void {
    for (const r of [...this.queue]) {
      const conflict = this.held.some(h => h.name === r.name && (h.mode === 'exclusive' || r.mode === 'exclusive'));
      const ahead = this.queue.slice(0, this.queue.indexOf(r)).some(q => q.name === r.name);
      if (conflict || ahead) continue;
      this.queue.splice(this.queue.indexOf(r), 1);
      const h = { name: r.name, mode: r.mode, client: r.client };
      this.held.push(h);
      void Promise.resolve().then(() => r.cb({ name: r.name, mode: r.mode })).then(
        v => { this.release(h); r.resolve(v); },
        e => { this.release(h); r.reject(e); },
      );
    }
  }

  private release(h: { name: string; mode: string; client: string }): void {
    const i = this.held.indexOf(h);
    if (i >= 0) this.held.splice(i, 1);
    this.pump();
  }

  /** Another tab takes `name` and keeps it until the returned release. */
  async hold(client: string, name: string, mode = 'exclusive'): Promise<() => void> {
    let release: () => void = () => {};
    await new Promise<void>(granted => {
      void this.request(client, name, { mode }, () => { granted(); return new Promise<void>(r => { release = r; }); });
    });
    return release;
  }

  holds(client: string, name: string): boolean {
    return this.held.some(h => h.client === client && h.name === name);
  }
}

let consoleCalls: unknown[][] = [];
beforeEach(async () => {
  localStorage.clear();
  __resetRegistryCopyForTests();
  __setRegistryTabBaseForTests(null);
  await dropCopy();
  consoleCalls = [];
  for (const k of ['log', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { consoleCalls.push(a); });
  }
  vi.mocked(toastManager.show).mockClear();
});
afterEach(() => { vi.restoreAllMocks(); });

const storedSeq = (): number => (JSON.parse(localStorage.getItem(REGISTRY_STORAGE_KEY) ?? '{}') as { saved_seq?: number }).saved_seq ?? 0;

describe('a save leaves its copy', () => {
  it('U1 a save writes the copy with the stored string and its saved_seq', async () => {
    loadRegistry();
    const reg: WorldsRegistry = { ...defaultRegistry(), worlds: [entry('w-1')] };
    expect(saveRegistry(reg)).toBe(true);
    await registryCopyLanded();
    const rec = await copyRecord();
    expect(rec?.registry).toBe(localStorage.getItem(REGISTRY_STORAGE_KEY));
    expect(rec?.saved_seq).toBe(storedSeq());
    expect(rec!.saved_seq).toBeGreaterThan(0);
    // The number is set on a fresh object, never on the argument.
    expect((reg as { saved_seq?: number }).saved_seq).toBeUndefined();
  });

  it('U1 the copy holds the merge\'s result, not the argument, when another tab saved meanwhile', async () => {
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(10, ['w-1']));
    const mine = loadRegistry();
    // Another tab adds a world.
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(11, ['w-1', 'w-other']));
    saveRegistry({ ...mine, worlds: [...mine.worlds, entry('w-mine')] });
    await registryCopyLanded();
    const rec = await copyRecord();
    expect(rec?.registry).toBe(localStorage.getItem(REGISTRY_STORAGE_KEY));
    expect((JSON.parse(rec!.registry) as WorldsRegistry).worlds.map(w => w.id).sort()).toEqual(['w-1', 'w-mine', 'w-other']);
  });

  it('numbers a save above the stored one, and at least the clock', async () => {
    const ahead = Date.now() + 1e9;
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(ahead, ['w-1']));
    saveRegistry(loadRegistry());
    expect(storedSeq()).toBe(ahead + 1);
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(3, ['w-1']));
    const before = Date.now();
    saveRegistry(loadRegistry());
    expect(storedSeq()).toBeGreaterThanOrEqual(before);
    // An unreadable stored value counts 0 and is written over whole.
    localStorage.setItem(REGISTRY_STORAGE_KEY, '{not json');
    __setRegistryTabBaseForTests(defaultRegistry());
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-2')] });
    expect(storedSeq()).toBeGreaterThanOrEqual(before);
  });

  it('U5 a seq 7 copy write then a seq 6 write: the copy keeps 7', async () => {
    writeRegistryCopy(regJson(7, ['seven']), 7);
    writeRegistryCopy(regJson(6, ['six']), 6);
    await registryCopyLanded();
    await sleep(20);
    expect((await copyRecord())?.saved_seq).toBe(7);
    // And a copy another tab left at 7 refuses this tab's 6.
    await dropCopy();
    __resetRegistryCopyForTests();
    await seedCopy(regJson(7, ['seven']), 7);
    writeRegistryCopy(regJson(6, ['six']), 6);
    await registryCopyLanded();
    const rec = await copyRecord();
    expect(rec?.saved_seq).toBe(7);
    expect(rec?.registry).toBe(regJson(7, ['seven']));
  });

  it('U6 a setItem that throws writes no copy, and the toast says so as today', async () => {
    loadRegistry();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] })).toBe(false);
    await registryCopyLanded();
    await sleep(20);
    expect(await copyRecord()).toBeUndefined();
    await vi.waitFor(() => expect(toastManager.show).toHaveBeenCalledTimes(1));
    expect(String(vi.mocked(toastManager.show).mock.calls[0][0])).toMatch(/could not save your list of worlds/);
  });

  it('a removal waits on registryCopyLanded: it resolves once the copy holds this tab\'s latest save', async () => {
    loadRegistry();
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] });
    saveRegistry({ ...defaultRegistry(), worlds: [] });
    await registryCopyLanded();
    expect((await copyRecord())?.saved_seq).toBe(storedSeq());
    expect((JSON.parse((await copyRecord())!.registry) as WorldsRegistry).worlds).toEqual([]);
  });

  it('registryCopyLanded resolves at once with copy writes stopped, and within its bound when the write hangs', async () => {
    await stopRegistryCopyWrites();
    loadRegistry();
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] });
    const t0 = Date.now();
    await registryCopyLanded();
    expect(Date.now() - t0).toBeLessThan(50);
    expect(await copyRecord()).toBeUndefined();
    resumeRegistryCopyWrites();
    vi.spyOn(indexedDB, 'open').mockImplementation(() => ({}) as IDBOpenDBRequest);
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-2')] });
    const t1 = Date.now();
    await registryCopyLanded(120);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(100);
    expect(Date.now() - t1).toBeLessThan(1000);
  });
});

describe('the boot restore', () => {
  it('U2 no registry in localStorage, a copy holding w-1 at seq 3: the restore lists w-1 as w-1', async () => {
    await seedCopy(regJson(3, ['w-1']), 3);
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('restored');
    expect(loadRegistry().worlds.map(w => w.id)).toEqual(['w-1']);
    // One console line says so; nothing else does.
    expect(consoleCalls).toHaveLength(1);
    expect(toastManager.show).not.toHaveBeenCalled();
  });

  it('U3 localStorage at seq 5, copy at seq 4: localStorage untouched', async () => {
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(5, ['five']));
    await seedCopy(regJson(4, ['four']), 4);
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('kept');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBe(regJson(5, ['five']));
  });

  it('U4 equal seqs: localStorage untouched', async () => {
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(5, ['five']));
    await seedCopy(regJson(5, ['five-copy']), 5);
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('kept');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBe(regJson(5, ['five']));
  });

  it('a stored registry that will not parse, or has no saved_seq below the copy\'s, takes the copy', async () => {
    localStorage.setItem(REGISTRY_STORAGE_KEY, '{broken');
    await seedCopy(regJson(4, ['four']), 4);
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('restored');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBe(regJson(4, ['four']));
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(undefined, ['old']));
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('b') })).toBe('restored');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBe(regJson(4, ['four']));
  });

  it('U8 an older Atlas\'s save (the stored saved_seq kept, the content changed): localStorage still wins', async () => {
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(5, ['a']));
    saveRegistry(loadRegistry());
    await registryCopyLanded();
    const seq = storedSeq();
    // An Atlas with no copy saves: its merge keeps the stored number.
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(seq, ['a', 'b']));
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('kept');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBe(regJson(seq, ['a', 'b']));
  });

  it('U7 each copy failure is one console line: saveRegistry\'s answer unchanged, no toast, boot as today', async () => {
    // A copy that will not parse, and one with no worlds array.
    for (const bad of ['{nope', '{"saved_seq":9}']) {
      localStorage.clear();
      await seedCopy(bad, 9);
      consoleCalls = [];
      expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('failed');
      expect(consoleCalls).toHaveLength(1);
      expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBeNull();
    }
    // The restore's own setItem throwing.
    await seedCopy(regJson(9, ['nine']), 9);
    consoleCalls = [];
    const setSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('failed');
    expect(consoleCalls).toHaveLength(1);
    setSpy.mockRestore();
    // A QuotaExceededError on the write.
    loadRegistry();
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    consoleCalls = [];
    expect(saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] })).toBe(true);
    await registryCopyLanded();
    expect(consoleCalls).toHaveLength(1);
    putSpy.mockRestore();
    // An open that fires error, on a save and at boot.
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      const req = {} as { error?: DOMException; onerror?: (e: unknown) => void };
      setTimeout(() => { req.error = new DOMException('no', 'UnknownError'); req.onerror?.({ target: req }); }, 0);
      return req as unknown as IDBOpenDBRequest;
    });
    consoleCalls = [];
    expect(saveRegistry({ ...defaultRegistry(), worlds: [entry('w-2')] })).toBe(true);
    await registryCopyLanded();
    expect(consoleCalls).toHaveLength(1);
    localStorage.clear();
    consoleCalls = [];
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('failed');
    expect(consoleCalls).toHaveLength(1);
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBeNull();
    openSpy.mockRestore();
    // An open that throws (site data blocked).
    const throwSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError'); });
    consoleCalls = [];
    loadRegistry();
    expect(saveRegistry({ ...defaultRegistry(), worlds: [entry('w-3')] })).toBe(true);
    await registryCopyLanded();
    expect(consoleCalls).toHaveLength(1);
    throwSpy.mockRestore();
    expect(toastManager.show).not.toHaveBeenCalled();
  });

  it('U7 no indexedDB: saves answer as today, said once on the console', async () => {
    const idb = globalThis.indexedDB;
    // @ts-expect-error removed for the test
    delete globalThis.indexedDB;
    try {
      loadRegistry();
      expect(saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] })).toBe(true);
      expect(saveRegistry({ ...defaultRegistry(), worlds: [entry('w-2')] })).toBe(true);
      await registryCopyLanded();
      expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a') })).toBe('failed');
      expect(consoleCalls).toHaveLength(1);
    } finally {
      globalThis.indexedDB = idb;
    }
    expect(toastManager.show).not.toHaveBeenCalled();
  });

  it('no Web Locks: the restore is skipped', async () => {
    await seedCopy(regJson(3, ['w-1']), 3);
    expect(await restoreRegistryAtBoot({ locks: null })).toBe('no-locks');
    const throwing = { request: () => { throw new TypeError('no'); }, query: async () => ({}) } as unknown as RestoreLocks;
    expect(await restoreRegistryAtBoot({ locks: throwing })).toBe('no-locks');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBeNull();
  });

  it('U10 a boot whose copy read timed out, then a save: the next boot shows the session\'s list, not the copy\'s', async () => {
    const earlier = Date.now() - 60_000;
    await seedCopy(regJson(earlier, ['old']), earlier);
    // Boot 1: the read never finishes inside its bound; the app boots empty.
    expect(await restoreRegistryAtBoot({ locks: new LockHub().tab('a'), windowMs: 60, readCopy: () => new Promise(() => {}) })).toBe('read-late');
    const reg = loadRegistry();
    expect(reg.worlds).toEqual([]);
    saveRegistry({ ...reg, worlds: [entry('new')] });
    await registryCopyLanded();
    // Boot 2, a fresh browser process.
    await restoreRegistryAtBoot({ locks: new LockHub().tab('b') });
    expect(loadRegistry().worlds.map(w => w.id)).toEqual(['new']);
  });

  it('U11 a second tab holding atlas-live, localStorage behind the copy: no restore, localStorage untouched', async () => {
    const hub = new LockHub();
    await hub.hold('other', 'atlas-live', 'shared');
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(5, ['five']));
    await seedCopy(regJson(9, ['nine']), 9);
    expect(await restoreRegistryAtBoot({ locks: hub.tab('a') })).toBe('live-tab');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBe(regJson(5, ['five']));
    // And this tab goes live beside it.
    await vi.waitFor(() => expect(hub.holds('a', 'atlas-live')).toBe(true));
  });

  it('U12 a restore lock that is never released: boot goes on within W, with no restore, and takes atlas-live', async () => {
    const hub = new LockHub();
    await hub.hold('stuck', 'atlas-registry-restore');
    await seedCopy(regJson(9, ['nine']), 9);
    const t0 = Date.now();
    expect(await restoreRegistryAtBoot({ locks: hub.tab('a'), lockWaitMs: 200 })).toBe('lock-late');
    expect(Date.now() - t0).toBeLessThan(600);
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBeNull();
    await vi.waitFor(() => expect(hub.holds('a', 'atlas-live')).toBe(true));
  });

  it('U12 a holder whose copy read finishes past R, after the waiting tab went live: no setItem', async () => {
    const hub = new LockHub();
    localStorage.setItem(REGISTRY_STORAGE_KEY, regJson(1, ['one']));
    await seedCopy(regJson(9, ['nine']), 9);
    const slowRead = () => sleep(400).then(() => regJson(9, ['nine']));
    const a = restoreRegistryAtBoot({ locks: hub.tab('a'), lockWaitMs: 200, windowMs: 150, readCopy: slowRead });
    await sleep(10);
    const tB = Date.now();
    expect(await restoreRegistryAtBoot({ locks: hub.tab('b'), lockWaitMs: 200, windowMs: 150 })).toBe('lock-late');
    expect(Date.now() - tB).toBeLessThan(380);
    await vi.waitFor(() => expect(hub.holds('b', 'atlas-live')).toBe(true));
    expect(await a).toBe('dropped-late');
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).toBe(regJson(1, ['one']));
  });

  it('two tabs restored at once: the first decides, the second finds it live', async () => {
    const hub = new LockHub();
    await seedCopy(regJson(9, ['nine']), 9);
    const [a, b] = await Promise.all([
      restoreRegistryAtBoot({ locks: hub.tab('a') }),
      restoreRegistryAtBoot({ locks: hub.tab('b') }),
    ]);
    expect([a, b]).toEqual(['restored', 'live-tab']);
    await vi.waitFor(() => expect(hub.holds('a', 'atlas-live') && hub.holds('b', 'atlas-live')).toBe(true));
    expect(hub.held.some(h => h.name === 'atlas-registry-restore')).toBe(false);
  });
});

describe('U9 Forget this browser leaves no copy', () => {
  const token = 'ow_a_FORGETTOKEN12345678';
  const signedIn = (): WorldsRegistry => ({
    ...defaultRegistry(), worlds: [entry('w-1')],
    account_token: token, account_token_id: '0f1e2d3c-4b5a-4968-8776-655443322110', account_token_id_tail: token.slice(-8),
  });
  const emptyOpfs = () => new FakeDirHandle('opfs') as unknown as FileSystemDirectoryHandle;

  it('a save fired during its revoke wait leaves no copy', async () => {
    loadRegistry();
    saveRegistry(signedIn());
    patchSlice('registry', signedIn());
    await registryCopyLanded();
    let revoked = 0;
    await forgetEverything({
      opfsRoot: async () => emptyOpfs(),
      reload: () => {},
      revoke: async () => { revoked++; saveRegistry({ ...signedIn(), worlds: [entry('w-1'), entry('w-late')] }); await sleep(30); },
    });
    expect(revoked).toBe(1);
    await sleep(30);
    expect(await copyRecord()).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });

  it('a copy write still in flight when the vault step begins leaves no copy', async () => {
    loadRegistry();
    patchSlice('registry', defaultRegistry());
    await forgetEverything({
      opfsRoot: async () => { saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] }); return emptyOpfs(); },
      reload: () => {},
    });
    await sleep(30);
    expect(await copyRecord()).toBeUndefined();
  });

  it('a copy delete that reports blocked stops the forget, keeps localStorage, and copy writes resume', async () => {
    loadRegistry();
    patchSlice('registry', defaultRegistry());
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] });
    await registryCopyLanded();
    const holder = await openCopy(); // another connection that does not close on versionchange
    const err = await forgetEverything({ opfsRoot: async () => emptyOpfs(), reload: () => {} }).catch(e => e);
    expect(String((err as Error)?.message)).toBe(FORGET_PARTIAL_LINE);
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).not.toBeNull();
    holder.close();
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-2')] });
    await registryCopyLanded();
    expect((JSON.parse((await copyRecord())!.registry) as WorldsRegistry).worlds.map(w => w.id)).toEqual(['w-2']);
  });

  it('a copy write that never ends stops the forget within its bound; copy writes resume', async () => {
    loadRegistry();
    patchSlice('registry', defaultRegistry());
    const openSpy = vi.spyOn(indexedDB, 'open').mockImplementation(() => ({}) as IDBOpenDBRequest);
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] });
    openSpy.mockRestore();
    const t0 = Date.now();
    const err = await forgetEverything({ opfsRoot: async () => emptyOpfs(), reload: () => {}, copyWaitMs: { flight: 150, del: 150 } }).catch(e => e);
    expect(String((err as Error)?.message)).toBe(FORGET_PARTIAL_LINE);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).not.toBeNull();
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-2')] });
    await registryCopyLanded();
    expect((JSON.parse((await copyRecord())!.registry) as WorldsRegistry).worlds.map(w => w.id)).toEqual(['w-2']);
  });

  it('a copy delete that never ends stops the forget within its bound; copy writes resume', async () => {
    loadRegistry();
    patchSlice('registry', defaultRegistry());
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-1')] });
    await registryCopyLanded();
    const real = indexedDB.deleteDatabase.bind(indexedDB);
    const delSpy = vi.spyOn(indexedDB, 'deleteDatabase').mockImplementation((name: string) =>
      name === REGISTRY_COPY_DB ? ({}) as IDBOpenDBRequest : real(name));
    const t0 = Date.now();
    const err = await forgetEverything({ opfsRoot: async () => emptyOpfs(), reload: () => {}, copyWaitMs: { flight: 150, del: 150 } }).catch(e => e);
    expect(String((err as Error)?.message)).toBe(FORGET_PARTIAL_LINE);
    expect(Date.now() - t0).toBeLessThan(1000);
    delSpy.mockRestore();
    expect(localStorage.getItem(REGISTRY_STORAGE_KEY)).not.toBeNull();
    saveRegistry({ ...defaultRegistry(), worlds: [entry('w-2')] });
    await registryCopyLanded();
    expect((JSON.parse((await copyRecord())!.registry) as WorldsRegistry).worlds.map(w => w.id)).toEqual(['w-2']);
  });
});
