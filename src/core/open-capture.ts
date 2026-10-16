/**
 * The `#/open/<world id>` door's first step (OW Infra #104, S416): a world
 * page on onlyworlds.com opens that world in Atlas by its id. The id is no
 * credential (the signed-in account is), but it leaves the address bar the
 * same way a join code does, so a reload, Back or a copied URL never opens
 * the world twice. `main.ts` calls `captureOpenWorld` before the app starts,
 * and the app calls it again on every render, for a link opened into a tab
 * that was already running. The door: `setup/open-door.ts`.
 */

/** keel's world ids are UUIDs. */
const WORLD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** '' = an open link whose id did not look like one (a truncated paste). */
let pending: string | null = null;

/** Takes `#/open/<id>` out of the address bar. True when one was there. */
export function captureOpenWorld(
  loc: Pick<Location, 'hash'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = history,
): boolean {
  const m = /^#\/?open(?:$|\/([^/?#]*))/.exec(loc.hash);
  if (!m) return false;
  hist.replaceState(hist.state, '', '#/');
  const id = (m[1] ?? '').toLowerCase();
  pending = WORLD_ID_RE.test(id) ? id : '';
  return true;
}

/** True while a captured id waits for the door. */
export function hasPendingOpen(): boolean {
  return pending !== null;
}

/** The waiting id ('' when malformed), handed over once; null when none. */
export function takePendingOpen(): string | null {
  const id = pending;
  pending = null;
  return id;
}
