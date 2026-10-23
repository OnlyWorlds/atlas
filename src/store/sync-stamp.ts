/**
 * The one rule for stamping a sync baseline onto an element (S360, H1).
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
 * `null` (S361, gate F3) means the caller KNOWS the server holds different
 * content (a create adopted after a lost response): keep the element dirty
 * whatever the timestamps say, so the local body goes out as an UPDATE.
 *
 * Pure, shared by FsFolderStore and the MockFolderStore fixture (parity).
 */
import type { Element } from '../core/types';

export function stampedBody(
  existing: Element,
  serverUpdatedAt: string,
  sentLocalUpdatedAt?: string | null,
  kept?: Readonly<Record<string, unknown>>,
): Element {
  // A push that landed is keel's last write, through Atlas's own door: whoever wrote the copy on
  // disk before is no longer the last writer (#347; the S415 gate: an outside edit adopted from the
  // live folder, or Make Online, pushed and stamped while the old agent mark stayed for good).
  // `kept`: what keel wrote into the element on that write and the copy keeps with the stamp, in the
  // same write (the review profile's mark on a seat's new element, conv. 168).
  const next: Element = dropLastWriter({ ...existing, ...kept, server_updated_at: serverUpdatedAt });
  if (sentLocalUpdatedAt === undefined) return next;
  if (sentLocalUpdatedAt !== null && existing.local_updated_at === sentLocalUpdatedAt) return next;
  // Edited in flight. Already newer than the baseline: nothing to do.
  if (typeof existing.local_updated_at === 'string' && existing.local_updated_at > serverUpdatedAt) return next;
  const serverMs = Date.parse(serverUpdatedAt);
  next.local_updated_at = Number.isFinite(serverMs)
    ? new Date(serverMs + 1).toISOString()
    : new Date().toISOString();
  return next;
}

/**
 * The stamp of a local edit: now, or just past the element's sync baseline
 * when this device's clock is behind the server's (S387). The baseline is
 * the SERVER's `updated_at`, the edit's stamp this device's clock; with keel
 * measured about 1.5 s ahead of the crew's laptop, an edit made in that
 * window after a sync sorted below its own baseline, read clean, and was
 * never uploaded (found live: a cleared image URL that never reached keel).
 * An edit is always newer than the baseline it was made on. Shared by
 * FsFolderStore and the MockFolderStore fixture (parity).
 */
/**
 * A local edit is this person's: who last wrote the element on the server
 * (`changed_by`, `changed_via`, keel #299) no longer describes it, and the
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
  delete rec.changed_client; // keel #520: the software of that last write, the same kind of word
  return next;
}

export function editStamp(now: string, serverUpdatedAt: unknown): string {
  if (typeof serverUpdatedAt !== 'string' || now > serverUpdatedAt) return now;
  const serverMs = Date.parse(serverUpdatedAt);
  return Number.isFinite(serverMs) ? new Date(serverMs + 1).toISOString() : now;
}
