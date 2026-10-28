/**
 * A world's charter (#526): the rules for the people and AIs in it. Home shows
 * it first, so a person meets the rules an agent is told to read before
 * anything else.
 *
 * The charter profile (schema-dist serial 83) is the one definition: a Law with
 * supertype Charter that carries the mark `x_charter_of` (read by presence).
 * Without the mark it is lore (a kingdom's charter in a novel). The newest
 * marked one leads. keel refuses the mark set by anyone but the owner or a
 * co-builder, so the mark stands where D152's maker test stood, and no roster
 * is read. The pick is the SDK's own `charterOf` at the owner rung, never a
 * copy of its rule (the 1.100 contract gate found a copy disagreeing on
 * keel's microseconds, a time with no offset and a proposed mark).
 */
import { charterOf, handsOnAsProposed, isCharterElement } from '@onlyworlds/sdk';
import type { Element } from './types';

/** A Law with supertype Charter, marked or not: the button's reach (core/charter-mark.ts). */
export function isCharter(el: Element): boolean {
  if (el.type !== 'law') return false;
  const sup = (el as Record<string, unknown>).supertype;
  return typeof sup === 'string' && sup.trim().toLowerCase() === 'charter';
}

/** A Charter the profile counts: the pair and the mark, and not proposed. */
export function isMarkedCharter(el: Element): boolean {
  return el.type === 'law' && isCharterElement(el as never) && !handsOnAsProposed(el);
}

let memoElements: readonly Element[] | null = null;
let memoId: string | null = null;

/** The SDK's pick, memoised on the elements array (the store hands a new array on every change). */
function newestMarked(elements: readonly Element[]): string | null {
  if (elements !== memoElements) {
    memoElements = elements;
    memoId = charterOf({ elements } as never, { rung: 'owner' }).charter?.id ?? null;
  }
  return memoId;
}

/**
 * `named` is world.json's `charter` (folder spec §4.6 (a), v0.3.20): a folder's
 * shortcut and tie-break, which picks among marked Charters only and never
 * stands in for the mark. Anything else in it (a missing id, an unmarked Law,
 * not a string) leaves the SDK's pick.
 */
export function findCharter(elements: readonly Element[], named?: unknown): Element | null {
  if (typeof named === 'string' && named) {
    const law = elements.find(el => el.id === named);
    if (law && isMarkedCharter(law)) return law;
  }
  const id = newestMarked(elements);
  return id === null ? null : elements.find(el => el.id === id) ?? null;
}

/** The charter's opening, for Home: its first paragraph, cut at a word near `max` characters. */
export function charterLead(el: Element, max = 280): string {
  const text = typeof el.description === 'string' ? el.description.trim() : '';
  if (!text) return '';
  const first = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
