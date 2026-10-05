/**
 * A minimal Web Locks API (`navigator.locks`) for vitest: jsdom has none.
 * Exclusive locks by name, queued in request order; `{ ifAvailable: true }`
 * calls back with `null` when the name is held, as the real one does. The
 * lock is held until the callback's promise settles. Shared across "tabs":
 * a test plays another tab by holding a name through `hold(name)`.
 */
type Cb = (lock: unknown) => unknown;

export interface FakeLocks {
  request(name: string, opts: { ifAvailable?: boolean } | Cb, cb?: Cb): Promise<unknown>;
  /** Another tab holds `name` until the returned release is called. */
  hold(name: string): Promise<() => void>;
  isHeld(name: string): boolean;
}

export function installFakeLocks(): { locks: FakeLocks; uninstall: () => void } {
  const tails = new Map<string, Promise<unknown>>();
  const held = new Set<string>();
  const locks: FakeLocks = {
    request(name, opts, cb) {
      const callback = (typeof opts === 'function' ? opts : cb) as Cb;
      const ifAvailable = typeof opts === 'object' && opts?.ifAvailable === true;
      if (ifAvailable && held.has(name)) return Promise.resolve(callback(null));
      const prior = tails.get(name) ?? Promise.resolve();
      const run = prior.then(async () => {
        held.add(name);
        try { return await callback({ name }); } finally { held.delete(name); }
      });
      tails.set(name, run.then(() => undefined, () => undefined));
      return run;
    },
    async hold(name) {
      let release: () => void = () => {};
      await new Promise<void>(acquired => {
        void locks.request(name, {}, () => { acquired(); return new Promise<void>(r => { release = r; }); });
      });
      return release;
    },
    isHeld: name => held.has(name),
  };
  const nav = navigator as unknown as { locks?: unknown };
  const before = Object.getOwnPropertyDescriptor(nav, 'locks');
  Object.defineProperty(nav, 'locks', { value: locks, configurable: true });
  return {
    locks,
    uninstall: () => {
      if (before) Object.defineProperty(nav, 'locks', before);
      else delete nav.locks;
    },
  };
}
