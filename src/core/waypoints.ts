/**
 * Waypoints: the list on Settings, OnlyWorlds, as the memory of what the
 * open world can do (onboarding step 1, the guide). The five are the guide's
 * dots (`core/guide.ts`); the ring is four more things a world can do, each
 * with its one way in. Every row is lit from the world itself, never stored,
 * so an imported world reads as what it holds.
 *
 * The toasts, the completion stamps and the home receipts that lived here
 * retired with the guide: what a gesture earns is a note now (`ui/guide-note.ts`).
 */

import type { Element, WorldRegistryEntry } from './types';
import { knowledgeHash, settingsHash, timelineHash, writingHash } from './router';
import { guideDots, guideElements, type DotId } from './guide';
import { isKnowledgeNarrative } from './knowledge';
import { isPageNarrative } from './sharing';

export type RingId = 'ring-map' | 'ring-knowledge' | 'ring-reader' | 'ring-traits';
export type WaypointId = DotId | RingId;

export interface WaypointDef {
  id: WaypointId;
  name: string;
  /** One plain line: what the world can do with it. */
  concept: string;
  /** The unlit row's invitation, and its arrow's label. */
  action: string;
  /** Material Symbols glyph for the unlit row. */
  glyph: string;
  /** The way in; null when no world is open. */
  link: (worldId: string | null) => string | null;
  /** The Journey's Atlas chapter steps the row covers (Boss's walk marks them). */
  chapter: readonly string[];
}

export const OW_COUNCIL_URL = 'https://council.onlyworlds.com';

const elementsRoom = (w: string | null): string | null => (w ? `#/w/${w}/elements` : null);

/** The five, in the guide's order. */
export const PATH_WAYPOINTS: readonly WaypointDef[] = [
  { id: 'someone', name: 'Someone', concept: 'A Character is someone.', action: 'Create a Character.', glyph: 'person', link: elementsRoom, chapter: ['A5'] },
  { id: 'placed', name: 'Somewhere', concept: 'A Character can be at a Location, and the Location lists who is there.', action: 'Set a Character\'s Location.', glyph: 'castle', link: elementsRoom, chapter: ['A5', 'A6', 'A6-located'] },
  { id: 'happened', name: 'Something happened', concept: 'An Event with a year has its place on the chart.', action: 'Give an Event a year.', glyph: 'insights', link: w => (w ? timelineHash(w) : null), chapter: ['A14'] },
  { id: 'story', name: 'A story', concept: 'A Narrative is a story that is told, and its text can link what it mentions.', action: 'Start a book in the writing room.', glyph: 'menu_book', link: w => (w ? writingHash(w) : null), chapter: ['A13'] },
  { id: 'copy', name: 'A copy', concept: 'A copy can be one downloaded file, a folder on your drive, or your onlyworlds.com account.', action: 'Download your world, move it to a folder, or take it online.', glyph: 'download', link: w => (w ? settingsHash(w, 'world') : null), chapter: ['A7'] },
];

/** More your world can do: unordered, Settings only in this step. */
export const RING_WAYPOINTS: readonly WaypointDef[] = [
  { id: 'ring-map', name: 'Places on a map', concept: 'Maps, pins and zones are world data too, in the same format.', action: 'Place a pin on a map.', glyph: 'location_on', link: w => (w ? `#/w/${w}` : null), chapter: ['A11', 'A20'] },
  { id: 'ring-knowledge', name: 'Who knows what', concept: 'What a character knows is recorded in your world: an entry, what it is about, and who holds it.', action: 'Record something a character knows, in the knowledge room.', glyph: 'psychology', link: w => (w ? knowledgeHash(w) : null), chapter: [] },
  { id: 'ring-reader', name: 'A page to share', concept: 'A page shows the elements you pick at a public address.', action: 'Make a page in the pages room.', glyph: 'public', link: w => (w ? `#/w/${w}/share` : null), chapter: ['A17'] },
  { id: 'ring-traits', name: 'What they have and live under', concept: 'Traits, Abilities and Laws say what someone is like, can do, and must answer to.', action: 'Create a Trait, an Ability or a Law.', glyph: 'auto_awesome', link: elementsRoom, chapter: [] },
];

/** Which rows are lit for this world, from the world itself. */
export function waypointsLit(all: readonly Element[], entry: WorldRegistryEntry | undefined, keepSafeShowing: boolean): Record<WaypointId, boolean> {
  const dots = guideDots(all, entry, { keepSafeShowing });
  const els = guideElements(all);
  return {
    ...dots,
    'ring-map': els.some(e => e.type === 'pin'),
    'ring-knowledge': els.some(e => isKnowledgeNarrative(e)),
    'ring-reader': els.some(e => isPageNarrative(e)),
    'ring-traits': els.some(e => e.type === 'trait' || e.type === 'ability' || e.type === 'law'),
  };
}
