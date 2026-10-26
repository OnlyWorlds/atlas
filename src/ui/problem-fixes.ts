/**
 * Problem toasts with their fix buttons (lane X).
 *
 * `showProblem(err, { doing, retry })` is what a catch block calls instead of
 * toasting `err.message`: `core/problems.ts` words it, this file turns its
 * `FixId`s into buttons and adds the scrubbed details block when the cause is
 * worth reporting.
 *
 * Retry closures come from the caller and must be safe to run twice (a save
 * of the same value, a pull, a push). "Copy details" and "Send feedback" are
 * the toast's own, present whenever details are.
 */
import { buildDetails, markProblemShown, problemFor, type DetailsContext, type FixId, type Problem, type ProblemOpts } from '../core/problems';
import { getState } from '../core/state';
import { navigate, settingsHash } from '../core/router';
import { effectiveSyncPaused } from '../registry/registry';
import { ensureWritable, loadHandle } from '../store/handle-vault';
import { filesWhereOf, type FilesWhere } from '../core/browser-worlds';
import { toastManager, type ToastAction, type ToastManager } from './toast-manager';

export interface FixContext {
  /** Run the failed action again. Offered only when given. */
  retry?: () => void | Promise<void>;
  /** The world the problem belongs to; the active world when omitted. */
  worldId?: string | null;
  toasts?: ToastManager;
  /** What the problem is about ("scene:<id>"): a repeat for the same key replaces its toast. */
  dedupeKey?: string;
}

/** The open world's mode for the details block. Never its name. */
export function detailsContext(): DetailsContext {
  const s = getState();
  const id = s.active?.worldId;
  const entry = id ? s.registry.worlds.find(w => w.id === id) : undefined;
  if (!entry) return { world: 'none' };
  const where = filesWhereOf(entry);
  return entry.state === 'api-linked'
    ? { world: 'linked', where, syncPaused: effectiveSyncPaused(entry, s.registry) }
    : { world: 'local', where };
}

/** Where the problem's world keeps its files: the given world, else the open one. */
function whereFor(worldId: string | null | undefined): FilesWhere {
  const s = getState();
  const id = worldId ?? s.active?.worldId;
  return filesWhereOf(id ? s.registry.worlds.find(w => w.id === id) : undefined);
}

/** Ask the browser for the folder again. Must run inside the click. */
async function allowAccess(ctx: FixContext): Promise<void> {
  const toasts = ctx.toasts ?? toastManager;
  const s = getState();
  const id = ctx.worldId ?? s.active?.worldId;
  const entry = id ? s.registry.worlds.find(w => w.id === id) : undefined;
  const handle = entry ? await loadHandle(entry.folder.handle_key) : undefined;
  if (!handle) {
    toasts.info('Atlas cannot reach this world\'s folder. Open it again from the sidebar.');
    return;
  }
  if (!(await ensureWritable(handle))) {
    toasts.info('Atlas still cannot use the folder. Choose Allow when the browser asks.');
    return;
  }
  if (ctx.retry) await ctx.retry();
  else toasts.success('Atlas can use the folder again.');
}

/** One button per fix this context can honour. */
export function resolveFixes(ids: readonly FixId[], ctx: FixContext = {}): ToastAction[] {
  const worldId = ctx.worldId ?? getState().active?.worldId ?? null;
  const out: ToastAction[] = [];
  for (const id of ids) {
    switch (id) {
      case 'retry':
        if (ctx.retry) out.push({ label: 'Retry now', run: ctx.retry });
        break;
      case 'allow-access':
        out.push({ label: 'Allow access', run: () => allowAccess(ctx) });
        break;
      case 'new-ids':
        if (worldId) out.push({ label: 'Give new ids', run: () => navigate(settingsHash(worldId, 'world')) });
        break;
      case 'open-settings':
        // The PIN lives on the OnlyWorlds tab (where sync-toasts sends a missing PIN too).
        if (worldId) out.push({ label: 'Open settings', run: () => navigate(settingsHash(worldId, 'onlyworlds')) });
        break;
      case 'sync-issues':
        // Settings → World lists what is still not syncing, with the fixes.
        if (worldId) out.push({ label: 'See what is not syncing', run: () => navigate(settingsHash(worldId, 'world')) });
        break;
      case 'reload-from-disk':
        out.push({
          label: whereFor(ctx.worldId) === 'browser' ? 'Reload the world' : 'Reload from disk',
          run: async () => (await import('./command-palette')).reloadFromDisk(),
        });
        break;
      case 'copy-details':
      case 'send-feedback':
        break; // the toast's own, with the details block
    }
  }
  return out;
}

/**
 * Toast what went wrong, in plain words, with its buttons. Returns the
 * problem so a caller can branch on its kind. Marks the error as shown, so a
 * caller further up (`problemWasShown`) does not toast it a second time.
 */
export function showProblem(err: unknown, opts: FixContext & ProblemOpts & { doing: string }): Problem {
  const problem = problemFor(err, {
    doing: opts.doing, savedLocally: opts.savedLocally, folder: opts.folder, unexpected: opts.unexpected,
    where: opts.where ?? whereFor(opts.worldId),
  });
  markProblemShown(err);
  if (problem.quiet) return problem;
  const details = problem.report ? buildDetails(problem, detailsContext()) : undefined;
  (opts.toasts ?? toastManager).problem(problem, { details, fixes: resolveFixes(problem.fixes, opts), dedupeKey: opts.dedupeKey });
  return problem;
}
