/**
 * Foreign ids: elements keel will not create because their id already lives
 * in ANOTHER OnlyWorlds world (the re-key's worklist).
 *
 * Pure. The engine merges each round's evidence with `mergeForeignIds`
 * inside its end-of-round sync-state mutator; the Settings line and the
 * re-key guard read `liveForeignIds` at the moment they act. A stored entry
 * is a hint, never a fact on its own (re-key gate lens 2 F7): an element that
 * was deleted, uploaded, adopted or re-keyed since simply drops out of the
 * intersection, with no removal path to remember.
 */
import type { Element, ElementType, ForeignIds } from '../core/types';

/**
 * The next stored list after a push round:
 * `thisRound ∪ (previous ∩ stillUnsynced − attempted)`, where `stillUnsynced`
 * is every element that exists locally with no server baseline after the
 * round, and `attempted` every create the round actually sent. A carried id
 * that was sent and NOT refused as foreign again leaves: it may have landed
 * with its baseline backfill failing, and re-keying it then would leave the
 * server holding it twice. Entries observed against a
 * different api world are discarded.
 */
export function mergeForeignIds(
  previous: ForeignIds | undefined,
  apiWorldId: string | null,
  thisRound: ReadonlyArray<{ id: string; type: ElementType }>,
  stillUnsynced: ReadonlySet<string>,
  now: string,
  attempted: ReadonlySet<string> = new Set(),
): ForeignIds {
  const carried = previous && previous.api_world_id === apiWorldId ? previous.ids : [];
  const byId = new Map<string, { id: string; type: ElementType; first_seen: string }>();
  const refusedAgain = new Set(thisRound.map(e => e.id));
  for (const e of carried) {
    if (!stillUnsynced.has(e.id)) continue;
    if (attempted.has(e.id) && !refusedAgain.has(e.id)) continue;
    byId.set(e.id, e);
  }
  for (const e of thisRound) {
    if (!stillUnsynced.has(e.id) || byId.has(e.id)) continue;
    byId.set(e.id, { id: e.id, type: e.type, first_seen: now });
  }
  return { api_world_id: apiWorldId, ids: Array.from(byId.values()) };
}

/** The stored entries that are still true: present locally and never synced, for this api world. */
export function liveForeignIds(
  stored: ForeignIds | undefined,
  apiWorldId: string | null,
  elements: readonly Element[],
): Array<{ id: string; type: ElementType }> {
  if (!stored || stored.api_world_id !== apiWorldId) return [];
  const unsynced = new Map<string, Element>();
  for (const e of elements) if (!e.server_updated_at) unsynced.set(e.id, e);
  return stored.ids
    .filter(e => unsynced.has(e.id))
    .map(e => ({ id: e.id, type: unsynced.get(e.id)!.type }));
}
