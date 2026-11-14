/**
 * The one rule for stamping a sync baseline onto an element (H1).
 *
 * A push reads the element, sends it, and stamps `server_updated_at` from the
 * response. If the user edited the element WHILE the request was in flight,
 * the file's `local_updated_at` has moved past what was sent, but it can
 * still sort at or below the server's new timestamp (the server processed
 * the request after the edit, or this device's clock runs slow). Then
 * `local_updated_at > server_updated_at` is false, the element reads clean,
 * and the edit is never uploaded; the next pull can then overwrite it too.
 *
 * So the stamp takes the `local_updated_at` the pushed body carried. When the
 * file no longer matches it, the edit is newer than anything the server has:
 * keep the new baseline, and lift `local_updated_at` just past it so the
 * element stays dirty and the next push sends the edit.
 *
 * `null` means the caller KNOWS the server holds different
 * content (a create adopted after a lost response): keep the element dirty
 * whatever the timestamps say, so the local body goes out as an UPDATE.
 *
 * Pure, shared by FsFolderStore and the MockFolderStore fixture (parity).
 */
import { instantOf } from '@onlyworlds/sdk';
import type { Element } from '../core/types';
import { HIDDEN_SHOWN_ONLINE, isHiddenMark } from '../core/hidden-mark';

/**
 * The one ORDERING of two element times (DESIGN_LAWS conv. 190, R1): each read
 * as the message profile reads a time (`instantOf`: one ISO form, an instant,
 * any offset, no offset read as UTC, microseconds kept), never as text. keel
 * writes `isoformat()` (`…07.089123+00:00`, no fraction on a whole second),
 * Atlas `toISOString()` (`…07.089Z`), another tool any offset: as text an edit
 * at `00:10:00-05:00` sorts before keel's `05:06:07+00:00` and reads synced.
 *
 * `null` when either side is absent or unreadable: each caller takes its
 * mildest reading of that (R3), so it is never folded into an order here (the
 * SDK's `compareInstants` sorts an unreadable time after every readable one,
 * which would read as newer). Equality of a stamp Atlas read or sent before is
 * an echo, not a time, and stays text (R2).
 */
export function stampOrder(a: unknown, b: unknown): -1 | 0 | 1 | null {
  const x = instantOf(a);
  const y = instantOf(b);
  if (!x || !y) return null;
  if (x.seconds !== y.seconds) return x.seconds < y.seconds ? -1 : 1;
  if (x.microseconds !== y.microseconds) return x.microseconds < y.microseconds ? -1 : 1;
  return 0;
}

/**
 * "Was it edited since the baseline?": `stamp` after `baseline`, or either one
 * absent or unreadable. Asked of the local copy (R3: an unknown local stamp
 * reads as changed: uploaded, kept, a conflict, never pulled over) and of keel's
 * copy (an unknown baseline reads as keel moved: a conflict, never a quiet skip).
 */
export function editedSince(stamp: unknown, baseline: unknown): boolean {
  const o = stampOrder(stamp, baseline);
  return o === null || o === 1;
}

/**
 * The first millisecond stamp after keel's instant (R4a): floor to the
 * millisecond, plus one, in `toISOString()`'s form. Equal to keel's instant plus
 * one microsecond rounded up to the millisecond, so it sorts after keel's stamp
 * whatever its fraction (`.089123` → `.090`, `.999999` → the next second).
 * `null` when keel's stamp cannot be read.
 */
export function stampJustAfter(serverUpdatedAt: unknown): string | null {
  const at = instantOf(serverUpdatedAt);
  if (!at) return null;
  return new Date(at.seconds * 1000 + Math.floor(at.microseconds / 1000) + 1).toISOString();
}

export function stampedBody(
  existing: Element,
  serverUpdatedAt: string,
  sentLocalUpdatedAt?: string | null,
  kept?: Readonly<Record<string, unknown>>,
): Element {
  // A push that landed is keel's last write, through Atlas's own door: whoever wrote the copy on
  // disk before is no longer the last writer (#347: an outside edit adopted from the
  // live folder, or Make Online, pushed and stamped while the old agent mark stayed for good).
  // `kept`: what keel wrote into the element on that write and the copy keeps with the stamp, in the
  // same write (the review profile's mark on a seat's new element, conv. 168).
  const next: Element = dropLastWriter({ ...existing, ...kept, server_updated_at: serverUpdatedAt });
  // keel's word on the hidden mark (`hiddenWordOf`): kept only while the file holds the mark and the
  // answer showed it; an answer with no body leaves the word as it was.
  // A first stamp with no answer body (a `/bulk` echo) is a create keel took, which takes the mark or
  // refuses the create: a word left by a cleared baseline (a Keep, a reset, a re-key) never survives it.
  const rec = next as Record<string, unknown>;
  const said = kept !== undefined && HIDDEN_SHOWN_ONLINE in kept;
  if (!said && !existing.server_updated_at) delete rec[HIDDEN_SHOWN_ONLINE];
  if (rec[HIDDEN_SHOWN_ONLINE] !== true || !isHiddenMark(next)) delete rec[HIDDEN_SHOWN_ONLINE];
  // A first stamp is a new row on keel (a create, a re-keyed id, a create after a cleared baseline):
  // its door record is only what this answer says. One left from the element's older life (another
  // world, the old id, the pull before an Unlink) would name tools that never wrote this row, and a
  // `/bulk` echo brings no body to replace it (#760, the code gate's G1).
  if (!existing.server_updated_at && !(kept && 'doors' in kept)) delete rec.doors;
  // No edit in flight (the caller sent none, or the file still holds the stamp it sent): the
  // copy is what keel now holds. An absent or unreadable local stamp becomes keel's stamp as
  // served (R4b), so the copy reads clean next round instead of uploading every round.
  if (sentLocalUpdatedAt === undefined
    || (sentLocalUpdatedAt !== null && existing.local_updated_at === sentLocalUpdatedAt)) {
    if (instantOf(existing.local_updated_at) === null) next.local_updated_at = serverUpdatedAt;
    return next;
  }
  // Edited in flight. Already after the baseline: nothing to do. Otherwise lift it just past
  // keel's instant (R4a); an unreadable keel stamp lifts nothing, and the stamp is now.
  if (stampOrder(existing.local_updated_at, serverUpdatedAt) === 1) return next;
  next.local_updated_at = stampJustAfter(serverUpdatedAt) ?? new Date().toISOString();
  return next;
}

/**
 * The stamp of a local edit: now, or just past the element's sync baseline
 * when this device's clock is behind the server's. The baseline is
 * the SERVER's `updated_at`, the edit's stamp this device's clock; with keel
 * measured about 1.5 s ahead of the crew's laptop, an edit made in that
 * window after a sync sorted below its own baseline, read clean, and was
 * never uploaded (found live: a cleared image URL that never reached keel).
 * An edit is always newer than the baseline it was made on. Shared by
 * FsFolderStore and the MockFolderStore fixture (parity).
 */
/**
 * A local edit is this person's: who last wrote the element on the server
 * (`changed_by`, `changed_via`, `changed_client`) no longer describes it, and the
 * next push is made through Atlas's own door. Dropped on every edit, so the
 * quiet agent mark (#347, `src/core/agent-mark.ts`) never sits on a person's
 * change; the next pull brings keel's word back. `created_by` stays: the
 * creator does not change. Mutates and returns `next`. Shared by
 * FsFolderStore and the MockFolderStore fixture (parity).
 */
export function dropLastWriter(next: Element): Element {
  const rec = next as Record<string, unknown>;
  delete rec.changed_by;
  delete rec.changed_via;
  delete rec.changed_client; // keel: the software of that last write, the same kind of word
  return next;
}

export function editStamp(now: string, serverUpdatedAt: unknown): string {
  // After keel's instant already: now. Otherwise just past it (R4a), the comparison an
  // instant's (keel's `.089500` is after a `.089Z` now); an unreadable baseline lifts nothing.
  if (stampOrder(now, serverUpdatedAt) === 1) return now;
  return stampJustAfter(serverUpdatedAt) ?? now;
}
