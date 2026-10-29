/**
 * The guide (onboarding step 1): the dots and the notes.
 *
 *   The dots are five things the world can do, worked out from the world on
 *   every draw and never stored, so an imported, old or half-built world is
 *   lit on arrival for what it has.
 *
 *   The notes are the voice: one quiet line, drawn only right after a
 *   gesture made by hand, once per browser, one at a time.
 *
 * Contract: a design note of 2026-10-27 (the guide, step 1).
 */

import { dateOf, isLens } from '@onlyworlds/sdk';
import type { Element, WorldRegistryEntry } from './types';
import { isStoryNarrative } from './narrative-kind';
import { isBrowserWorld } from './browser-worlds';
import { isRoomElement } from './parlor-room';
import { isProposed } from './review-mark';
import { linkIdsOf } from './link-ids';

export type DotId = 'someone' | 'placed' | 'happened' | 'story' | 'copy';

export interface DotDef {
  id: DotId;
  label: string;
  /** The Atlas chapter steps of the Journey this dot covers (its walk marks them). */
  chapter: readonly string[];
}

/** Display order is the "next" order. */
export const DOTS: readonly DotDef[] = [
  { id: 'someone', label: 'Someone', chapter: ['A5'] },
  { id: 'placed', label: 'Somewhere', chapter: ['A5', 'A6', 'A6-located'] },
  { id: 'happened', label: 'Something happened', chapter: ['A14'] },
  { id: 'story', label: 'A story', chapter: ['A13'] },
  { id: 'copy', label: 'A copy', chapter: ['A7'] },
];

export type Dots = Record<DotId, boolean>;

/** What the dots read: the world's own elements, never the parlor's room or a proposed one (`ui.hideRoom` cannot move a dot). */
export function guideElements(elements: readonly Element[]): Element[] {
  return elements.filter(el => !isRoomElement(el) && !isProposed(el));
}

/** A Character's place, by the link's first id (a string, a one-item list, or `{id, name}` as another tool may write it). */
export function placeIdOf(character: Element): string | null {
  const raw = (character as { location?: unknown }).location;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const id = (raw as { id?: unknown }).id;
    return typeof id === 'string' && id ? id : null;
  }
  return linkIdsOf(raw)[0] ?? null;
}

/**
 * Whether a field already holds something an action must not overwrite: any
 * link id, or any other non-empty value (an object of a shape we do not read
 * is someone's data too).
 */
export function isFilled(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Which dots are lit. Four read the world's elements alone; `copy` reads this
 * browser's entry, and is dark while the keep-safe card asks for a copy, so
 * the strip and the card never disagree. One pass, no storage.
 */
export function guideDots(
  all: readonly Element[],
  entry: WorldRegistryEntry | undefined,
  opts: { keepSafeShowing?: boolean } = {},
): Dots {
  const locations = new Set<string>();
  const places: string[] = [];
  let someone = false;
  let happened = false;
  let story = false;
  for (const el of guideElements(all)) {
    switch (el.type) {
      case 'character': {
        someone = true;
        const place = placeIdOf(el);
        if (place) places.push(place);
        break;
      }
      case 'location':
        locations.add(el.id);
        break;
      case 'event':
        if (!happened && dateOf(el) !== null) happened = true;
        break;
      case 'narrative':
        // A Chronicle is a recorded artifact (Tangle's battles), not a story told.
        if (!story && isStoryNarrative(el) && (el as { supertype?: unknown }).supertype !== 'Chronicle') story = true;
        break;
    }
  }
  const placed = places.some(p => locations.has(p));
  const copy = !!entry && !opts.keepSafeShowing && (!isBrowserWorld(entry) || entry.state === 'api-linked'
    || !!entry.kept_download_at || !!entry.kept_export_at);
  return { someone, placed, happened, story, copy };
}

// ---- The notes: what a gesture earns ----

export type NoteId = 'someone' | 'place-offer' | 'placed' | 'event' | 'dated' | 'story' | 'chapter' | 'copy' | 'reading' | 'lens';

/** The big-world note on lenses (#841's P5) speaks from this many of the world's own elements. */
export const LENS_NOTE_AT = 40;

/**
 * Whether a world this size, with no lens, hears of lenses: the note's own
 * gesture is any element made by hand. Once per world, stamped on its
 * registry entry (`lens_note_at`), never in the browser-wide `seen`. The
 * note names the newest Character, whose web it opens (none: no button).
 */
export function lensNoteEarned(gesture: Gesture, all: readonly Element[], stampedAt: string | undefined): EarnedNote | null {
  if (gesture.kind !== 'created' || stampedAt) return null;
  const els = guideElements(all);
  if (els.length < LENS_NOTE_AT || all.some(e => isLens(e))) return null;
  const ch = newestOf(els.filter(e => e.type === 'character'));
  return { id: 'lens', ...(ch ? { character: ch.id } : {}) };
}

/** A note as earned: its id and the ids its sentence and actions are about, captured at the gesture. */
export interface EarnedNote {
  id: NoteId;
  character?: string;
  location?: string;
  event?: string;
  narrative?: string;
  /** `event`: a placed pair the Event names neither of (Were there). */
  pair?: { character: string; location: string };
  /** `event`: the Event has no date and the world speaks no calendar (Set year). */
  askYear?: boolean;
  /**
   * The reward this note's gesture earned (#840): its See <name>'s world
   * button, carried on the note so a dialog's wait keeps it. `reading` is the
   * reward alone, when the gesture's own note was seen before.
   */
  rider?: Reward;
}

/**
 * A gesture made by hand. Every caller is a gesture site (a create modal
 * opened with no contextual callback, reporting after its callbacks
 * settled; the editor's location and start-date commits; a note's own
 * action): never the store, sync, import, a world file, the demo or the tour.
 */
export type Gesture =
  | { kind: 'created'; id: string }
  | { kind: 'location-set'; character: string }
  | { kind: 'date-set'; event: string };

const stampOf = (el: Element): string => {
  const r = el as { created_at?: unknown; local_updated_at?: unknown };
  return typeof r.created_at === 'string' ? r.created_at : typeof r.local_updated_at === 'string' ? r.local_updated_at : '';
};

/** The newest of a list, by when it was made (the store's order breaks a tie: last wins). */
export function newestOf<T extends Element>(list: readonly T[]): T | null {
  let best: T | null = null;
  for (const el of list) if (!best || stampOf(el) >= stampOf(best)) best = el;
  return best;
}

/** Characters an offer may place: no place at all (a gone place is not empty, and is never overwritten). */
export function unplacedCharacters(els: readonly Element[]): Element[] {
  return els.filter(e => e.type === 'character' && !isFilled((e as { location?: unknown }).location));
}

/**
 * The note a gesture earns in this world, or null. Pure: the world as it is
 * right after the gesture, its own elements only (`guideElements`).
 * `speaksCalendar`: the world's dates read through a calendar, so a bare year
 * would mean something else there.
 */
export function noteEarned(gesture: Gesture, all: readonly Element[], speaksCalendar: boolean): EarnedNote | null {
  const els = guideElements(all);
  const byId = new Map(els.map(e => [e.id, e] as const));
  const locations = els.filter(e => e.type === 'location');
  const locationIds = new Set(locations.map(e => e.id));
  const placedChars = els.filter(e => e.type === 'character' && locationIds.has(placeIdOf(e) ?? ''));
  const placeOffer = (character: Element | null, location: Element | null): EarnedNote | null =>
    character && location && placedChars.length === 0
      ? { id: 'place-offer', character: character.id, location: location.id } : null;

  if (gesture.kind === 'location-set') {
    const ch = byId.get(gesture.character);
    // Lit by this commit: it is the one placed Character in the world.
    if (!ch || placedChars.length !== 1 || placedChars[0].id !== ch.id) return null;
    return { id: 'placed', character: ch.id, location: placeIdOf(ch)! };
  }
  if (gesture.kind === 'date-set') {
    const ev = byId.get(gesture.event);
    const dated = els.filter(e => e.type === 'event' && dateOf(e) !== null);
    if (!ev || dated.length !== 1 || dated[0].id !== ev.id) return null;
    return { id: 'dated', event: ev.id };
  }

  const made = byId.get(gesture.id);
  if (!made) return null;
  switch (made.type) {
    case 'character':
      if (locations.length === 0) return { id: 'someone', character: made.id };
      return unplacedCharacters([made]).length ? placeOffer(made, newestOf(locations)) : null;
    case 'location':
      return placeOffer(newestOf(unplacedCharacters(els)), made);
    case 'event': {
      const pairChar = newestOf(placedChars);
      const names = (f: string) => linkIdsOf((made as Record<string, unknown>)[f]);
      const pair = pairChar && !names('characters').includes(pairChar.id) && !names('locations').includes(placeIdOf(pairChar)!)
        ? { character: pairChar.id, location: placeIdOf(pairChar)! } : undefined;
      const askYear = !isFilled((made as { start_date?: unknown }).start_date) && !speaksCalendar;
      return { id: 'event', event: made.id, ...(pair ? { pair } : {}), ...(askYear ? { askYear } : {}) };
    }
    case 'narrative':
      return isStoryNarrative(made) && (made as { supertype?: unknown }).supertype !== 'Chronicle'
        ? { id: 'story', narrative: made.id } : null;
    default:
      return null;
  }
}

// ---- The reward: See Ada's world (onboarding step 2, #840) ----

/** The three gestures that can make a web: the commit that placed, the commit that dated, Were there. */
export type RewardGesture = 'placed' | 'dated' | 'were-there';

export interface Reward {
  /** The Character whose web the gesture made. */
  anchor: string;
  /** The two the alone note names, by the contract's order; the count past them. */
  names: string[];
  more: number;
}

/**
 * Whether a gesture just gave the anchor its web (the #840 contract's C2, the gates' G1 and H2), pure:
 * right after it the three first dots are lit, the anchor's ring (the Web's own count, `webRingOne`,
 * proposed elements left out by the caller) holds at least two, the gesture's element (the place, or
 * the Event) is in it, and the ring without that element holds fewer than two. So an import, a sync,
 * an arrived world or a year on an Event that linked nothing new earns nothing.
 * `place`: the anchor's place, named first when the Web draws it (H17).
 */
export function rewardEarned(dots: Dots, anchor: string, ring: readonly string[], element: string, place: string | null): Reward | null {
  if (!dots.someone || !dots.placed || !dots.happened) return null;
  const others = ring.filter(id => id !== anchor);
  if (others.length < 2 || !others.includes(element)) return null;
  if (others.filter(id => id !== element).length >= 2) return null;
  const order = [...(place && others.includes(place) ? [place] : []), element, ...others];
  const names = [...new Set(order)].slice(0, 2);
  return { anchor, names, more: others.length - names.length };
}

// ---- The notes: what this browser remembers ----

const GUIDE_KEY = 'atlas_guide_v1';
const OLD_WAYPOINTS_KEY = 'atlas_waypoints_v1';
const OLD_WAYPOINT_COUNT = 13;

export interface GuideState {
  seen: Partial<Record<NoteId, string>>;
  off: boolean;
}

/**
 * Read fresh every time (another tab may have drawn a note). The first read
 * carries the old switch over: a person who turned the waypoint messages
 * off, or marked all thirteen familiar, starts with the notes off.
 */
export function loadGuideState(): GuideState {
  try {
    const raw = localStorage.getItem(GUIDE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<GuideState>;
      return { seen: { ...(p.seen ?? {}) }, off: p.off === true };
    }
    const old = JSON.parse(localStorage.getItem(OLD_WAYPOINTS_KEY) ?? 'null') as
      { muted?: unknown; completed?: Record<string, unknown> } | null;
    const veteran = !!old && (old.muted === true || Object.keys(old.completed ?? {}).length >= OLD_WAYPOINT_COUNT);
    const first: GuideState = { seen: {}, off: veteran };
    // Written quietly: a read may run inside a render, and this changes nothing anyone shows.
    localStorage.setItem(GUIDE_KEY, JSON.stringify(first));
    return first;
  } catch {
    return { seen: {}, off: false };
  }
}

/** Write, and tell listeners only when something changed (a stamp that changes nothing emits nothing). */
export function saveGuideState(next: GuideState): void {
  let before: string | null = null;
  const after = JSON.stringify(next);
  try {
    before = localStorage.getItem(GUIDE_KEY);
    localStorage.setItem(GUIDE_KEY, after);
  } catch {
    // Private mode or a full quota: the notes stay session-only.
  }
  if (before !== after) document.dispatchEvent(new CustomEvent('atlas:guide-changed'));
}

export function markNoteSeen(id: NoteId): void {
  const s = loadGuideState();
  if (s.seen[id]) return;
  saveGuideState({ ...s, seen: { ...s.seen, [id]: new Date().toISOString() } });
}

export function setNotesOff(off: boolean): void {
  saveGuideState({ ...loadGuideState(), off });
}

export function showNotesAgain(): void {
  saveGuideState({ ...loadGuideState(), seen: {} });
}
