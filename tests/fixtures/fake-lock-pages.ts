/**
 * A Web Locks API for vitest that knows pages (the writer lock, conv. 13).
 * One browser's lock manager, seen from several pages: `page(id)` is what
 * `navigator.locks` is in that page, handed to a store through its `locks`
 * option. Exclusive locks by name, granted in request order.
 *
 * - The hold is the grant's callback: its promise settling releases the
 *   name, a moment later (the browser's release is asynchronous), and only
 *   then does the request's own promise settle.
 * - `signal` bounds a wait: aborted before the grant, the request rejects
 *   and leaves the queue. `ifAvailable` calls back with `null` when the
 *   name is held or queued.
 * - `kill(page)`: the page dies (closed, crashed, quit, reloaded): every
 *   name it holds is released and its waiting requests go.
 * - `cache(page)`: the page enters the back-forward cache: it keeps its
 *   names, but a request that WAITS for one evicts it (Chromium,
 *   `weblocks-contention`); an `ifAvailable` ask does not.
 */
type Cb = (lock: { name: string } | null) => unknown;

export interface PageLocks {
  request(name: string, opts: { ifAvailable?: boolean; signal?: AbortSignal }, cb: Cb): Promise<unknown>;
}

interface Waiter {
  page: string;
  cb: Cb;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export interface FakeLockBrowser {
  page(id: string): PageLocks;
  kill(id: string): void;
  cache(id: string): void;
  /** The page holding `name`, or null. */
  holder(name: string): string | null;
  /** Every name `page` holds. */
  heldBy(page: string): string[];
  /** Requests made for `name` so far, granted or not. */
  asked(name: string): number;
}

function abortError(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The request was aborted.', 'AbortError');
}

export function fakeLockBrowser(): FakeLockBrowser {
  const holders = new Map<string, string>();
  const queues = new Map<string, Waiter[]>();
  const askedCount = new Map<string, number>();
  const dead = new Set<string>();
  const cached = new Set<string>();

  function grantNext(name: string): void {
    if (holders.has(name)) return;
    const q = queues.get(name) ?? [];
    while (q.length > 0) {
      const w = q.shift()!;
      if (dead.has(w.page)) continue;
      if (w.signal && w.onAbort) w.signal.removeEventListener('abort', w.onAbort);
      run(name, w);
      return;
    }
  }

  function run(name: string, w: Waiter): void {
    holders.set(name, w.page);
    void (async () => {
      let out: unknown;
      let failed = false;
      try { out = await w.cb({ name }); } catch (e) { out = e; failed = true; }
      if (dead.has(w.page)) return; // a dead page's hold went with it; its promise never settles
      await new Promise(r => setTimeout(r, 1)); // the release lands a moment later
      if (holders.get(name) === w.page) holders.delete(name);
      grantNext(name);
      if (failed) w.reject(out); else w.resolve(out);
    })();
  }

  function evict(page: string): void {
    dead.add(page);
    cached.delete(page);
    for (const [name, p] of [...holders]) {
      if (p !== page) continue;
      holders.delete(name);
      grantNext(name);
    }
    for (const q of queues.values()) {
      for (let i = q.length - 1; i >= 0; i--) if (q[i].page === page) q.splice(i, 1);
    }
  }

  function request(page: string, name: string, opts: { ifAvailable?: boolean; signal?: AbortSignal }, cb: Cb): Promise<unknown> {
    if (dead.has(page)) return new Promise(() => {});
    askedCount.set(name, (askedCount.get(name) ?? 0) + 1);
    const q = queues.get(name) ?? [];
    queues.set(name, q);
    if (opts.signal?.aborted) return Promise.reject(abortError(opts.signal));
    const busy = holders.has(name) || q.length > 0;
    if (busy && opts.ifAvailable) return Promise.resolve().then(() => cb(null));
    return new Promise((resolve, reject) => {
      const w: Waiter = { page, cb, resolve, reject, signal: opts.signal };
      if (!busy) { run(name, w); return; }
      if (opts.signal) {
        w.onAbort = () => {
          const i = q.indexOf(w);
          if (i >= 0) { q.splice(i, 1); reject(abortError(opts.signal)); }
        };
        opts.signal.addEventListener('abort', w.onAbort);
      }
      q.push(w);
      // A waiting request for a name a cached page holds evicts that page.
      const h = holders.get(name);
      if (h && cached.has(h)) setTimeout(() => evict(h), 0);
    });
  }

  return {
    page: id => ({ request: (name, opts, cb) => request(id, name, opts, cb) }),
    kill: evict,
    cache: id => { cached.add(id); },
    holder: name => holders.get(name) ?? null,
    heldBy: page => [...holders].filter(([, p]) => p === page).map(([n]) => n),
    asked: name => askedCount.get(name) ?? 0,
  };
}
