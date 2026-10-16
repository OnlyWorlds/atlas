/**
 * Sync issues: the place to come back to (S369, lane X stage 3).
 *
 * A toast says a change could not sync once; this list remembers which
 * elements are still not syncing, per world, for this session. Settings →
 * World shows the rows with their fixes, and the sync pill counts them.
 *
 * Fed from every round result (`noteRoundIssues`, called from the engine's
 * `onSyncResult`). A round that ran to its end REPLACES the entries of the
 * side it retried: a push (or sync) round tries every locally changed
 * element, so an upload that did not fail again synced; a pull (or sync)
 * round re-applies what the server sent, so a pull-side write (recorded as
 * operation `read`) that did not fail again landed. A round that stopped
 * early (auth, busy server, offline) only ADDS.
 *
 * Not persisted: a reload starts empty and the next round rebuilds it, which
 * keeps the list from ever describing a problem that has since gone.
 */
import type { ElementType, PerElementFailure, SyncResult } from '../core/types';
import { classifyFailure, type FailureKind } from './sync-failure-copy';

export interface SyncIssue {
  element_id: string;
  type: ElementType | 'world';
  operation: PerElementFailure['operation'];
  kind: FailureKind;
  /** The failure itself, for the details block (never shown raw). */
  failure: PerElementFailure;
  /** When this element first failed in the current run of failures. */
  since: string;
  /** Rounds in a row it has failed. */
  rounds: number;
}

const byWorld = new Map<string, Map<string, SyncIssue>>();

export const SYNC_ISSUES_EVENT = 'atlas:sync-issues';

function announce(worldId: string): void {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent(SYNC_ISSUES_EVENT, { detail: { worldId } }));
}

/**
 * Fold one round's result into the world's list. Returns true when the list
 * changed (the caller repaints the pill).
 */
export function noteRoundIssues(
  worldId: string,
  phase: 'push' | 'pull' | 'sync',
  result: Pick<SyncResult, 'failures' | 'auth_blocked' | 'transient_blocked'>,
  now: string = new Date().toISOString(),
): boolean {
  const prev = byWorld.get(worldId) ?? new Map<string, SyncIssue>();
  // A round that ran to its end replaces the entries of the side it retried
  // (S369, gate A M5): a push never retries a pull's write, and a pull never
  // retries an upload. A sync round does both.
  const complete = !result.auth_blocked && !result.transient_blocked;
  const replaces = (side: 'push' | 'pull'): boolean =>
    complete && (phase === 'sync' || phase === side);
  const next = new Map<string, SyncIssue>(
    [...prev].filter(([, i]) => !replaces(sideOf(i.failure))),
  );
  for (const f of result.failures) {
    // A refused key is the world's, said by the pill, the toast and Settings'
    // key block (#198): the element that happened to carry the request did
    // nothing wrong, and its row read "OnlyWorlds did not accept it".
    if (result.auth_blocked && isKeyRefusal(f)) continue;
    const before = prev.get(f.element_id);
    next.set(f.element_id, {
      element_id: f.element_id,
      type: f.type,
      operation: f.operation,
      kind: classifyFailure(f),
      failure: f,
      since: before?.since ?? now,
      rounds: (before?.rounds ?? 0) + 1,
    });
  }
  const changed = next.size !== prev.size
    || [...next].some(([id, i]) => prev.get(id)?.kind !== i.kind || prev.get(id)?.rounds !== i.rounds);
  if (next.size === 0) byWorld.delete(worldId);
  else byWorld.set(worldId, next);
  if (changed) announce(worldId);
  return changed;
}

/** A failure that is the key's refusal, not the element's: a 401, or a read key's 403. */
function isKeyRefusal(f: PerElementFailure): boolean {
  return f.status === 401 || (f.status === 403 && f.code === 'permission_error');
}

/** Which kind of round retries this failure: a pull-side write is recorded as `read`. */
export function sideOf(f: PerElementFailure): 'push' | 'pull' {
  return f.operation === 'read' ? 'pull' : 'push';
}

/** The world's open issues, the most actionable kinds first, then oldest first. */
export function issuesFor(worldId: string | null | undefined): SyncIssue[] {
  if (!worldId) return [];
  const order: Record<FailureKind, number> = { foreign_id: 0, too_large: 1, other: 2, not_yours: 3, file_busy: 4 };
  return [...(byWorld.get(worldId)?.values() ?? [])]
    .sort((a, b) => order[a.kind] - order[b.kind] || a.since.localeCompare(b.since));
}

/** Forget a world's list (unlink, forget, delete). */
export function clearSyncIssues(worldId: string): void {
  if (byWorld.delete(worldId)) announce(worldId);
}

/** Test seam. */
export function __resetSyncIssues(): void {
  byWorld.clear();
}
