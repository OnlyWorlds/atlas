/**
 * Hold IndexedDB opens back for a while (fake-indexeddb opens at once): the
 * first `heldOpens` calls of `indexedDB.open` hand back a stand-in request
 * that the real one answers through after `delayMs`. Answers the spy, so a
 * test can count the opens and restore it.
 */
import { vi } from 'vitest';

export function slowIdbOpens(delayMs: number, heldOpens = 1): { opens: () => number; restore: () => void } {
  const real = indexedDB.open.bind(indexedDB);
  let calls = 0;
  const spy = vi.spyOn(indexedDB, 'open').mockImplementation((name: string, version?: number) => {
    calls++;
    if (calls > heldOpens) return real(name, version);
    type Handler = ((ev: unknown) => void) | null;
    const stand = { onupgradeneeded: null as Handler, onsuccess: null as Handler, onerror: null as Handler, onblocked: null as Handler } as Record<string, unknown>;
    let req: IDBOpenDBRequest | null = null;
    Object.defineProperty(stand, 'result', { get: () => req?.result });
    Object.defineProperty(stand, 'error', { get: () => req?.error });
    setTimeout(() => {
      req = real(name, version);
      for (const k of ['onupgradeneeded', 'onsuccess', 'onerror', 'onblocked'] as const) {
        req[k] = ((ev: Event) => (stand[k] as Handler)?.(ev)) as never;
      }
    }, delayMs);
    return stand as unknown as IDBOpenDBRequest;
  });
  return { opens: () => calls, restore: () => spy.mockRestore() };
}
