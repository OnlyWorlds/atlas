/**
 * Failures nothing caught (S369, lane X stage 5).
 *
 * A promise that rejects with no handler used to vanish into the console: the
 * button did nothing and nobody said why. This listens for those and says it
 * once, with Copy details and Send feedback, so the person knows something
 * went wrong and the report reaches us.
 *
 * Quiet by design: an error a site already showed (`problemWasShown`), a
 * cancel, a stale code file (the reload banner says that one), and anything
 * seen before in this session (same class and message) say nothing, and at
 * most three are said per session. A wall of toasts from one stuck loop
 * would be worse than the silence it replaces.
 */
import { classifyError, problemWasShown } from '../core/problems';
import { isCodeLoadError } from '../core/reload-offer';
import { showProblem } from './problem-fixes';

const MAX_PER_SESSION = 3;
const seen = new Set<string>();

function signature(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  const message = (err as { message?: unknown } | null)?.message;
  return `${typeof name === 'string' ? name : typeof err}:${typeof message === 'string' ? message.slice(0, 120) : String(err).slice(0, 120)}`;
}

/** Decide and show; returns true when a toast was shown. Exported for tests. */
export function reportUnexpected(err: unknown): boolean {
  if (err === undefined || err === null) return false;
  if (problemWasShown(err) || isCodeLoadError(err)) return false;
  if (classifyError(err) === 'cancelled') return false;
  const sig = signature(err);
  if (seen.has(sig) || seen.size >= MAX_PER_SESSION) return false;
  seen.add(sig);
  showProblem(err, { doing: 'working in the background', unexpected: true });
  return true;
}

let installed = false;

export function installUnexpectedErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('unhandledrejection', (e) => {
    console.error('[atlas] unhandled rejection:', e.reason);
    reportUnexpected(e.reason);
  });
}

/** Test seam. */
export function __resetUnexpectedErrors(): void {
  seen.clear();
}
