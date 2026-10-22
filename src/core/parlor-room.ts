/**
 * The parlor's room inside a world (OW Parlor, the design sheet §1,
 * `Orrery/parlor/design-sheet.md`): its lines, board entries, work items,
 * specs, hearts, votes, sittings and member cards are elements of the world
 * itself, each a type with its own supertype. "A tool that shows a world
 * whole filters the room's supertypes out": the element list's "Hide the
 * room" (#350's companion; PROGRESS NEXT 1).
 *
 * A pair, never a supertype alone: a Location called Board is a place. The
 * charter (a Law, supertype Charter) stays in: it is the world's own rule,
 * shown on Home, not a line said in the room (TC's list, h66 #9660, leaves it
 * out too). Member is Skeld's ruling, h66 #9721. A supertype matches in any
 * case, trimmed.
 */
import type { Element, ElementType } from './types';

export const ROOM_SUPERTYPES: ReadonlyArray<readonly [ElementType, string]> = [
  ['narrative', 'message'],
  ['narrative', 'board'],
  ['relation', 'work item'],
  ['construct', 'spec'],
  ['relation', 'heart'],
  ['relation', 'vote'],
  ['event', 'sitting'],
  ['character', 'member'],
];

export function isRoomElement(el: Element): boolean {
  const sup = (el as Record<string, unknown>).supertype;
  if (typeof sup !== 'string') return false;
  const s = sup.trim().toLowerCase();
  return ROOM_SUPERTYPES.some(([type, word]) => el.type === type && s === word);
}
