/**
 * Who made an element, for the element list's "Made by" filter (#350, the
 * rest of the ruling h58 #5779: "made by agents / made by people").
 *
 * keel records the creating membership as `created_by` (D72): a membership id,
 * or null for the owner (`elements/serialize.py`). The roster says what each
 * membership is (`kind`: person, player, agent; a removed row stays, so its
 * elements still answer). The seat decides, never the door (Skeld h66 #9630):
 * an owner's write through MCP is the owner's.
 *
 * It describes the FIRST write. The element page's agent mark keeps saying who
 * changed it last (`agent-mark.ts`, `changed_via`).
 *
 * Pure: the roster comes in. Unknown (null) when it cannot be told: a
 * known-of stub (keel serves `created_by` null on every stub, whoever made
 * it), a membership the roster does not hold, or no roster to ask.
 */
import type { OwMember } from '@onlyworlds/sdk';
import { isKnownOf } from '../sync/known-of';
import type { Element } from './types';

export type MadeBy = 'people' | 'agents';

/** The roster as membership id to kind; null when it has not been read. */
export type RosterKinds = ReadonlyMap<string, OwMember['kind']> | null;

export function rosterKinds(roster: readonly OwMember[] | null): RosterKinds {
  if (!roster) return null;
  const kinds = new Map<string, OwMember['kind']>();
  for (const row of roster) if (typeof row.id === 'string') kinds.set(row.id, row.kind);
  return kinds;
}

/** Whether the roster holds an agent seat, so the filter has something to tell apart. */
export function rosterHasAgent(roster: readonly OwMember[] | null): boolean {
  return !!roster && roster.some(m => m.kind === 'agent');
}

export function madeByOf(el: Element, kinds: RosterKinds): MadeBy | null {
  if (isKnownOf(el)) return null;
  const by = (el as Record<string, unknown>).created_by;
  // Null is the owner; absent is an element made here and not yet read back
  // from keel, which is this person's (Atlas never writes as an agent).
  if (by === null || by === undefined || by === '') return 'people';
  if (typeof by !== 'string' || !kinds) return null;
  const kind = kinds.get(by);
  if (!kind) return null;
  return kind === 'agent' ? 'agents' : 'people';
}
