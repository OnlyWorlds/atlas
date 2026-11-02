/**
 * The strand as a journey (Atlas 1.120.0): the pure rules behind Home's Strand tab, so the surfaces only
 * draw and press. The words for each slot, which slot is asked next (the reveal), each card's question
 * read from what is filled, the story card's two lines, whether Home opens with its tab head, the Event's
 * `characters` append, and an Edit's changed fields.
 *
 * Every reading is the strand as `strandView` gives it (`core/strand.ts`), never the stored mark: a mark
 * whose event the story does not list reads as no event here too.
 */
import type { Element } from './types';
import { STRAND_SLOTS, type OwStrand, type StrandSlot } from './strand';
import { guideElements } from './guide';
import { aidKind } from './charter';
import { isMessage } from './message-parties';
import { isKnownOf } from '../sync/known-of';
import { linkIdsOf } from './link-ids';
import { canonicalExtValue } from '../sync/world-meta-sync';

// ---- The words ----

/** Each slot's word: the box's head, the frame's rows, "Add <word>". */
export const SLOT_WORD: Record<StrandSlot, string> = {
  narrative: 'Story',
  event: 'Event',
  location: 'Where it happened',
  character: 'Character',
  now: 'Where they are now',
};

/** The slot as a sentence names it ("Mira will be the main character in place of Ana"). */
export const SLOT_PHRASE: Record<StrandSlot, string> = {
  narrative: 'the story',
  event: 'the event',
  location: 'where it happened',
  character: 'the main character',
  now: 'where they are now',
};

/** The word after "Use another": the slot's kind as the questions say it. */
export const SLOT_OTHER: Record<StrandSlot, string> = {
  narrative: 'story',
  event: 'event',
  location: 'location',
  character: 'character',
  now: 'location',
};

/** The Event to its place, and the main character to where they are now: the words between two boxes. */
export const JOIN_PLACE = 'happened in or at';
export const JOIN_NOW = 'is now in or at';

const named = (slot: { name: string } | null | undefined): string => slot?.name.trim() || 'Unnamed';

/** A card's question, the one line under it (none: null), and its text field's label. */
export interface CardCopy {
  title: string;
  what: string | null;
  text: string;
}

/** The card's words, read from what is filled (the strand as read, never the stored mark). */
export function cardCopy(slot: StrandSlot, s: OwStrand): CardCopy {
  switch (slot) {
    case 'narrative':
      return { title: 'Start with a story', what: 'The story your world tells, or the first of them.', text: 'The story' };
    case 'event':
      return {
        title: s.character ? `What happens to ${named(s.character)}?` : `What happens in ${named(s.narrative)}?`,
        what: 'One event in the story, of any size.',
        text: 'What happens',
      };
    case 'location':
      return { title: `Where did ${named(s.event)} happen?`, what: 'A location in your world.', text: 'About this location' };
    case 'character':
      return { title: 'Who is the story about?', what: 'Its main character.', text: 'About them' };
    case 'now':
      return {
        title: s.location ? `Is ${named(s.character)} still at ${named(s.location)}?` : `Where is ${named(s.character)} now?`,
        what: s.event ? `After ${named(s.event)}.` : null,
        text: 'About this location',
      };
  }
}

// ---- The reveal (R2) ----

/**
 * The slot asked for now: the slot `forced` when it is empty and writable (the frame's Pick on Home, an
 * Add press), else the first empty slot in the story's order this reader may write and has not skipped.
 * Null: nothing to ask.
 */
export function askedSlot(
  s: OwStrand,
  may: (slot: StrandSlot) => boolean,
  skipped: (slot: StrandSlot) => boolean,
  forced: StrandSlot | null = null,
): StrandSlot | null {
  if (forced && !s[forced] && may(forced)) return forced;
  for (const slot of ASK_ORDER) if (!s[slot] && may(slot) && !skipped(slot)) return slot;
  return null;
}

/** The order the journey asks in (1.121.0): the story, who it is about, what happens to them, where, and where they are now. */
export const ASK_ORDER: readonly StrandSlot[] = ['narrative', 'character', 'event', 'location', 'now'];

/** All five slots filled. */
export function strandWhole(s: OwStrand): boolean {
  return STRAND_SLOTS.every(slot => !!s[slot]);
}

// ---- The tab head (R1) ----

/**
 * Does the world hold a counted element outside the strand's five bodies? Counted: the guide's elements
 * (no room or proposed ones) less pins, markers and zones, reading aids, Messages, known-of stubs and the
 * kept-here copies. Only such an element earns Home its tab head while the strand is not whole.
 */
export function countedOutsideStrand(all: readonly Element[], kept: (id: string) => boolean, s: OwStrand): boolean {
  const bodies = new Set<string>();
  for (const slot of STRAND_SLOTS) { const f = s[slot]; if (f) bodies.add(f.id); }
  for (const el of guideElements(all)) {
    if (el.type === 'pin' || el.type === 'marker' || el.type === 'zone') continue;
    if (bodies.has(el.id) || kept(el.id) || isKnownOf(el) || isMessage(el) || aidKind(el) !== null) continue;
    return true;
  }
  return false;
}

// ---- The story card's lines (R5) ----

/** A run of words, or a chip naming a filled slot's element. */
export type LinePart = { text: string } | { chip: StrandSlot; id: string; name: string };

/** Does the strand's Event list its main character (`characters`, either spelling)? */
export function eventListsCharacter(s: OwStrand, byId: ReadonlyMap<string, Element>): boolean {
  if (!s.event || !s.character) return false;
  const ev = byId.get(s.event.id) as Record<string, unknown> | undefined;
  return linkIdsOf(ev?.characters).includes(s.character.id);
}

/**
 * Where they are now is where it happened, and the links say they were there: only then "still". The
 * SDK's `same` is the two ids alone; "still" also needs the Event to list the character.
 */
export function stillThere(s: OwStrand, byId: ReadonlyMap<string, Element>): boolean {
  return s.same === true && eventListsCharacter(s, byId);
}

/** The story card's two lines, only what is filled; never more than the links hold. */
export function storyLines(s: OwStrand, byId: ReadonlyMap<string, Element>): LinePart[][] {
  const lines: LinePart[][] = [];
  const chip = (slot: StrandSlot): LinePart => ({ chip: slot, id: s[slot]!.id, name: named(s[slot]) });
  if (s.event) {
    const line: LinePart[] = [{ text: 'It tells of ' }, chip('event')];
    if (s.location) line.push({ text: ', which happened in or at ' }, chip('location'));
    line.push({ text: '.' });
    lines.push(line);
  }
  if (s.character) {
    const line: LinePart[] = [{ text: 'Its main character is ' }, chip('character')];
    if (s.now) {
      if (stillThere(s, byId)) line.push({ text: ', still in or at ' }, chip('location'));
      else line.push({ text: ', now in or at ' }, chip('now'));
    }
    line.push({ text: '.' });
    lines.push(line);
  }
  return lines;
}

/** The Now cell's words when where they are now is where it happened (R7, by R5's rule). */
export function sameCellWords(s: OwStrand, byId: ReadonlyMap<string, Element>): string {
  return `${stillThere(s, byId) ? 'is still in or at' : 'is in or at'} ${named(s.location)}`;
}

// ---- The Event's characters (R4) ----

/** What appending `id` to a link list does: the next value, already listed, or a shape left alone. */
export type ListAppend = { next: unknown[] } | 'listed' | 'shape';

/**
 * The Event's `characters` with `id` appended: already listed in either spelling is nothing; absent, null
 * or an array gets the bare id at its end, every entry kept as it is (an `{id}` object stays); any other
 * shape (a lone id, a lone object) is left alone, never replaced.
 */
export function appendToList(list: unknown, id: string): ListAppend {
  if (linkIdsOf(list).includes(id)) return 'listed';
  if (list === undefined || list === null) return { next: [id] };
  if (Array.isArray(list)) return { next: [...list, id] };
  return 'shape';
}

// ---- The cards' fields ----

/** What a card's three fields hold, as typed. */
export interface CardValues {
  name: string;
  text: string;
  when: string;
}

export const EMPTY_VALUES: CardValues = { name: '', text: '', when: '' };

/** Where a type keeps its text: a Narrative's `story`, every other type's `description`. */
export function textFieldOf(type: string): 'story' | 'description' {
  return type === 'narrative' ? 'story' : 'description';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The text a box shows: a Narrative's `story`, else its `description` (another tool's Narrative may have only that). */
export function boxTextOf(el: Element | undefined): string {
  if (!el) return '';
  const rec = el as unknown as Record<string, unknown>;
  if (el.type === 'narrative') return str(rec.story).trim() || str(rec.description).trim();
  return str(rec.description).trim();
}

/** A story the card leaves to the writing room: it carries the room's rich text, or runs past six lines. */
export function storyForWritingRoom(el: Element | undefined): boolean {
  if (!el || el.type !== 'narrative') return false;
  const rec = el as unknown as Record<string, unknown>;
  const side = rec.atlas_richtext_json;
  if (side !== undefined && side !== null && side !== '') return true;
  return str(rec.story).split('\n').length > 6;
}

/** When, as typed: empty is none, a whole number is the number, anything else is not a When. */
export function parseWhen(typed: string): number | null | 'bad' {
  const t = typed.trim();
  if (t === '') return null;
  if (!/^-?\d+$/.test(t)) return 'bad';
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : 'bad';
}

/** A Make's create: the name, the text where the type keeps it and When, each only when given. */
export function createFields(type: string, v: CardValues): Record<string, unknown> | 'bad-when' {
  const out: Record<string, unknown> = { name: v.name.trim() };
  if (v.text.trim() !== '') out[textFieldOf(type)] = v.text;
  if (type === 'event') {
    const when = parseWhen(v.when);
    if (when === 'bad') return 'bad-when';
    if (when !== null) out.start_date = when;
  }
  return out;
}

/** An Edit card's values as the element holds them when it opens, and the raw stored values compared at Save. */
export function editOpening(el: Element): { values: CardValues; raw: Record<string, unknown> } {
  const rec = el as unknown as Record<string, unknown>;
  const field = textFieldOf(el.type);
  const when = rec.start_date;
  const raw: Record<string, unknown> = { name: rec.name, [field]: rec[field] };
  if (el.type === 'event') raw.start_date = when;
  return {
    values: { name: str(rec.name), text: str(rec[field]), when: typeof when === 'number' && Number.isFinite(when) ? String(when) : '' },
    raw,
  };
}

/**
 * Save's patch: only the fields the person changed from the values the card opened with. An empty name
 * is no change; a cleared text or When writes null. `textShown` false: the card drew no text field.
 */
export function changedFields(type: string, opened: CardValues, now: CardValues, textShown = true): Record<string, unknown> | 'bad-when' {
  const out: Record<string, unknown> = {};
  if (now.name.trim() !== '' && now.name !== opened.name && now.name.trim() !== opened.name.trim()) out.name = now.name.trim();
  if (textShown && now.text !== opened.text) out[textFieldOf(type)] = now.text.trim() === '' ? null : now.text;
  if (type === 'event' && now.when.trim() !== opened.when.trim()) {
    const when = parseWhen(now.when);
    if (when === 'bad') return 'bad-when';
    out.start_date = when;
  }
  return out;
}

/** A stored value still the one the card opened with (absent, null and '' are one: nothing). */
export function sameStored(current: unknown, opened: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === '' ? null : v);
  return canonicalExtValue(norm(current)) === canonicalExtValue(norm(opened));
}
