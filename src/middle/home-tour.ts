/**
 * The home's onboarding kernel, pure: which cards the world home shows.
 * Design: `Forge/Notes/2026-10-09-s383-newcomer-flow-design.md` (1.20 block);
 * the cards since S264 (`Forge/Notes/2026-07-13-s264-tour-design.md`).
 *
 *   The core pair: a character and a location. While either is missing the
 *   home asks "What do you have?", and the pair are its first answer.
 *
 *   Grow: once both exist, more element types are suggested, each one
 *   introducing the room it lives in (the Captain, h20 #2081: the cards are
 *   the route; the waypoints are achievements in Settings, not the route).
 *
 * A card the world already has stays where it was, done (greyed, checked),
 * so the layout holds still as the world grows; done, it opens its room.
 * No stored progress: imports, deletes and sync just recompute the truth.
 */

import type { ElementType } from '../core/types';

export type TourRoom = 'element' | 'timeline' | 'writing' | 'map' | 'knowledge';

export interface CardDef {
  type: ElementType;
  /** Where a done card goes: the room this type introduces. */
  room: TourRoom;
  /** The room-nav glyph of that room, so the card teaches the nav icon too. */
  roomIcon: string;
  /** One quiet clause: what this type gives the world. */
  line: string;
}

export const CORE_CARDS: readonly CardDef[] = [
  { type: 'character', room: 'element', roomIcon: 'person', line: 'someone' },
  { type: 'location', room: 'element', roomIcon: 'castle', line: 'somewhere' },
];

/**
 * The grow wave, in display order. Construct and object left it in 1.20 (the
 * Captain's Q1): Share and Export were never what those types are for.
 * Collective opens Knowledge because circles ARE collectives (his S264 call).
 */
export const GROW_CARDS: readonly CardDef[] = [
  { type: 'event', room: 'timeline', roomIcon: 'insights', line: 'see it on a chart' },
  { type: 'narrative', room: 'writing', roomIcon: 'menu_book', line: 'tell it as a story' },
  { type: 'map', room: 'map', roomIcon: 'map', line: 'put places on it' },
  { type: 'collective', room: 'knowledge', roomIcon: 'psychology', line: 'who knows what' },
];

export interface HomeCard {
  def: CardDef;
  done: boolean;
}

export type HomeCards =
  | { phase: 'core'; cards: HomeCard[] }
  | { phase: 'grow'; cards: HomeCard[] };

/** The cards right now, or null once every card is done. Pure + deterministic. */
export function computeHomeCards(counts: ReadonlyMap<string, number>): HomeCards | null {
  const has = (t: string): boolean => (counts.get(t) ?? 0) > 0;
  const core = CORE_CARDS.map(def => ({ def, done: has(def.type) }));
  if (core.some(c => !c.done)) return { phase: 'core', cards: core };
  const grow = GROW_CARDS.map(def => ({ def, done: has(def.type) }));
  if (grow.every(c => c.done)) return null;
  return { phase: 'grow', cards: [...core, ...grow] };
}
