/**
 * Flush-before-leaving-a-world (S360, the F1 data loss).
 *
 * The writing, knowledge and share rooms debounce their prose saves (1 s by
 * default, up to an hour by setting). A world switch used to empty the
 * element cache synchronously before anything flushed, the room saw its
 * element vanish, and the pending text was dropped with no undo.
 *
 * Each room registers its "save what is pending, now" function here beside
 * its `pagehide` safety net (same job, different trigger), and every flow
 * that swaps the active world awaits `flushBeforeLeavingWorld()` FIRST, while
 * the old store and the old elements are still in place.
 */

type Flush = () => Promise<unknown> | void;

const flushes = new Set<Flush>();

/** Register a room's leave-flush. Returns the unregister call for its cleanup. */
export function onLeaveWorld(fn: Flush): () => void {
  flushes.add(fn);
  return () => { flushes.delete(fn); };
}

/** Run every registered flush and wait for all of them. Never throws. */
export async function flushBeforeLeavingWorld(): Promise<void> {
  if (flushes.size === 0) return;
  const results = await Promise.allSettled([...flushes].map(fn => Promise.resolve().then(fn)));
  for (const r of results) {
    if (r.status !== 'rejected') continue;
    console.warn('[atlas] a pending save failed while leaving the world:', r.reason);
    // Said, not only logged (S369): the last keystrokes did not reach the
    // folder. Loaded on demand: core does not import the UI layer statically.
    const reason = r.reason;
    void import('../ui/problem-fixes').then(({ showProblem }) => {
      showProblem(reason, { doing: 'saving your last changes before leaving the world' });
    }).catch(() => {});
  }
}
