/**
 * Knowledge model helpers (see DESIGN_KNOWLEDGE.md).
 *
 * A **knowledge entry** is a Narrative with `subtype === 'knowledge'`. Its prose
 * (`story`) is the knowledge; its `Involves` links (auto-populated by @-mentions)
 * are the *about* subjects; and for knowledge-subtype narratives the fields
 * `narrator` (a solo Character) and `collectives` (Circles) are reinterpreted
 * as **held-by** — the knowers. Two channels only.
 *
 * This module: classification + held-by reading + the known-view scans
 * (`knowledgeHeldBy` / `elementsKnownAboutBy`) — knowing is computed, never stored.
 */

import type { Element } from './types';
import { NARRATIVE_RELATION_FIELDS } from './narrative-fields';

/** Narrative subtype that marks a knowledge entry. Free-text subtype — no schema change. */
export const KNOWLEDGE_SUBTYPE = 'knowledge';

/** True iff the element is a knowledge entry (a narrative tagged with the knowledge subtype). */
export function isKnowledgeNarrative(el: Element | null | undefined): boolean {
  if (!el || el.type !== 'narrative') return false;
  const subtype = (el as Record<string, unknown>).subtype;
  return typeof subtype === 'string' && subtype.toLowerCase() === KNOWLEDGE_SUBTYPE;
}

/** All knowledge entries among the given elements. */
export function listKnowledgeEntries(elements: Element[]): Element[] {
  return elements.filter(isKnowledgeNarrative);
}

/**
 * The knowers a knowledge entry is held by. Two channels only:
 *   - `narrator`    → a single Character holder
 *   - `collectives` → Circle (Collective) holders; members inherit
 * An institution that "knows" is modelled as a Circle of its members — there is
 * deliberately no separate institution/conservator held-by channel (it would
 * just duplicate a Circle). See DESIGN_KNOWLEDGE.md.
 */
export interface HeldBy {
  /** Single Character holder. */
  narrator: string | null;
  /** Circle (Collective) holders — members inherit. */
  collectives: string[];
}

export function heldByOf(el: Element): HeldBy {
  const rec = el as Record<string, unknown>;
  const narrator = typeof rec.narrator === 'string' ? rec.narrator : null;
  const collectives = Array.isArray(rec.collectives)
    ? (rec.collectives as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
  return { narrator, collectives };
}

/** Count of distinct holder *links* on a knowledge entry (not resolved members). */
export function heldByCount(el: Element): number {
  const h = heldByOf(el);
  return (h.narrator ? 1 : 0) + h.collectives.length;
}

/**
 * Narrative `Involves` multi-link fields that count as *about* (subjects) for a
 * knowledge entry. Derived from `NARRATIVE_RELATION_FIELDS` so the two lists
 * can't drift. Deliberately EXCLUDES `collectives` — for knowledge-subtype
 * narratives that field is reinterpreted as held-by Circles (DESIGN_KNOWLEDGE.md
 * conventions #68, #72; accepted limitation: a Collective can't be both subject
 * and holder on one entry).
 */
export const ABOUT_FIELDS: readonly string[] = Object.entries(NARRATIVE_RELATION_FIELDS)
  .filter(([type, field]) => field !== null && type !== 'collective')
  .map(([, field]) => field as string);

/**
 * The narrative `Involves` field a subject of this element type lands in.
 * `null` = can't be an about-subject: collectives are HELD-BY (Circles), and
 * map/pin/marker/narrative have no Involves field.
 */
export function aboutFieldFor(type: string): string | null {
  if (type === 'collective') return null;
  return NARRATIVE_RELATION_FIELDS[type as keyof typeof NARRATIVE_RELATION_FIELDS] ?? null;
}

/** Ids of the elements a knowledge entry is *about* (subjects), gathered from the about multi-links. */
export function aboutIdsOf(el: Element): string[] {
  const rec = el as Record<string, unknown>;
  const ids: string[] = [];
  for (const f of ABOUT_FIELDS) {
    const v = rec[f];
    if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') ids.push(x);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Known-view scans (DESIGN_KNOWLEDGE.md — "knowing is computed, never stored").
// Pure functions over the in-memory element set. Two paths to knowing:
//   - direct   : you are the entry's narrator (a Character), or the entry
//                lists you (a Collective) as a holder
//   - inherited: you're a member of a holding Circle (Collective.characters)
// ---------------------------------------------------------------------------

/** Element types capable of *holding* knowledge: a lone character, or a Circle (Collective). */
export function isKnowerType(type: string): boolean {
  return type === 'character' || type === 'collective';
}

/** Member character ids of a Circle (Collective). [] if not a collective / no members. */
export function circleMembers(collectiveId: string, elements: Element[]): string[] {
  const c = elements.find(e => e.id === collectiveId && e.type === 'collective');
  if (!c) return [];
  const v = (c as Record<string, unknown>).characters;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/** Does a Character know this knowledge entry? (direct narrator OR member of a holding circle.) */
export function characterKnowsEntry(charId: string, entry: Element, elements: Element[]): boolean {
  const held = heldByOf(entry);
  if (held.narrator === charId) return true;
  for (const cid of held.collectives) {
    if (circleMembers(cid, elements).includes(charId)) return true;
  }
  return false;
}

/**
 * Knowledge entries held by a knower. Dispatches on the knower's element type:
 *   - character   → narrator===id OR member of a holding circle
 *   - collective  → that circle is a direct holder
 * Returns [] for any non-agent type (only characters and Circles hold knowledge).
 */
export function knowledgeHeldBy(knowerId: string, elements: Element[]): Element[] {
  const knower = elements.find(e => e.id === knowerId);
  if (!knower) return [];
  const entries = listKnowledgeEntries(elements);
  switch (knower.type) {
    case 'character':
      return entries.filter(e => characterKnowsEntry(knowerId, e, elements));
    case 'collective':
      return entries.filter(e => heldByOf(e).collectives.includes(knowerId));
    default:
      return [];
  }
}

/** Element ids a knower knows *about* — union of about-subjects across all entries they hold. */
export function elementsKnownAboutBy(knowerId: string, elements: Element[]): string[] {
  const held = knowledgeHeldBy(knowerId, elements);
  const ids = new Set<string>();
  for (const entry of held) for (const id of aboutIdsOf(entry)) ids.add(id);
  return [...ids];
}

/** Optional Circle marker subtype — purely organizational, never load-bearing (convention #72). */
export const CIRCLE_SUBTYPE = 'circle';

/**
 * The world's knowers, for the Knowers list: every DIRECT holder (narrator
 * Characters + holding Collectives) plus proactively-created Circles
 * (Collectives tagged `subtype: 'circle'`, even when they hold nothing yet).
 * Circle members are NOT expanded here — a 50-member circle lists as one
 * circle, not 50 knowers; arbitrary characters are reachable via a picker.
 * Sorted: collectives first, then characters, alphabetical within each.
 */
export function listKnowers(elements: Element[]): Element[] {
  const ids = new Set<string>();
  for (const entry of listKnowledgeEntries(elements)) {
    const held = heldByOf(entry);
    if (held.narrator) ids.add(held.narrator);
    for (const cid of held.collectives) ids.add(cid);
  }
  const out = elements.filter(e => {
    if (ids.has(e.id) && isKnowerType(e.type)) return true;
    if (e.type !== 'collective') return false;
    const subtype = (e as Record<string, unknown>).subtype;
    return typeof subtype === 'string' && subtype.toLowerCase() === CIRCLE_SUBTYPE;
  });
  return out.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'collective' ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

/**
 * The DIRECT holders (narrator Characters + Circles) of every knowledge entry
 * that is *about* the given element — "who knows about X, via what." Members
 * of holding circles are not expanded (the circle IS the answer). Used by the
 * element-detail "Known by" surfacing (K6).
 */
export function knowersOfElement(elementId: string, elements: Element[]): Element[] {
  const ids = new Set<string>();
  for (const entry of listKnowledgeEntries(elements)) {
    if (!aboutIdsOf(entry).includes(elementId)) continue;
    const held = heldByOf(entry);
    if (held.narrator) ids.add(held.narrator);
    for (const cid of held.collectives) ids.add(cid);
  }
  return elements.filter(e => ids.has(e.id) && isKnowerType(e.type));
}
