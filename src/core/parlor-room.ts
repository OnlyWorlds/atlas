/**
 * The parlor's room inside a world (OW Parlor, the design sheet §1,
 * `Orrery/parlor/design-sheet.md`): its lines, board entries, work items,
 * specs, hearts, votes, sittings and member cards are elements of the world
 * itself, each a type with its own supertype. "A tool that shows a world
 * whole filters the room's supertypes out": the element list's "Hide the
 * room" (#350's companion; PROGRESS NEXT 1).
 *
 * The pair AND the mark (schema-dist's room profile, dist.45): a room element
 * carries `x_room_of`, the id of the world or sitting its room belongs to,
 * written by the parlor on everything it makes. Without the mark a Narrative
 * with supertype Message is lore (a novel's letters, the Manifest's Wire) and
 * stays in view. The rule and its pairs are the SDK's since 1.77. A pair, never a supertype alone: a Location called Board is a place. The
 * charter (a Law, supertype Charter) stays in: it is the world's own rule,
 * shown on Home, not a line said in the room (TC's list, h66 #9660, leaves it
 * out too). Member is Skeld's ruling, h66 #9721. A supertype matches in any
 * case, trimmed.
 */
import type { Element, ElementType } from './types';
import { ROOM_PAIRS, isRoomElement as sdkIsRoomElement } from '@onlyworlds/sdk';
import { getState } from './state';

/**
 * The room profile's eight pairs as the SDK carries them (4.55.0, generated
 * from schema-dist's room.fixture.json, never typed by hand: a ninth pair
 * arrives by a repin), lower-cased for reading. Atlas's own copy is gone.
 */
export const ROOM_SUPERTYPES: ReadonlyArray<readonly [ElementType, string]> =
  ROOM_PAIRS.map(p => [p.type, p.supertype.toLowerCase()] as const);

/**
 * The SDK's rule (4.55.0): the pair, trimmed and case-folded, AND the mark
 * `x_room_of`. A body whose type, supertype or mark is not a string (a
 * foreign file can hold anything) is lore here, before the SDK is asked.
 */
export function isRoomElement(el: Element): boolean {
  const r = el as Record<string, unknown>;
  if (typeof r.type !== 'string' || typeof r.supertype !== 'string' || typeof r.x_room_of !== 'string') return false;
  return sdkIsRoomElement({ type: r.type, supertype: r.supertype, x_room_of: r.x_room_of });
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
