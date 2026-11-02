/**
 * The strand's writes (schema-dist `profiles/strand.md`, Atlas's contract S4): every box's write, run
 * against the folder. The plans are the pure core's (`core/strand.ts`); this runs them in the order the
 * contract fixes and says what came of it.
 *
 *   - The guard first: the mark as it is on disk must still name the story (and for Where it happened,
 *     the happening) the box was drawn for, or nothing is written ("The strand changed meanwhile"). Make
 *     one asks it before it makes anything.
 *   - Then the link, inside the element's lock (`updateElementWith`, never the grid's `placeIn`, so no
 *     "just now" line and no Undo ever holds a strand link): a list appends unless the SDK already reads
 *     the id as listed; a single link is written only while the field still holds what the box was
 *     drawn with (compare-and-set).
 *   - Then the mark, computed inside the store's meta op from world.json as read there
 *     (`writeWorldMetaWith`), the guard asked again in the same op.
 *   - Then the mirror (`patchActiveMeta`, conv. 169), the list, and a push for a linked world.
 *
 * A failure after the link leaves an ordinary link and the box empty, with the problem said
 * (`showProblem`, never the error's text: conv. 125).
 *
 * The journey (1.120.0) adds three writes: a Make carries the card's text and When in its one create;
 * the Character card adds the main character to the strand's Event (`addCharacterToEvent`, its own
 * guards); an Edit writes only the fields changed, compared with what the card opened with
 * (`editStrandElement`). Every patch of Home's state asks first that the world drawn is still the open
 * one and its store the active store, so a world switched mid-write takes none of the old world's list.
 */

import type { Element, ElementType, WorldMeta } from '../core/types';
import { getState, patchActiveMeta, patchSlice } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { worldIsViewOnly } from '../core/view-only';
import {
  appendId, elementIndex, guardFor, heroStillDrawn, markForEvent, markForPlace, markForStory, markStillDrawn,
  markValue, memberIds, rawSingle, singleStillDrawn, storedMark, strandView, SLOT_TYPE, type MarkMembers, type StrandSlot,
} from '../core/strand';
import { appendToList, createFields, sameStored, EMPTY_VALUES, type CardValues } from '../core/strand-journey';
import { STRAND_KEY } from '../core/strand-mark';
import { isKeptHere, requestPushIfLinked } from '../sync/sync-attach';
import { getWritingLabels } from '../middle/writing-helpers';
import { showProblem } from './problem-fixes';
import { toastManager } from './toast-manager';

/** The line a refused write says. */
export const STRAND_MOVED = 'The strand changed meanwhile.';

/** What a box was drawn with: the guard and the compare-and-set read these. */
export interface StrandDrawn {
  worldId: string;
  /** The stored mark's `narrative`, as a plain id, when the box was drawn (null: none). */
  narrative: string | null;
  /** The stored mark's `event`, the same way (Happening's and Where it happened's guard). */
  event: string | null;
  /** The stored mark's `location`, the same way (Where it happened's guard: the place it replaces). */
  location: string | null;
  /** Hero and Where the hero is now: the element whose field is written (the story, the hero). */
  on?: string | null;
  /** Hero and Where the hero is now: the field's raw value when drawn (null: empty). */
  raw?: unknown;
}

export type StrandWriteResult = 'wrote' | 'refused' | 'failed' | 'nothing';

/** What was written, for the caller's words. */
export interface StrandOutcome {
  result: StrandWriteResult;
  /** A Make one: the element made (kept when a later step refused or failed). */
  made?: Element;
}

const SINGLE_FIELD: Partial<Record<StrandSlot, 'protagonist' | 'location'>> = { character: 'protagonist', now: 'location' };

/** The element the slot's link is written on, or null for the story (no link). */
function linkedOn(slot: StrandSlot, drawn: StrandDrawn): string | null {
  if (slot === 'event') return drawn.narrative;
  if (slot === 'location') return drawn.event;
  if (slot === 'character' || slot === 'now') return drawn.on ?? null;
  return null;
}

/** May a write start in this world at all? */
function storeFor(worldId: string) {
  const store = getActiveStore();
  if (!store || getState().active?.worldId !== worldId || worldIsViewOnly(worldId)) return null;
  return store;
}

type Store = NonNullable<ReturnType<typeof getActiveStore>>;

/** The world drawn is still the open one, on this store: else no patch of Home's state (S3). */
function stillHere(store: Store, worldId: string): boolean {
  return getState().active?.worldId === worldId && getActiveStore() === store;
}

/** The list read back into state, and a push asked, only while the world is still the one written (S3). */
async function refreshIn(store: Store, worldId: string): Promise<void> {
  const elements = await store.listElements();
  if (!stillHere(store, worldId)) return;
  patchSlice('data', { elements });
  requestPushIfLinked();
}

/**
 * The guard as the folder holds it now, before anything is made or written: the mark's members the slot
 * replaces or hangs on (C2); for Hero and Now the field's compare-and-set (C6), and for Now that the hero
 * drawn is still the story's (C3).
 */
async function stillDrawn(store: Store, slot: StrandSlot, drawn: StrandDrawn): Promise<boolean> {
  const meta = await store.readWorldMeta({ strict: true });
  if (!markStillDrawn(storedMark(meta), guardFor(slot, drawn))) return false;
  const single = SINGLE_FIELD[slot];
  if (!single) return true;
  if (slot === 'now' && !(await heroStillOn(store, drawn))) return false;
  const on = drawn.on ? await store.getElement(drawn.on) : null;
  return !!on && singleStillDrawn(rawSingle(on, single), drawn.raw ?? null);
}

/** Now's own guard: the story still names the hero the box was drawn for. */
async function heroStillOn(store: Store, drawn: StrandDrawn): Promise<boolean> {
  const story = drawn.narrative ? await store.getElement(drawn.narrative) : null;
  return heroStillDrawn(story ?? undefined, drawn.on);
}

/**
 * The slot's write with `id`: the link, then the mark. The guard is asked before anything is written
 * and again inside the meta op.
 */
export async function writeStrandSlot(slot: StrandSlot, drawn: StrandDrawn, id: string): Promise<StrandWriteResult> {
  const store = storeFor(drawn.worldId);
  if (!store) return 'nothing';
  try {
    if (!(await stillDrawn(store, slot, drawn))) return 'refused';
  } catch (err) {
    showProblem(err, { doing: 'reading the strand', toasts: toastManager });
    return 'failed';
  }
  return linkThenMark(store, slot, drawn, id);
}

/**
 * Make: the guard first, then the element in one create, with the typed name, the card's text where the
 * type keeps it (a Narrative's `story`, every other type's `description`) and an Event's When in its
 * `start_date`, each only when given; a story takes the world's first writing label, as the grid's +
 * makes one. Then the slot's write.
 */
export async function makeStrandSlot(slot: StrandSlot, drawn: StrandDrawn, name: string, values: CardValues = EMPTY_VALUES): Promise<StrandOutcome> {
  const store = storeFor(drawn.worldId);
  if (!store) return { result: 'nothing' };
  const type = SLOT_TYPE[slot] as ElementType;
  const fields = createFields(type, { ...values, name });
  // The card refuses a When that is not a whole number before it asks; this is the write's own refusal.
  if (fields === 'bad-when') return { result: 'nothing' };
  let made: Element;
  try {
    // Every guard before anything is made (G3, C6): a refused Make one leaves nothing behind.
    if (!(await stillDrawn(store, slot, drawn))) return { result: 'refused' };
    const label = type === 'narrative' ? getWritingLabels(drawn.worldId).l1 : '';
    made = await store.createElement(type, { ...fields, ...(label ? { supertype: label } : {}) } as Partial<Element>);
    if (stillHere(store, drawn.worldId)) {
      const elements = await store.listElements();
      if (stillHere(store, drawn.worldId)) {
        patchSlice('data', { elements });
        requestPushIfLinked();
      }
    }
  } catch (err) {
    showProblem(err, { doing: 'making the element', toasts: toastManager });
    return { result: 'failed' };
  }
  const result = await linkThenMark(store, slot, drawn, made.id);
  return { result, made };
}

/** Clear the strand: the key removed (written as absent), only while the mark still names the story drawn. */
export async function clearStrand(drawn: StrandDrawn): Promise<StrandWriteResult> {
  const store = storeFor(drawn.worldId);
  if (!store) return 'nothing';
  let moved = false;
  try {
    const out = await store.writeWorldMetaWith(cur => {
      if (!markStillDrawn(storedMark(cur), { narrative: drawn.narrative })) { moved = true; return null; }
      return { [STRAND_KEY]: undefined } as unknown as Partial<WorldMeta>;
    });
    if (moved) return 'refused';
    if (out === null) return 'nothing';
  } catch (err) {
    showProblem(err, { doing: 'taking the strand off this story', toasts: toastManager });
    return 'failed';
  }
  patchActiveMeta(drawn.worldId, { [STRAND_KEY]: undefined } as unknown as Partial<WorldMeta>);
  requestPushIfLinked();
  return 'wrote';
}

/**
 * The list read back after a write landed (D3): a failure there is said, never a rejection that leaves
 * the box held unsaid; what was written stays written.
 */
async function refreshSaid(store: Store, worldId: string): Promise<void> {
  try {
    await refreshIn(store, worldId);
  } catch (err) {
    showProblem(err, { doing: 'reading the world back after saving the strand', toasts: toastManager });
  }
}

/** The link in the folder first, then the mark (S4); the list and the mirror after. */
async function linkThenMark(store: Store, slot: StrandSlot, drawn: StrandDrawn, id: string): Promise<StrandWriteResult> {
  const on = linkedOn(slot, drawn);
  let linkMoved = false;
  let linked = false;
  try {
    // Now: asked again right before the hero's lock (C3).
    if (slot === 'now' && !(await heroStillOn(store, drawn))) return 'refused';
    if (on) {
      const single = SINGLE_FIELD[slot];
      await store.updateElementWith(on, ex => {
        const rec = ex as unknown as Record<string, unknown>;
        if (single) {
          // Compare-and-set: the field still holds what the box (or its promise) was drawn with.
          if (!singleStillDrawn(rawSingle(ex, single), drawn.raw ?? null)) { linkMoved = true; return null; }
          if (rec[single] === id) return null;
          linked = true;
          return { [single]: id } as Partial<Element>;
        }
        const field = slot === 'event' ? 'events' : 'locations';
        const next = appendId(rec[field], id);
        if (!next) return null;
        linked = true;
        return { [field]: next } as Partial<Element>;
      });
    }
  } catch (err) {
    showProblem(err, { doing: 'saving the strand', toasts: toastManager });
    return 'failed';
  }
  if (linkMoved) return 'refused';
  // Hero and Where the hero is now are the link alone.
  if (slot === 'character' || slot === 'now') {
    if (linked) await refreshSaid(store, drawn.worldId); else requestPushIfLinked();
    return 'wrote';
  }
  let moved = false;
  let wrote: Record<string, string | null> | null = null;
  try {
    const elements = linked ? await store.listElements() : getState().data.elements;
    const kept = (eid: string) => isKeptHere(drawn.worldId, eid);
    const byId = elementIndex(elements);
    await store.writeWorldMetaWith(cur => {
      const mark = storedMark(cur);
      if (!markStillDrawn(mark, guardFor(slot, drawn))) { moved = true; return null; }
      // The SDK's reading of the mark as it is here decides where a change starts from (G20).
      const now = strandView(cur, elements, kept);
      const m: MarkMembers | null = slot === 'narrative' ? markForStory(mark, now, id, byId)
        : slot === 'event' ? markForEvent(mark, now, id, byId)
          : markForPlace(mark, now, id);
      if (!m) { moved = true; return null; }
      wrote = markValue(m);
      return { [STRAND_KEY]: wrote } as unknown as Partial<WorldMeta>;
    });
  } catch (err) {
    if (linked) await refreshIn(store, drawn.worldId).catch(() => undefined);
    showProblem(err, { doing: 'saving the strand', toasts: toastManager });
    return 'failed';
  }
  if (moved || !wrote) {
    if (linked) await refreshSaid(store, drawn.worldId);
    return 'refused';
  }
  patchActiveMeta(drawn.worldId, { [STRAND_KEY]: wrote } as unknown as Partial<WorldMeta>);
  await refreshSaid(store, drawn.worldId);
  requestPushIfLinked();
  return 'wrote';
}

/**
 * What came of adding the main character to the strand's Event: listed now, left as it was, refused
 * because the strand changed meanwhile (`moved`), or a write that did not go through (`failed`).
 */
export type EventAdd = 'added' | 'skipped' | 'moved' | 'failed';

/**
 * The Character card's second write (R4), and the Event card's (1.121.0): after the story's `protagonist`
 * names `characterId` and the mark's event is `eventId`, that Event lists them in its `characters`. Asked
 * again first: the mark's event is still `eventId` and the story still names this character; else
 * `moved`, nothing written. Then inside the Event's lock: already listed in either
 * spelling is nothing; absent, null or an array gets the bare id appended (every entry kept); any other
 * shape is left alone. The `added` flag is set inside the mutate, so a deleted Event (the mutate never
 * runs) reads as not gone through. The caller asks whether this person may change the Event first.
 */
export async function addCharacterToEvent(drawn: StrandDrawn, eventId: string, characterId: string): Promise<EventAdd> {
  const store = storeFor(drawn.worldId);
  if (!store) return 'failed';
  let ran = false;
  let added = false;
  try {
    const meta = await store.readWorldMeta({ strict: true });
    const ids = memberIds(storedMark(meta));
    if (ids.narrative !== drawn.narrative || ids.event !== eventId) return 'moved';
    const story = drawn.narrative ? await store.getElement(drawn.narrative) : null;
    if (!heroStillDrawn(story ?? undefined, characterId)) return 'moved';
    await store.updateElementWith(eventId, ex => {
      ran = true;
      const plan = appendToList((ex as unknown as Record<string, unknown>).characters, characterId);
      if (plan === 'listed' || plan === 'shape') return null;
      added = true;
      return { characters: plan.next } as Partial<Element>;
    });
  } catch {
    // Said by the caller in the strand's own line ("adding them to … did not go through"), never the error's text.
    return 'failed';
  }
  if (!ran) return 'failed';
  if (added) await refreshSaid(store, drawn.worldId);
  return added ? 'added' : 'skipped';
}

/** What an Edit's Save came to: written, refused for a change meanwhile, nothing to write, or failed. */
export type EditResult = 'wrote' | 'moved' | 'nothing' | 'failed';

/**
 * An Edit card's Save (R7): only the fields the person changed, in one write inside the element's lock,
 * each compared with the value the card opened with; a mismatch on any writes nothing ("changed
 * meanwhile"). `patch` is `changedFields`' answer, `opened` the raw stored values the card opened on.
 */
export async function editStrandElement(worldId: string, id: string, patch: Record<string, unknown>, opened: Record<string, unknown>): Promise<EditResult> {
  const store = storeFor(worldId);
  if (!store) return 'nothing';
  const fields = Object.keys(patch);
  if (fields.length === 0) return 'nothing';
  let moved = false;
  let ran = false;
  try {
    await store.updateElementWith(id, ex => {
      ran = true;
      const rec = ex as unknown as Record<string, unknown>;
      if (fields.some(f => !sameStored(rec[f], opened[f]))) { moved = true; return null; }
      return patch as Partial<Element>;
    });
  } catch (err) {
    showProblem(err, { doing: 'saving the element', toasts: toastManager });
    return 'failed';
  }
  if (!ran || moved) return 'moved';
  await refreshSaid(store, worldId);
  return 'wrote';
}
