/**
 * The activation chain — ONE serializer for every flow that touches the
 * SHARED active FolderStore: world activation (worlds-sidebar), the
 * link-existing download (LinkWorldModal), and the account-mode open flow.
 *
 * Why (gate R2, 2026-07-13, generalizing the session-249 activation race):
 * concurrent flows interleave on the shared store — a world click's
 * `prior.close()` closes a mid-flight download's just-opened store, or a
 * download's trailing `setActiveStore` clobbers the world the user just
 * activated. Everything that closes/opens/sets the active store runs here.
 *
 * Two entry shapes:
 *   - `enqueueActivation(fn)` — for world activations: carries a sequence
 *     number so a queued activation superseded by a NEWER click is skipped
 *     instead of run (the double-click case).
 *   - `enqueueActivationTask(fn)` — for link/download flows: never
 *     superseded, always runs, serialized with everything else.
 *
 * The chain itself never rejects downstream — failures reach only the caller.
 */

let activationSeq = 0;
let chain: Promise<unknown> = Promise.resolve();

/** Current activation sequence number (bumped by enqueueActivation). */
export function nextActivationGen(): number {
  return ++activationSeq;
}

export function currentActivationGen(): number {
  return activationSeq;
}

/**
 * Queue an activation. `fn` receives its generation; it should early-return
 * when superseded (`gen !== currentActivationGen()`).
 */
export function enqueueActivation<T>(fn: (gen: number) => Promise<T>): Promise<T> {
  const gen = nextActivationGen();
  const run = chain.then(() => fn(gen));
  chain = run.then(() => undefined, () => undefined);
  return run;
}

/**
 * Queue a non-supersedable task (link download, account open). Always runs;
 * serialized against activations and other tasks.
 */
export function enqueueActivationTask<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}
