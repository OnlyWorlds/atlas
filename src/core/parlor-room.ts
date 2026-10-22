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
import { getState } from './state';

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

/**
 * The world as its whole views read it (1.76, OW Parlor #543): without the
 * room while `ui.hideRoom` is on, which it is by default. One switch for the
 * element list, Home, an element's references and Web, Charts and Search.
 * A room element still opens by its id (a link, the palette with the room
 * shown, the map). Memoised on the elements array and the switch, so a
 * render gate keyed on the result redraws exactly when either moves, and a
 * world with no room returns its own array.
 */
let loreMemo: { from: readonly Element[]; hide: boolean; out: Element[] } | null = null;
export function loreElements(elements: Element[], hide: boolean): Element[] {
  if (loreMemo && loreMemo.from === elements && loreMemo.hide === hide) return loreMemo.out;
  const out = hide && elements.some(isRoomElement) ? elements.filter(el => !isRoomElement(el)) : elements;
  loreMemo = { from: elements, hide, out };
  return out;
}

/** The world as the whole views read it now. */
export function currentLore(): Element[] {
  const s = getState();
  return loreElements(s.data.elements, s.ui.hideRoom);
}

/** How many of the room's elements the world holds, shown or not. */
export function roomCount(elements: readonly Element[]): number {
  let n = 0;
  for (const el of elements) if (isRoomElement(el)) n++;
  return n;
}
