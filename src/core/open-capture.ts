/**
 * The `#/open/<world id>` door's first step: a world
 * page on onlyworlds.com opens that world in Atlas by its id. The id is no
 * credential (the signed-in account is), but it leaves the address bar the
 * same way a join code does, so a reload, Back or a copied URL never opens
 * the world twice. `main.ts` calls `captureOpenWorld` before the app starts,
 * and the app calls it again on every render, for a link opened into a tab
 * that was already running. The door: `setup/open-door.ts`.
 *
 * The link can name where to land too: `#/open/<world id>/element/<id>`
 * for one element, `#/open/<world id>/elements/<id>,<id>,…` for a work packet (a
 * parlor work item, the doctor's list). The world opens by the same door; the
 * landing waits for it (`core/open-landing.ts`).
 */

/** keel's world ids and element ids are UUIDs. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A packet longer than this is cut: a link is not a bulk export. */
export const OPEN_PACKET_MAX = 200;

/** '' = an open link whose id did not look like one (a truncated paste). */
let pending: string | null = null;
let pendingElements: string[] = [];

/** Takes `#/open/<id>[/element/<id> | /elements/<ids>]` out of the address bar. True when one was there. */
export function captureOpenWorld(
  loc: Pick<Location, 'hash'> = window.location,
  hist: Pick<History, 'replaceState' | 'state'> = history,
): boolean {
  const m = /^#\/?open(?:$|\/([^/?#]*)(?:\/(element|elements)\/([^/?#]*))?)/.exec(loc.hash);
  if (!m) return false;
  hist.replaceState(hist.state, '', '#/');
  const id = (m[1] ?? '').toLowerCase();
  pending = UUID_RE.test(id) ? id : '';
  pendingElements = [];
  if (pending && m[3]) {
    const raw = decodeURIComponent(m[3]).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const ids = m[2] === 'element' ? raw.slice(0, 1) : raw;
    for (const e of ids) {
      if (UUID_RE.test(e) && !pendingElements.includes(e)) pendingElements.push(e);
      if (pendingElements.length >= OPEN_PACKET_MAX) break;
    }
  }
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

/** The element ids the captured link named (in its order, each once), handed over once. */
export function takePendingOpenElements(): string[] {
  const ids = pendingElements;
  pendingElements = [];
  return ids;
}
