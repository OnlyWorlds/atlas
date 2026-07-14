/**
 * The home tour kernel (S264) — the tutorial-state card computation, pure.
 * Design record: `Forge/Notes/2026-07-13-s264-tour-design.md`.
 *
 * The tour is a function of world contents + the per-world dismissed set:
 *
 *   Phase 1 (the core pair): while character/location are missing, their
 *   create cards show HIGHLIGHTED (the only highlighted cards, ever) — plus
 *   the "anything else" tile, handled by the renderer.
 *
 *   Phase 2 (both cores exist): one quiet, dismissible create card per
 *   missing next-wave type; a created type's card turns into its room CTA
 *   (also dismissible). All present or dismissed → the tour renders nothing.
 *
 * No step counters, no stored progress — imports, deletes, and sync just
 * recompute the truth.
 */

import type { ElementType } from '../core/types';

export type TourRoom = 'timeline' | 'import' | 'writing' | 'map' | 'share' | 'knowledge';

export interface TourWaveEntry {
  type: ElementType;
  room: TourRoom;
  verb: string;
  icon: string;   // the room-nav glyph, so the CTA teaches the nav icon too
  line: string;   // one quiet clause under the verb
}

/**
 * The next wave, in display order. NOTE the map deviation from Captain's note
 * (he wrote zone→map): zones are only drawn ON a map — the MAP is the
 * creatable element that teaches the same room. Flagged for his round.
 * Collective→Knowledge is his settled call: circles ARE collectives.
 */
export const TOUR_WAVE: TourWaveEntry[] = [
  { type: 'event',      room: 'timeline',  verb: 'Chart',  icon: 'insights',      line: 'elements in time' },
  { type: 'narrative',  room: 'writing',   verb: 'Write',  icon: 'menu_book',     line: 'tell it as a story' },
  { type: 'map',        room: 'map',       verb: 'Map',    icon: 'map',           line: 'ground your world' },
  { type: 'collective', room: 'knowledge', verb: 'Know',   icon: 'psychology',    line: 'who knows what' },
  { type: 'construct',  room: 'share',     verb: 'Share',  icon: 'wall_art',      line: 'a page of your world' },
  { type: 'object',     room: 'import',    verb: 'Export', icon: 'import_export', line: 'your entire world' },
];

export type TourCard =
  | { kind: 'create'; id: string; type: ElementType; highlighted: boolean; dismissible: boolean }
  | { kind: 'cta'; id: string; entry: TourWaveEntry };

/** The cards the home tour shows right now. Pure + deterministic. */
export function computeTourCards(
  counts: ReadonlyMap<string, number>,
  dismissed: ReadonlySet<string>,
): TourCard[] {
  const has = (t: string): boolean => (counts.get(t) ?? 0) > 0;
  const cards: TourCard[] = [];
  const coreMissing = !has('character') || !has('location');
  if (coreMissing) {
    for (const t of ['character', 'location'] as const) {
      if (!has(t)) cards.push({ kind: 'create', id: `create-${t}`, type: t, highlighted: true, dismissible: false });
    }
    return cards; // the next wave waits for both cores
  }
  for (const entry of TOUR_WAVE) {
    if (!has(entry.type)) {
      const id = `create-${entry.type}`;
      if (!dismissed.has(id)) {
        cards.push({ kind: 'create', id, type: entry.type, highlighted: false, dismissible: true });
      }
    } else {
      const id = `cta-${entry.type}`;
      if (!dismissed.has(id)) cards.push({ kind: 'cta', id, entry });
    }
  }
  return cards;
}
