/**
 * The world's strand (schema-dist `profiles/strand.md`): one story, one of its happenings and where it
 * happened, the story's hero and where the hero is now. Pure: the reading, who may write which box, and
 * each box's write as a plan (the element patch and the mark mutation), so the surfaces (Home's Strand
 * tab, Make this the strand, the writing room's frame) only draw and press.
 *
 * Whether a slot is filled is the SDK's `strandOf` alone, at the owner rung over what this copy holds
 * (as `charterOf` and the Web read it, web-lens.ts), never a decoding of the mark here. The mark itself
 * (`x_strand` on world.json) moves through `strand-mark.ts`.
 */
import { strandOf, type OwStrand } from '@onlyworlds/sdk';
import type { Element, WorldMeta, WorldRegistryEntry } from './types';
import { entryIsViewOnly } from './view-only';
import { mayChange } from './may-change';
import { sliceOf } from './provenance';
import { isKnownOf } from '../sync/known-of';
import { handsOnAsProposed } from './review-mark';
import { isRoomElement } from './parlor-room';
import { isMessage } from './message-parties';
import { canonicalExtValue } from '../sync/world-meta-sync';
import { STRAND_KEY } from './strand-mark';

export type { OwStrand };

/** A box, in the story's order. */
export type StrandSlot = 'narrative' | 'event' | 'location' | 'character' | 'now';

export const STRAND_SLOTS: readonly StrandSlot[] = ['narrative', 'event', 'location', 'character', 'now'];

/** The element type each box holds. */
export const SLOT_TYPE: Record<StrandSlot, 'narrative' | 'event' | 'location' | 'character'> = {
  narrative: 'narrative',
  event: 'event',
  location: 'location',
  character: 'character',
  now: 'location',
};

export const EMPTY_STRAND: OwStrand = { narrative: null, event: null, location: null, character: null, now: null, same: null };

/** The stored mark as world.json holds it (any shape: only the SDK decides whether it is a mark). */
export function storedMark(meta: WorldMeta | null | undefined): unknown {
  return meta ? (meta as unknown as Record<string, unknown>)[STRAND_KEY] : undefined;
}

/**
 * The open world's mark as canonical JSON (null: none), for a render gate's inputs (S8, G4): a press,
 * a pull or Not the strand moves it while no element changed.
 */
export function strandMarkKey(meta: WorldMeta | null | undefined): string | null {
  return canonicalExtValue(storedMark(meta));
}

/** The mark's members as plain ids, for picking bodies and planning writes; never a reading. */
export function memberIds(mark: unknown): { narrative?: string; event?: string; location?: string } {
  if (!mark || typeof mark !== 'object' || Array.isArray(mark)) return {};
  const m = mark as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' && v !== '' ? v : undefined);
  return { narrative: s(m.narrative), event: s(m.event), location: s(m.location) };
}

/**
 * The bodies the answer depends on at the owner rung: the story, the mark's other two ids, the story's
 * `protagonist` and that one's `location` (G19: constant cost, the same answer as the whole world).
 */
export function strandBodies(mark: unknown, byId: ReadonlyMap<string, Element>, kept: (id: string) => boolean = () => false): Element[] {
  const ids = memberIds(mark);
  const out = new Map<string, Element>();
  const take = (id: unknown): Element | undefined => {
    if (typeof id !== 'string' || kept(id)) return undefined;
    const el = byId.get(id);
    if (el) out.set(id, el);
    return el;
  };
  const story = take(ids.narrative);
  take(ids.event);
  take(ids.location);
  const hero = story ? take((story as Record<string, unknown>).protagonist) : undefined;
  if (hero) take((hero as Record<string, unknown>).location);
  return [...out.values()];
}

/**
 * One id index per elements array (a store patch makes a new array): built once, never per call (C7).
 * It rests on a rule the store keeps: an elements array, and every element in it, is never changed in
 * place (no push, splice or assignment into `s.data.elements`; `listElements` hands out fresh copies).
 * A change is a new array, so a new index; an array changed in place would keep a stale one, and the
 * memo below, keyed on body identity, a stale answer.
 */
const indexes = new WeakMap<readonly Element[], Map<string, Element>>();

/** The elements by id, for this array. */
export function elementIndex(elements: readonly Element[]): ReadonlyMap<string, Element> {
  let m = indexes.get(elements);
  if (!m) {
    m = new Map();
    for (const el of elements) m.set(el.id, el);
    indexes.set(elements, m);
  }
  return m;
}

/** The last answer, by the mark's canonical JSON and the five bodies it read (kept ones already left out). */
let memo: { key: string; bodies: readonly Element[]; out: OwStrand } | null = null;

/**
 * The world's strand as this copy holds it. `elements` is the store's array (`s.data.elements`, never the
 * lore: the room switch does not change the strand); `kept` answers whether an element is a kept-here copy
 * outside the key's view (conv. 151), left out so a member never draws a slot keel would serve as a stub.
 * Constant cost per call (S2, C7): the index is the array's own, and `kept` is asked only of the bodies.
 */
export function strandView(meta: WorldMeta | null | undefined, elements: readonly Element[], kept: (id: string) => boolean = () => false): OwStrand {
  const mark = storedMark(meta);
  if (mark === undefined || mark === null) return EMPTY_STRAND;
  const bodies = strandBodies(mark, elementIndex(elements), kept);
  const key = canonicalExtValue(mark) ?? '';
  if (memo && memo.key === key && memo.bodies.length === bodies.length && memo.bodies.every((b, i) => b === bodies[i])) return memo.out;
  let out: OwStrand;
  try {
    out = strandOf({ elements: bodies, x_strand: mark } as never, { rung: 'owner' });
  } catch {
    out = EMPTY_STRAND;
  }
  memo = { key, bodies, out };
  return out;
}

// ---- Who writes (S3) ----

/**
 * A keeper: the owner or a co-builder (by role, or by seat before the first `/me`), or the folder's own
 * owner; never in a view-only world. Only a keeper writes the mark.
 */
export function isStrandKeeper(entry: WorldRegistryEntry | undefined, meta: unknown): boolean {
  if (entryIsViewOnly(entry)) return false;
  if (entry?.state === 'api-linked') {
    const role = entry.api?.member_role ?? entry.api?.seat?.role;
    return role === 'owner' || role === 'co_builder';
  }
  const slice = sliceOf(meta);
  return !slice || slice.kind === 'owner' || (slice.kind === 'member' && slice.role === 'co_builder');
}

/**
 * May this reader write `slot`? Story, Happening, Where it happened: a keeper (and the element whose list
 * is written must be changeable). Hero: the story. Where the hero is now: the hero. `strand` is the
 * current reading, `byId` the copy's elements.
 */
export function maySetSlot(
  slot: StrandSlot,
  entry: WorldRegistryEntry | undefined,
  meta: unknown,
  strand: OwStrand,
  byId: ReadonlyMap<string, Element>,
): boolean {
  if (entryIsViewOnly(entry)) return false;
  const may = (id: string | undefined) => {
    const el = id ? byId.get(id) : undefined;
    return !!el && mayChange(entry, el);
  };
  switch (slot) {
    case 'narrative':
      return isStrandKeeper(entry, meta);
    case 'event':
      return !!strand.narrative && isStrandKeeper(entry, meta) && may(strand.narrative.id);
    case 'location':
      return !!strand.event && isStrandKeeper(entry, meta) && may(strand.event.id);
    case 'character':
      return !!strand.narrative && may(strand.narrative.id);
    case 'now':
      return !!strand.character && may(strand.character.id);
  }
}

/** Is any box writable here? With an empty strand and none, there is no tab (G16). */
export function anySlotWritable(entry: WorldRegistryEntry | undefined, meta: unknown, strand: OwStrand, byId: ReadonlyMap<string, Element>): boolean {
  return STRAND_SLOTS.some(s => maySetSlot(s, entry, meta, strand, byId));
}

/**
 * An element a box may offer or a press may make the strand's: of the box's kind, and never a known-of
 * stub, a proposed element (no reader's view holds it), a room element (the public reads none; G6,
 * G12) or a Message, room mark or not (mail, never a world's story: the Wire's letters are Messages).
 * No reading aid is one of the four kinds (the SDK's `CHARTER_PAIRS`). A chapter may be the story.
 */
export function offerable(el: Element, type: string): boolean {
  return el.type === type && !isKnownOf(el) && !handsOnAsProposed(el) && !isRoomElement(el) && !isMessage(el);
}

// ---- The writes (S4) ----

/** The SDK's "listed": a list holding the id as a string entry. */
export function listed(list: unknown, id: string): boolean {
  return Array.isArray(list) && list.includes(id);
}

/** A list with `id` appended as a bare string, unless the SDK already reads it as listed (G7). */
export function appendId(list: unknown, id: string): unknown[] | null {
  if (listed(list, id)) return null;
  return [...(Array.isArray(list) ? list : []), id];
}

export interface MarkMembers {
  narrative: string;
  event: string | null;
  location: string | null;
}

/** Why a planned write is refused at the moment it runs. */
export type StrandRefusal = 'moved' | 'gone';

/** The mark as the SDK would start a write from: a mark it reads as none starts fresh (G20). */
function startFrom(mark: unknown, strandNow: OwStrand): Partial<MarkMembers> {
  if (!strandNow.narrative) return {};
  const ids = memberIds(mark);
  return { narrative: ids.narrative, event: ids.event ?? null, location: ids.location ?? null };
}

/**
 * The mark after a story change: the happening kept only when the new story lists it, the place only when
 * the kept happening lists it (G9).
 */
export function markForStory(mark: unknown, strandNow: OwStrand, storyId: string, byId: ReadonlyMap<string, Element>): MarkMembers {
  const was = startFrom(mark, strandNow);
  const story = byId.get(storyId) as Record<string, unknown> | undefined;
  const event = was.event && listed(story?.events, was.event) ? was.event : null;
  const ev = event ? (byId.get(event) as Record<string, unknown> | undefined) : undefined;
  const location = event && was.location && listed(ev?.locations, was.location) ? was.location : null;
  return { narrative: storyId, event, location };
}

/** The mark after a happening change: the place kept only when the new happening lists it (G9). */
export function markForEvent(mark: unknown, strandNow: OwStrand, eventId: string, byId: ReadonlyMap<string, Element>): MarkMembers | null {
  const was = startFrom(mark, strandNow);
  if (!was.narrative) return null;
  const ev = byId.get(eventId) as Record<string, unknown> | undefined;
  const location = was.location && listed(ev?.locations, was.location) ? was.location : null;
  return { narrative: was.narrative, event: eventId, location };
}

/** The mark after a place change. */
export function markForPlace(mark: unknown, strandNow: OwStrand, locationId: string): MarkMembers | null {
  const was = startFrom(mark, strandNow);
  if (!was.narrative || !was.event) return null;
  return { narrative: was.narrative, event: was.event, location: locationId };
}

/**
 * The guard a mark write runs inside the store's meta op (G3): refused when the mark's story (and, when
 * given, its happening or its place) is no longer the one the box was drawn for. A member left out of
 * `drawn` is not compared.
 */
export function markStillDrawn(
  markOnDisk: unknown,
  drawn: { narrative: string | null; event?: string | null; location?: string | null },
): boolean {
  const ids = memberIds(markOnDisk);
  if ((ids.narrative ?? null) !== drawn.narrative) return false;
  if (drawn.event !== undefined && (ids.event ?? null) !== drawn.event) return false;
  if (drawn.location !== undefined && (ids.location ?? null) !== drawn.location) return false;
  return true;
}

/** What a box was drawn with, as the mark's ids stored then. */
export interface DrawnMark { narrative: string | null; event: string | null; location: string | null }

/**
 * Which of the mark's members a slot's write must find as drawn (C2): the story always; the happening
 * for a happening write (the one it replaces) and a place write (the one it hangs on); the place for a
 * place write (the one it replaces). Hero and Now ask the story only: their own value is the field's.
 */
export function guardFor(slot: StrandSlot, drawn: DrawnMark): { narrative: string | null; event?: string | null; location?: string | null } {
  if (slot === 'event') return { narrative: drawn.narrative, event: drawn.event };
  if (slot === 'location') return { narrative: drawn.narrative, event: drawn.event, location: drawn.location };
  return { narrative: drawn.narrative };
}

/**
 * Where the hero is now writes on the hero drawn: refused once the story's `protagonist` names someone
 * else (C3), so a place is never written on a character who is no longer the hero.
 */
export function heroStillDrawn(story: Element | undefined, heroDrawn: string | null | undefined): boolean {
  return !!heroDrawn && singleStillDrawn(rawSingle(story, 'protagonist'), heroDrawn);
}

/**
 * The raw value of a single link (Hero's `protagonist`, Now's `location`), whatever it holds: the box's
 * Change path is taken whenever it holds anything, so nothing is written over unseen (G8).
 */
export function rawSingle(el: Element | undefined, field: 'protagonist' | 'location'): unknown {
  const v = el ? (el as Record<string, unknown>)[field] : undefined;
  return v === undefined || v === '' ? null : v;
}

/** Compare-and-set for a single link: the field still holds what the box was drawn with (G3). */
export function singleStillDrawn(current: unknown, drawn: unknown): boolean {
  const norm = (v: unknown) => (v === undefined || v === '' ? null : v);
  return canonicalExtValue(norm(current)) === canonicalExtValue(norm(drawn));
}

/** The mark as world.json should hold it: members in the profile's order. */
export function markValue(m: MarkMembers): Record<string, string | null> {
  return { narrative: m.narrative, event: m.event, location: m.location };
}
