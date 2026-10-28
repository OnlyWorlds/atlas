/**
 * The parlor's room inside a world (the parlor's design sheet, §1):
 * its lines, board entries, work items,
 * specs, hearts, votes, sittings and member cards are elements of the world
 * itself, each a type with its own supertype. "A tool that shows a world
 * whole filters the room's supertypes out": the element list's "Hide the
 * room" (#350's companion; PROGRESS NEXT 1).
 *
 * The pair AND the mark (schema-dist's room profile, dist.45): a room element
 * carries `x_room_of`, the id of the world or sitting its room belongs to,
 * written by the parlor on everything it makes. Without the mark a Narrative
 * with supertype Message is lore (a novel's letters, the Manifest's Wire) and
 * stays in view. The rule and its pairs are the SDK's since 1.77. A pair, never a supertype alone: a Location called Board is a place.
 * Member is Skeld's ruling, 2026-10-22. A supertype matches in any case, trimmed.
 *
 * The lore leaves out a second kind too, under its own switch (1.101, the
 * charter profile's rule 1): the world's reading aids, its marked Charter,
 * Guide and Domains (core/charter.ts `isReadingAid`), which Home shows first
 * at the door. An unmarked Charter Law is lore and stays in.
 */
import type { Element, ElementType } from './types';
import { ROOM_PAIRS, isRoomElement as sdkIsRoomElement } from '@onlyworlds/sdk';
import { getState, patchSlice } from './state';
import { aidKind, isReadingAid, readingAids } from './charter';

/**
 * The room profile's pairs as the SDK carries them (4.55.0, generated from
 * schema-dist's room.fixture.json, never typed by hand: the ninth,
 * relation/Take, arrived by the 4.75.0 repin), lower-cased for reading.
 * Atlas's own copy is gone.
 */
export const ROOM_SUPERTYPES: ReadonlyArray<readonly [ElementType, string]> =
  ROOM_PAIRS.map(p => [p.type, p.supertype.toLowerCase()] as const);

/**
 * The SDK's rule (4.55.0): the pair, trimmed and case-folded, AND the mark
 * `x_room_of`, read by presence since 4.100.0 (serial 83: any value but null,
 * a string only when something is left after trimming; a number counts). A
 * body whose type or supertype is not a string (a foreign file can hold
 * anything) is lore here, before the SDK is asked; the mark goes as it is.
 */
export function isRoomElement(el: Element): boolean {
  const r = el as Record<string, unknown>;
  if (typeof r.type !== 'string' || typeof r.supertype !== 'string') return false;
  return sdkIsRoomElement({ type: r.type, supertype: r.supertype, x_room_of: r.x_room_of } as never);
}

/**
 * The world as its whole views read it (1.76): without the
 * room while `ui.hideRoom` is on, which it is by default. One switch for the
 * element list, Home, an element's references and Web, Charts and Search.
 * A room element still opens by its id (a link, the palette with the room
 * shown, the map). Memoised on the elements array and the switch, so a
 * render gate keyed on the result redraws exactly when either moves, and a
 * world with no room returns its own array.
 */
// One slot per pair of switches, so the lore and the suggestions' source
// (loreWithAids) never evict each other and each keeps its identity.
const loreMemo = new Map<string, { from: readonly Element[]; out: Element[] }>();
export function loreElements(elements: Element[], hide: boolean, hideAids = true): Element[] {
  const key = `${hide ? 1 : 0}${hideAids ? 1 : 0}`;
  const hit = loreMemo.get(key);
  if (hit && hit.from === elements) return hit.out;
  const room = hide && elements.some(isRoomElement);
  const aids = hideAids && readingAids(elements).count > 0;
  const out = room || aids ? elements.filter(el => !(room && isRoomElement(el)) && !(aids && isReadingAid(el))) : elements;
  loreMemo.set(key, { from: elements, out });
  return out;
}

/**
 * The world without the room but with its reading aids, for what is not a lore
 * view: the supertype and field-name suggestions, which may still offer
 * Charter, Guide and Domain (the charter profile's writer rule; 1.101's G6).
 */
export function loreWithAids(): Element[] {
  const s = getState();
  return loreElements(s.data.elements, s.ui.hideRoom, false);
}

/** Whether the whole views hide the reading aids now: unless they were shown in this very world. */
export function aidsHidden(): boolean {
  const s = getState();
  return s.ui.showAids === null || s.ui.showAids !== s.active?.worldId;
}

/** The one switch for the reading aids (the list's chip, Home's line): shown in this world, or hidden again. */
export function toggleAids(): void {
  const s = getState();
  patchSlice('ui', { ...s.ui, showAids: aidsHidden() ? s.active?.worldId ?? null : null });
}

/** The world as the whole views read it now. */
export function currentLore(): Element[] {
  const s = getState();
  return loreElements(s.data.elements, s.ui.hideRoom, aidsHidden());
}

/**
 * What an element's page reads for its references and its Web: a room
 * element's, the whole world (1.76); a reading aid's, the lore with the aids
 * in, since its links name them (a Guide's Domains), while the room keeps its
 * own switch (1.101's D2, the code gate's C3); any other, the lore.
 */
export function pageLore(el: Element | null | undefined): Element[] {
  if (el && isRoomElement(el)) return getState().data.elements;
  return el && isReadingAid(el) ? loreWithAids() : currentLore();
}

/**
 * What the picker a field opens offers, and its candidate count: on a reading
 * aid's page, or one whose pair would make it one (an unmarked Guide picks the
 * marked Domains; the code gate's C8), the lore with the aids in; elsewhere,
 * a room element's page included, the lore (conv. 161).
 */
export function loreFor(el: Element | null | undefined): Element[] {
  return el && (isReadingAid(el) || aidKind(el) !== null) ? loreWithAids() : currentLore();
}

/** The two switches as one key, for a render gate that reads the lore (the 1.101 gate's G2, G3). */
export function loreSwitches(): string {
  return `${getState().ui.hideRoom ? 1 : 0}${aidsHidden() ? 1 : 0}`;
}

/** How many of the room's elements the world holds, shown or not. */
export function roomCount(elements: readonly Element[]): number {
  let n = 0;
  for (const el of elements) if (isRoomElement(el)) n++;
  return n;
}
