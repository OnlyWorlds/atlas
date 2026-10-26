/**
 * Per-id write serialization (convention #79).
 *
 * FolderStore.updateElement is a read-merge-write: two concurrent updates to
 * the SAME element race the read — the second call's snapshot predates the
 * first call's write, so the merge silently reverts the first patch's fields
 * (the lost-update class the share-room e2e caught). Rooms used
 * to defend individually (share-room's promise chain, convention #77); this
 * helper moves the guarantee to the store boundary so every caller — every
 * room, modal, popover, and future surface — gets it without remembering.
 *
 * Scope: per-id. Operations on DIFFERENT elements stay concurrent (no global
 * lock); only same-id operations queue. A rejected operation surfaces to its
 * own caller and does NOT poison the chain — the next queued op still runs.
 *
 * What this can't fix: a patch COMPUTED from a stale in-memory snapshot (e.g.
 * a whole blocks array built before a prior write refreshed state). Callers
 * doing read-compute-write over arrays still need await discipline (see
 * share-room's chain, convention #77).
 */
export class PerIdWriteChain {
  private tails = new Map<string, Promise<void>>();

  /** Run `fn` after every previously-queued op for `id` has settled. */
  run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    // Stored tails never reject (swallowed below), so a plain .then suffices.
    const prev = this.tails.get(id) ?? Promise.resolve();
    const result = prev.then(fn);
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(id, tail);
    void tail.then(() => {
      // Drop the entry once this id's queue drains (no unbounded growth).
      if (this.tails.get(id) === tail) this.tails.delete(id);
    });
    return result;
  }
}
