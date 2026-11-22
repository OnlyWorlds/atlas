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
import { describe, it, expect, afterEach } from 'vitest';
import { FakeDirHandle, setFakeFsJitter } from '../fixtures/fake-fs';
import { fakeLockBrowser, type FakeLockBrowser } from '../fixtures/fake-lock-pages';
import { ELockHeld, FsFolderStore, type FsFolderStoreOptions } from '../../src/store/folder-store-fs';

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

  it('the moving lock of a page that died is never taken by the ask, whatever its tab id', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1');
    await a.open(asDir(root));
    const aName = a.__debug_webLock()!;
    await a.beginMove();
    browser.kill('pA');
    for (const [page, tab, extra] of [['pB', 'T2', {}], ['pA2', 'T1', {}], ['pF', 'T3', { forceTakeLock: true }]] as const) {
      const err = await openErr(storeOn(browser, page, tab, extra), root);
      expect(err).toBeInstanceOf(ELockHeld);
      expect((err as ELockHeld).moving).toBe(true);
    }
    expect(browser.asked(aName)).toBe(1);
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

  it('a lock with no browser id kept (storage refused) keeps the rule by tab id', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const a = storeOn(browser, 'pA', 'T1', { browserId: null });
    await a.open(asDir(root));
    expect(lockOf(root)!.browser_id).toBeUndefined();
    browser.kill('pA');
    expect(await openErr(storeOn(browser, 'pB', 'T2', { browserId: null }), root)).toBeInstanceOf(ELockHeld);
  });

  it('the release before Web Locks: its live lock of this tab\'s id is taken (the upgrade reload), and never owned by its tab id after', async () => {
    const browser = fakeLockBrowser();
    const root = world();
    const now = new Date().toISOString();
    root.put('.atlas/lock', j({ tab_id: 'T', started_at: now, last_heartbeat: now }));
    const b = storeOn(browser, 'pB', 'T');
    expect(await openErr(b, root)).toBeNull();
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
