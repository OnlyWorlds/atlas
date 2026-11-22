/**
 * The writer lock's Web Lock (DESIGN_LAWS conv. 13): each open store holds a
 * Web Lock of its own fresh name and writes it into `.atlas/lock`, so in one
 * browser the browser itself says whether the store that wrote a live lock
 * still exists. A world closed with its tab is free at once; a second page
 * of the same tab id (a duplicated tab) is refused while the first lives;
 * a store owns only a lock naming its own Web Lock. Real FsFolderStore on
 * fake-fs, one fake lock manager seen from several pages
 * (`tests/fixtures/fake-lock-pages.ts`).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FakeDirHandle, setFakeFsJitter } from '../fixtures/fake-fs';
import { fakeLockBrowser, type FakeLockBrowser, type PageLocks } from '../fixtures/fake-lock-pages';
import { ELockHeld, FsFolderStore, makeBrowserId, type FsFolderStoreOptions } from '../../src/store/folder-store-fs';
import { BROWSER_ID_STORAGE_KEY } from '../../src/core/constants';
import { isPlainError } from '../../src/core/plain-error';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const asDir = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;
const WAIT = 60;

function world(): FakeDirHandle {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  return root;
}

function storeOn(browser: FakeLockBrowser, page: string, tab: string, extra: FsFolderStoreOptions = {}): FsFolderStore {
  return new FsFolderStore({ tabId: tab, browserId: 'browser-1', locks: browser.page(page), disableHeartbeat: true, claimWaitMs: WAIT, ...extra });
}

const lockOf = (root: FakeDirHandle): Record<string, unknown> | null => {
  const raw = root.get('.atlas/lock');
  return raw == null ? null : JSON.parse(String(raw));
};
const openErr = (s: FsFolderStore, root: FakeDirHandle): Promise<unknown> => s.open(asDir(root)).then(() => null, e => e);
const settle = (ms = 20) => new Promise(r => setTimeout(r, ms));

describe('the writer lock in one browser', () => {
  afterEach(() => { setFakeFsJitter(null); });

  it('the file lock names the store\'s own Web Lock and this browser', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const lock = lockOf(root)!;
    expect(lock.tab_id).toBe('T1');
    expect(lock.browser_id).toBe('browser-1');
    expect(String(lock.web_lock)).toMatch(/^atlas-writer:[0-9a-f-]{36}$/);
    expect(lock.web_lock).not.toMatch(/^atlas-world:/);
    expect(browser.holder(String(lock.web_lock))).toBe('pA');
  });

  it('a closed page\'s live lock is taken with no question by a new page', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    browser.kill('pA'); // the tab closes: no close(), the lock stays live on disk
    const b = storeOn(browser, 'pB', 'T2');
    expect(await openErr(b, root)).toBeNull();
    expect(lockOf(root)!.web_lock).toBe(b.__debug_webLock());
    expect(lockOf(root)!.tab_id).toBe('T2');
  });

  it('a reload takes its old page\'s live lock with no question, under a new name', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const old = lockOf(root)!.web_lock;
    browser.kill('pA');
    const again = storeOn(browser, 'pA2', 'T1');
    expect(await openErr(again, root)).toBeNull();
    expect(lockOf(root)!.web_lock).not.toBe(old);
  });

  it('a page in the back-forward cache is evicted by the waiting ask, and its lock taken', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    browser.cache('pA');
    const b = storeOn(browser, 'pB', 'T2');
    expect(await openErr(b, root)).toBeNull();
    expect(browser.heldBy('pA')).toEqual([]);
  });

  it('a live page of this browser keeps its world: ELockHeld after the wait', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const b = storeOn(browser, 'pB', 'T2');
    const t0 = Date.now();
    const err = await openErr(b, root);
    expect(err).toBeInstanceOf(ELockHeld);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(WAIT - 5);
    expect(lockOf(root)!.web_lock).toBe(a.__debug_webLock());
  });

  it('P1: a second page of the same tab id meets ELockHeld while the first lives', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T');
    await a.open(asDir(root));
    const dup = storeOn(browser, 'pDup', 'T');
    expect(await openErr(dup, root)).toBeInstanceOf(ELockHeld);
  });

  it('P2 to P4: two stores of one tab id never beat, stale or remove each other\'s lock', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T');
    await a.open(asDir(root));
    const aName = a.__debug_webLock()!;
    // The duplicate takes it over with the person's consent: no Web Lock asked.
    const dup = storeOn(browser, 'pDup', 'T', { forceTakeLock: true });
    const t0 = Date.now();
    await dup.open(asDir(root));
    expect(Date.now() - t0).toBeLessThan(WAIT);
    expect(browser.asked(aName)).toBe(1); // only A's own request
    const taken = root.get('.atlas/lock');
    // P2: A's beat writes nothing and stops.
    await a.__debug_heartbeat();
    expect(root.get('.atlas/lock')).toBe(taken);
    // P3: A's park does not stale it, and a third page still meets ELockHeld.
    a.park();
    await settle();
    expect(root.get('.atlas/lock')).toBe(taken);
    const third = storeOn(browser, 'pC', 'C', { takeStaleLock: false });
    expect(await openErr(third, root)).toBeInstanceOf(ELockHeld);
    // P4: A's close removes nothing.
    await a.close();
    expect(root.get('.atlas/lock')).toBe(taken);
    expect(lockOf(root)!.web_lock).toBe(dup.__debug_webLock());
  });

  it('two stores claiming one dead-named live lock at once: exactly one opens', async () => {
    for (let round = 0; round < 6; round++) {
      const browser = fakeLockBrowser();
      const root = world();
      const a = storeOn(browser, 'pA', 'T0');
      await a.open(asDir(root));
      browser.kill('pA');
      setFakeFsJitter(async () => { const n = Math.floor(Math.random() * 3); for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); });
      const b = storeOn(browser, 'pB', 'T1');
      const c = storeOn(browser, 'pC', 'T2');
      const [eb, ec] = await Promise.all([openErr(b, root), openErr(c, root)]);
      setFakeFsJitter(null);
      const opened = [eb, ec].filter(e => e === null).length;
      expect(opened).toBe(1);
      expect([eb, ec].find(e => e !== null)).toBeInstanceOf(ELockHeld);
      const winner = eb === null ? b : c;
      expect(lockOf(root)!.web_lock).toBe(winner.__debug_webLock());
    }
  });

  it('a failed open releases its Web Lock', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const b = storeOn(browser, 'pB', 'T2');
    expect(await openErr(b, root)).toBeInstanceOf(ELockHeld);
    expect(browser.heldBy('pB')).toEqual([]);
  });

  it('close() resolves only after its Web Lock is released', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const name = a.__debug_webLock()!;
    await a.close();
    expect(browser.holder(name)).toBeNull();
    expect(root.get('.atlas/lock')).toBeNull();
  });

  it('a close whose lock removal throws still releases its Web Lock: the next open in the page asks nothing of "another tab"', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const name = a.__debug_webLock()!;
    const atlasDir = await root.getDirectoryHandle('.atlas');
    const orig = atlasDir.removeEntry.bind(atlasDir);
    let refusals = 1;
    (atlasDir as unknown as { removeEntry: typeof orig }).removeEntry = async (n: string, o?: { recursive?: boolean }) => {
      if (n === 'lock' && refusals-- > 0) { const e = new Error('held by another program'); e.name = 'NoModificationAllowedError'; throw e; }
      return orig(n, o);
    };
    await a.close().catch(() => {});
    expect(lockOf(root)!.web_lock).toBe(name); // the file stayed, live
    expect(browser.holder(name)).toBeNull();
    const again = storeOn(browser, 'pA', 'T1');
    expect(await openErr(again, root)).toBeNull();
  });

  it('a parked world is taken by another page at once, with no Web Lock asked; the unpark then reopens cold', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const aName = a.__debug_webLock()!;
    a.park();
    await settle();
    expect(Date.parse(String(lockOf(root)!.last_heartbeat))).toBe(0);
    const b = storeOn(browser, 'pB', 'T2');
    const t0 = Date.now();
    expect(await openErr(b, root)).toBeNull();
    expect(Date.now() - t0).toBeLessThan(WAIT);
    expect(browser.asked(aName)).toBe(1);
    expect(browser.holder(aName)).toBe('pA'); // the parked store keeps its own
    expect(await a.unpark()).toBe(false);
    await a.close();
    expect(lockOf(root)!.web_lock).toBe(b.__debug_webLock());
  });

  it('a mover whose page died mid-move: the ask finds it gone, and the same tab or another takes the lock as stale', async () => {
    for (const [page, tab] of [['pA2', 'T1'], ['pB', 'T2']] as const) {
      const browser = fakeLockBrowser();
      const root = world();
      const a = storeOn(browser, 'pA', 'T1');
      await a.open(asDir(root));
      await a.beginMove();
      browser.kill('pA');
      const s = storeOn(browser, page, tab);
      expect(await openErr(s, root)).toBeNull();
      expect(lockOf(root)!.moving).toBeUndefined();
      expect(lockOf(root)!.web_lock).toBe(s.__debug_webLock());
    }
  });

  it('a live mover refuses everyone: another tab, a duplicate, the take-over, and a store with no Web Lock', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    await a.beginMove();
    const moving = root.get('.atlas/lock');
    for (const s of [
      storeOn(browser, 'pB', 'T2'),
      storeOn(browser, 'pD', 'T1'),
      storeOn(browser, 'pF', 'T3', { forceTakeLock: true }),
      new FsFolderStore({ tabId: 'T1', disableHeartbeat: true, locks: null }),
    ]) {
      const err = await openErr(s, root);
      expect(err).toBeInstanceOf(ELockHeld);
      expect((err as ELockHeld).moving).toBe(true);
    }
    expect(root.get('.atlas/lock')).toBe(moving);
  });
});

describe('the writer lock across browsers and releases', () => {
  it('another browser\'s live lock reads ELockHeld, and its Web Lock is never asked', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const aName = a.__debug_webLock()!;
    browser.kill('pA'); // even dead in THIS fake: another browser's names are not ours to ask
    const other = storeOn(browser, 'pB', 'T2', { browserId: 'browser-2' });
    expect(await openErr(other, root)).toBeInstanceOf(ELockHeld);
    expect(browser.asked(aName)).toBe(1);
  });

  it('no browser id can be kept (storage refused): the page behaves as without Web Locks, no name held, written or asked', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1', { browserId: null });
    await a.open(asDir(root));
    expect(Object.keys(lockOf(root)!).sort()).toEqual(['last_heartbeat', 'started_at', 'tab_id']);
    expect(a.__debug_webLock()).toBeNull();
    expect(browser.heldBy('pA')).toEqual([]);
    browser.kill('pA');
    expect(await openErr(storeOn(browser, 'pB', 'T2', { browserId: null }), root)).toBeInstanceOf(ELockHeld);
    // the rule by tab id, as without Web Locks: a store of its tab id takes it
    expect(await openErr(storeOn(browser, 'pA2', 'T1', { browserId: null }), root)).toBeNull();
  });

  it('a lock naming a Web Lock is never taken by a tab id match: two stores of one tab id, no browser id for the second', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T');
    await a.open(asDir(root));
    const named = root.get('.atlas/lock');
    for (const s of [
      storeOn(browser, 'pD', 'T', { browserId: null }),
      new FsFolderStore({ tabId: 'T', disableHeartbeat: true, locks: null }),
      storeOn(browser, 'pX', 'T', { browserId: 'browser-2' }),
    ]) expect(await openErr(s, root)).toBeInstanceOf(ELockHeld);
    expect(root.get('.atlas/lock')).toBe(named);
  });

  it('the release before Web Locks: its live lock is never taken by a store holding a Web Lock, even of its tab id, and never owned by its tab id', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const now = new Date().toISOString();
    root.put('.atlas/lock', j({ tab_id: 'T', started_at: now, last_heartbeat: now }));
    expect(await openErr(storeOn(browser, 'pU', 'T'), root)).toBeInstanceOf(ELockHeld);
    root.put('.atlas/lock', j({ tab_id: 'T', started_at: now, last_heartbeat: '2026-01-01T00:00:00.000Z' }));
    const b = storeOn(browser, 'pB', 'T');
    expect(await openErr(b, root)).toBeNull(); // stale: taken
    expect(lockOf(root)!.web_lock).toBe(b.__debug_webLock());
    // An old page of the same tab id takes it back by its tab id and writes no name.
    const old = j({ tab_id: 'T', started_at: now, last_heartbeat: new Date().toISOString() });
    root.put('.atlas/lock', old);
    await b.__debug_heartbeat();
    expect(root.get('.atlas/lock')).toBe(old);
    b.park();
    await settle();
    expect(root.get('.atlas/lock')).toBe(old);
    await b.close();
    expect(root.get('.atlas/lock')).toBe(old);
  });

  it('a live lock of another tab id with no name still reads ELockHeld', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const now = new Date().toISOString();
    root.put('.atlas/lock', j({ tab_id: 'old-tab', started_at: now, last_heartbeat: now }));
    expect(await openErr(storeOn(browser, 'pB', 'T'), root)).toBeInstanceOf(ELockHeld);
  });
});

describe('no Web Locks, no change', () => {
  it('a store holding no Web Lock never owns a lock naming one, even of its tab id', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = new FsFolderStore({ tabId: 'T', disableHeartbeat: true, locks: null });
    await a.open(asDir(root));
    const d = storeOn(browser, 'pD', 'T', { forceTakeLock: true }); // a consented take-over by a page of its tab id
    await d.open(asDir(root));
    const taken = root.get('.atlas/lock');
    await a.__debug_heartbeat();
    a.park();
    await settle();
    await a.close();
    expect(root.get('.atlas/lock')).toBe(taken);
  });

  it('navigator.locks absent: no name written, the lock owned and taken by tab id as before', async () => {
    expect((navigator as unknown as { locks?: unknown }).locks).toBeUndefined();
    const root = world();
    const a = new FsFolderStore({ tabId: 'T1', disableHeartbeat: true });
    await a.open(asDir(root));
    expect(Object.keys(lockOf(root)!).sort()).toEqual(['last_heartbeat', 'started_at', 'tab_id']);
    const same = new FsFolderStore({ tabId: 'T1', disableHeartbeat: true });
    expect(await openErr(same, root)).toBeNull();
    const other = new FsFolderStore({ tabId: 'T2', disableHeartbeat: true });
    expect(await openErr(other, root)).toBeInstanceOf(ELockHeld);
    await same.close();
    expect(root.get('.atlas/lock')).toBeNull();
  });

  it('locks: null is the same', async () => {
    const root = world();
    const a = new FsFolderStore({ tabId: 'T1', disableHeartbeat: true, locks: null, browserId: 'browser-1' });
    await a.open(asDir(root));
    expect(lockOf(root)!.web_lock).toBeUndefined();
    expect(lockOf(root)!.browser_id).toBeUndefined();
    expect(a.__debug_webLock()).toBeNull();
  });
});

/** A page whose request for its own fresh atlas-writer name does not come back in time. */
function ownNameStalls(inner: PageLocks, when: () => boolean = () => true): PageLocks {
  return {
    request(name, opts, cb) {
      if (when() && name.startsWith('atlas-writer:')) {
        return new Promise((_res, rej) => { opts.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
      }
      return inner.request(name, opts, cb);
    },
  };
}

const COULD_NOT_OPEN = 'Atlas could not open this world just now. Try again in a moment.';

describe('a store whose own Web Lock does not come in time', () => {
  it('its open fails with a plain sentence, writes no lock and holds nothing', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const late = new FsFolderStore({ tabId: 'T', browserId: 'browser-1', locks: ownNameStalls(browser.page('pJ')), disableHeartbeat: true, claimWaitMs: WAIT });
    const err = await openErr(late, root);
    expect(isPlainError(err)).toBe(true);
    expect((err as Error).message).toBe(COULD_NOT_OPEN);
    expect(root.get('.atlas/lock')).toBeNull();
    expect(browser.heldBy('pJ')).toEqual([]);
  });

  it('never takes a live duplicate\'s lock (same tab id), and the duplicate\'s lock stays its own', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T');
    await a.open(asDir(root));
    const held = root.get('.atlas/lock');
    const late = new FsFolderStore({ tabId: 'T', browserId: 'browser-1', locks: ownNameStalls(browser.page('pJ')), disableHeartbeat: true, claimWaitMs: WAIT });
    expect(isPlainError(await openErr(late, root))).toBe(true);
    expect(root.get('.atlas/lock')).toBe(held);
  });

  it('a store opened, closed and opened again takes a fresh name, and a late second name fails the open', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    let stall = false;
    const s = new FsFolderStore({ tabId: 'T', browserId: 'browser-1', locks: ownNameStalls(browser.page('pA'), () => stall), disableHeartbeat: true, claimWaitMs: WAIT });
    await s.open(asDir(root));
    const first = s.__debug_webLock();
    await s.close();
    await s.open(asDir(root));
    const second = s.__debug_webLock();
    expect(second).not.toBe(first);
    expect(lockOf(root)!.web_lock).toBe(second);
    await s.close();
    expect(root.get('.atlas/lock')).toBeNull();
    stall = true;
    expect(isPlainError(await openErr(s, root))).toBe(true);
    expect(root.get('.atlas/lock')).toBeNull();
  });
});

describe('the claim, round two', () => {
  afterEach(() => { setFakeFsJitter(null); });

  it('a world parked during the claim\'s wait is taken as stale once the wait ends', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const b = storeOn(browser, 'pB', 'T2', { claimWaitMs: 120 });
    const pending = openErr(b, root);
    await settle(20);
    a.park();
    expect(await pending).toBeNull();
    expect(lockOf(root)!.web_lock).toBe(b.__debug_webLock());
    expect(await a.unpark()).toBe(false);
  });

  for (const n of [2, 3, 4]) {
    it(`${n} claimers of one dead name, jittered, 20 rounds: exactly one opens`, async () => {
      for (let round = 0; round < 20; round++) {
        const browser = fakeLockBrowser();
        const root = world();
        const a = storeOn(browser, 'pA', 'T0');
        await a.open(asDir(root));
        browser.kill('pA');
        setFakeFsJitter(async () => { const k = Math.floor(Math.random() * 4); for (let i = 0; i < k; i++) await new Promise(r => setTimeout(r, Math.random() < 0.3 ? 1 : 0)); });
        const ss = Array.from({ length: n }, (_, i) => storeOn(browser, `p${i}`, `T${i + 1}`, { claimWaitMs: 400 }));
        const errs = await Promise.all(ss.map(s => openErr(s, root)));
        setFakeFsJitter(null);
        expect(errs.filter(e => e === null).length).toBe(1);
        for (const e of errs) if (e !== null) expect(e).toBeInstanceOf(ELockHeld);
        expect(lockOf(root)!.web_lock).toBe(ss[errs.findIndex(e => e === null)].__debug_webLock());
      }
    });
  }

  it('two claimers of one dead name, started a moment apart: exactly one opens', async () => {
    for (let round = 0; round < 10; round++) {
      const browser = fakeLockBrowser();
      const root = world();
      const a = storeOn(browser, 'pA', 'T0');
      await a.open(asDir(root));
      browser.kill('pA');
      const pb = openErr(storeOn(browser, 'pB', 'T1', { claimWaitMs: 300 }), root);
      await new Promise(r => setTimeout(r, round));
      const pc = openErr(storeOn(browser, 'pC', 'T2', { claimWaitMs: 300 }), root);
      const errs = await Promise.all([pb, pc]);
      expect(errs.filter(e => e === null).length).toBe(1);
    }
  });

  it('a live named lock costs one wait, then ELockHeld', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    await storeOn(browser, 'pA', 'T1').open(asDir(root));
    const t0 = Date.now();
    const err = await openErr(storeOn(browser, 'pB', 'T2', { claimWaitMs: 200 }), root);
    expect(err).toBeInstanceOf(ELockHeld);
    expect(Date.now() - t0).toBeLessThan(400);
  });
});

describe('a close is final, whatever its removal did', () => {
  it('a close whose removal throws stops the store\'s queued tidy from writing, before its Web Lock goes', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    root.put('elements/character/not-canonical.json', j({ id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'character', name: 'Ada' }));
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    await a.listElements('character'); // the index pass queues the background tidy
    const atlasDir = await root.getDirectoryHandle('.atlas');
    const orig = atlasDir.removeEntry.bind(atlasDir);
    (atlasDir as unknown as { removeEntry: typeof orig }).removeEntry = async (n: string, o?: { recursive?: boolean }) => {
      if (n === 'lock') { const e = new Error('held by another program'); e.name = 'NoModificationAllowedError'; throw e; }
      return orig(n, o);
    };
    await a.close().catch(() => {});
    (atlasDir as unknown as { removeEntry: typeof orig }).removeEntry = orig;
    const b = storeOn(browser, 'pB', 'T2');
    expect(await openErr(b, root)).toBeNull();
    await a.awaitTidies();
    await settle(30);
    expect(root.list().filter(p => p.startsWith('elements/character/'))).toEqual(['elements/character/not-canonical.json']);
  });
});

describe('the browser id, made once per browser', () => {
  afterEach(() => { vi.restoreAllMocks(); localStorage.removeItem(BROWSER_ID_STORAGE_KEY); });

  it('two first pages: the second waits for the first\'s making, and uses the id it made', async () => {
    localStorage.removeItem(BROWSER_ID_STORAGE_KEY);
    const browser = fakeLockBrowser();
    let releaseB: () => void = () => {};
    await new Promise<void>(held => {
      void browser.page('pB').request('atlas-browser-id', {}, () => { held(); return new Promise<void>(r => { releaseB = r; }); });
    });
    const forA = makeBrowserId(browser.page('pA'), 500);
    await settle(10);
    localStorage.setItem(BROWSER_ID_STORAGE_KEY, 'made-by-page-b'); // page B makes it inside its hold
    releaseB();
    expect(await forA).toBe('made-by-page-b');
  });

  it('uses the id read back, never the one it meant to write', async () => {
    localStorage.removeItem(BROWSER_ID_STORAGE_KEY);
    const browser = fakeLockBrowser();
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k: string, _v: string) {
      real.call(this, k, k === BROWSER_ID_STORAGE_KEY ? 'another-page-won' : _v);
    });
    expect(await makeBrowserId(browser.page('pA'), 500)).toBe('another-page-won');
  });

  it('keeps an id already there, and answers null when storage refuses', async () => {
    const browser = fakeLockBrowser();
    localStorage.setItem(BROWSER_ID_STORAGE_KEY, 'kept');
    expect(await makeBrowserId(browser.page('pA'), 500)).toBe('kept');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
    expect(await makeBrowserId(browser.page('pA'), 500)).toBeNull();
  });

  it('a store given no browser id writes the one this browser keeps', async () => {
    localStorage.setItem(BROWSER_ID_STORAGE_KEY, 'this-browser');
    const browser = fakeLockBrowser();
    const root = world();
    const s = new FsFolderStore({ tabId: 'T', locks: browser.page('pA'), disableHeartbeat: true, claimWaitMs: WAIT });
    await s.open(asDir(root));
    expect(lockOf(root)!.browser_id).toBe('this-browser');
  });
});
