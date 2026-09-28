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
 * Pure, shared by FsFolderStore and the MockFolderStore fixture (parity).
 */
import type { Element } from '../core/types';

export function stampedBody(
  existing: Element,
  serverUpdatedAt: string,
  sentLocalUpdatedAt?: string,
): Element {
  const next: Element = { ...existing, server_updated_at: serverUpdatedAt };
  if (sentLocalUpdatedAt === undefined) return next;
  if (existing.local_updated_at === sentLocalUpdatedAt) return next;
  // Edited in flight. Already newer than the baseline: nothing to do.
  if (typeof existing.local_updated_at === 'string' && existing.local_updated_at > serverUpdatedAt) return next;
  const serverMs = Date.parse(serverUpdatedAt);
  next.local_updated_at = Number.isFinite(serverMs)
    ? new Date(serverMs + 1).toISOString()
    : new Date().toISOString();
  return next;
}
