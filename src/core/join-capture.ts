/**
 * The `#/join/<code>` door's first step: the code
 * leaves the address bar before Atlas does anything else. `main.ts` calls
 * `captureJoinCode` before the app starts, and the app calls it again on every
 * render, for a link opened into a tab that was already running.
 *
 * The code rides the fragment, so it never reached a server; replacing the
 * entry keeps it out of history, Back and any later copy of the URL. It is
 * held here, in memory only, until the door takes it.
 */

/** keel's join code: `ow_j_` + urlsafe characters (accounts/agents.py). */
export const JOIN_CODE_RE = /^ow_j_[\w-]{16,128}$/;

/** '' = a join link whose code did not look like one (a truncated paste). */
let pending: string | null = null;

/** Takes `#/join/<code>` out of the address bar. True when one was there. */
export function captureJoinCode(
  loc: Pick<Location, 'hash'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = history,
): boolean {
  const m = /^#\/?join(?:$|\/([^/?#]*))/.exec(loc.hash);
  if (!m) return false;
  hist.replaceState(hist.state, '', '#/');
  const code = m[1] ?? '';
  pending = JOIN_CODE_RE.test(code) ? code : '';
  return true;
}

/** True while a captured code waits for the door. */
export function hasPendingJoin(): boolean {
  return pending !== null;
}

/** The waiting code ('' when malformed), handed over once; null when none. */
export function takePendingJoin(): string | null {
  const code = pending;
  pending = null;
  return code;
}
