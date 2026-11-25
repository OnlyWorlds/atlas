/**
 * Two pages of one browser starting on one world at once: exactly one opens
 * (2026-11-25). The e2e `two pages starting at once on a world whose page closed`
 * saw both hold the world when the closed page's store had removed its lock
 * file first: with no file, each claim read "missing", took it, and wrote its
 * own, and the second write won the file while both pages kept the world.
 */
import { describe, expect, it } from 'vitest';
import { ELockHeld, FsFolderStore, type WriterLocks } from '../../src/store/folder-store-fs';
import { memoryDirectoryWith } from '../../src/store/memory-dir';

const enc = (s: string) => new TextEncoder().encode(s);
const WORLD = enc(JSON.stringify({ id: '0192a000-0000-7000-8000-00000000000b', name: 'Saltmere' }));

/** Web Locks as one browser holds them for all its pages: a request waits on a held name until granted or aborted. */
function browserLocks(): WriterLocks {
  const held = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  return {
    request: async (name, opts, cb) => {
      if (held.has(name)) {
        if (opts?.ifAvailable) return cb(null);
        await new Promise<void>((resolve, reject) => {
          const go = () => resolve();
          waiters.set(name, [...(waiters.get(name) ?? []), go]);
          opts?.signal?.addEventListener('abort', () => {
            waiters.set(name, (waiters.get(name) ?? []).filter(w => w !== go));
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      }
      held.add(name);
      try { return await cb({ name }); } finally {
        held.delete(name);
        waiters.get(name)?.shift()?.();
      }
    },
  };
}

/**
 * The window a browser opens and a lockstep fake closes: the second page reads
 * the lock before the first writes it, and writes its own only after the first
 * has opened (its write's read-back then sees nobody else's).
 */
function staged(dir: FileSystemDirectoryHandle, gate: () => Promise<unknown>, onRead: () => void = () => {}): FileSystemDirectoryHandle {
  const atlas = (d: FileSystemDirectoryHandle) => new Proxy(d, {
    get(t, k) {
      if (k === 'getFileHandle') {
        return async (n: string, o?: { create?: boolean }) => {
          if (o?.create) await gate().catch(() => {});
          try { return await t.getFileHandle(n, o); } finally { if (n === 'lock' && !o?.create) onRead(); }
        };
      }
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
  return new Proxy(dir, {
    get(t, k) {
      if (k === 'getDirectoryHandle') {
        return async (n: string, o?: { create?: boolean }) => { const d = await t.getDirectoryHandle(n, o); return n === '.atlas' ? atlas(d) : d; };
      }
      const v = Reflect.get(t, k);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });
}

async function openBoth(lockFile: string | null): Promise<number> {
  const files = [{ path: 'world.json', data: WORLD }, { path: 'elements/character/.keep', data: enc('') }, { path: '.atlas/.keep', data: enc('') }];
  if (lockFile) files.push({ path: '.atlas/lock', data: enc(lockFile) });
  const dir = await memoryDirectoryWith(files);
  const locks = browserLocks();
  const [a, b] = [0, 1].map(i => new FsFolderStore({ locks, browserId: 'b1', tabId: `tab-${i}`, disableHeartbeat: true, claimWaitMs: 1000 }));
  // A writes only once B has read (or 50 ms on, B's read waiting on A's claim); B writes only once A has opened.
  let bRead: () => void = () => {};
  const bHasRead = new Promise<void>(r => { bRead = r; });
  const aGate = Promise.race([bHasRead, new Promise(r => setTimeout(r, 50))]);
  const first = a.open(staged(dir, () => aGate));
  const results = await Promise.allSettled([first, b.open(staged(dir, () => first, bRead))]);
  const lost = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  // The other page says why: the world is open in another tab, never a try-again.
  for (const r of lost) expect(r.reason).toBeInstanceOf(ELockHeld);
  return results.length - lost.length;
}

describe('two pages claim one world at once', () => {
  it('with no lock file, one opens', async () => {
    expect(await openBoth(null)).toBe(1);
  });
  it('over a stale lock, one opens', async () => {
    const stale = JSON.stringify({ tab_id: 'gone', browser_id: 'b1', web_lock: 'atlas-writer:gone', started_at: '2020-01-01T00:00:00.000Z', last_heartbeat: '2020-01-01T00:00:00.000Z' });
    expect(await openBoth(stale)).toBe(1);
  });
  it('over a live lock whose page is gone, one opens (the dead name, as before)', async () => {
    const now = new Date().toISOString();
    const dead = JSON.stringify({ tab_id: 'gone', browser_id: 'b1', web_lock: 'atlas-writer:gone', started_at: now, last_heartbeat: now });
    expect(await openBoth(dead)).toBe(1);
  });
});

describe('a parked page coming back while another takes its world', () => {
  it('one of them holds it: the take or the unpark, never both', async () => {
    const dir = await memoryDirectoryWith([{ path: 'world.json', data: WORLD }, { path: 'elements/character/.keep', data: enc('') }]);
    const locks = browserLocks();
    let bGate: Promise<unknown> = Promise.resolve();
    let armed = false;
    let bRead: () => void = () => {};
    const bHasRead = new Promise<void>(r => { bRead = r; });
    const b = new FsFolderStore({ locks, browserId: 'b1', tabId: 'tab-b', disableHeartbeat: true, claimWaitMs: 1000 });
    await b.open(staged(dir, () => bGate, () => { if (armed) bRead(); }));
    b.park(); // its lock goes stale at once: takeable with nothing asked
    await new Promise(r => setTimeout(r, 20));
    const a = new FsFolderStore({ locks, browserId: 'b1', tabId: 'tab-a', disableHeartbeat: true, claimWaitMs: 1000 });
    // A writes only once B's unpark has read; B writes only once A's open has settled (each 50 ms on,
    // the other's step waiting on this one's section).
    const aGate = Promise.race([bHasRead, new Promise(r => setTimeout(r, 50))]);
    const opening = a.open(staged(dir, () => aGate)).then(() => true, () => false);
    bGate = Promise.race([opening, new Promise(r => setTimeout(r, 50))]);
    armed = true;
    const [aHolds, bHolds] = await Promise.all([opening, b.unpark()]);
    expect([aHolds, bHolds].filter(Boolean)).toHaveLength(1);
  });
});
