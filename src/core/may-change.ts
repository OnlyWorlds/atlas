/**
 * May this reader change this element, or add one? For the home's grid: a
 * drop target lights only where the write would be taken (P8), so a
 * contributor's drag never lands on the owner's Event and comes back
 * refused `not_author`.
 *
 * keel's rule: the owner and a co-builder change anything; a contributor or
 * a guest changes what their own membership made. `created_by` is that
 * membership id, null for the owner (`made-by.ts`); absent is an element made
 * here and not yet read back, which is this person's. The reader's own
 * membership comes from `/me` each round (`api.membership`, beside
 * `member_role`); until a round has kept it, only an element made here counts
 * as theirs.
 *
 * A world with no role kept reads as owned, as the rest of Atlas reads it
 * (a local world, or an online one before its first round).
 *
 * Pure: the registry entry and the element come in.
 */
import type { Element, WorldRegistryEntry } from './types';
import { entryIsViewOnly } from './view-only';

function roleOf(entry: WorldRegistryEntry): string | undefined {
  return entry.api?.member_role ?? entry.api?.seat?.role;
}

export function mayChange(entry: WorldRegistryEntry | undefined, element: Element): boolean {
  if (entryIsViewOnly(entry)) return false;
  const role = entry ? roleOf(entry) : undefined;
  if (role === undefined || role === 'owner' || role === 'co_builder') return true;
  const by = (element as Record<string, unknown>).created_by;
  if (by === undefined || by === '') return true;
  // Null is the owner's; a membership is theirs only when it is this reader's own.
  const mine = entry?.api?.membership;
  return typeof by === 'string' && typeof mine === 'string' && by === mine;
}

/** May this reader add an element here? Everywhere but a view-only world. */
export function mayAdd(entry: WorldRegistryEntry | undefined): boolean {
  return !entryIsViewOnly(entry);
}
