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
import { CHARTER_PAIRS, charterOf, handsOnAsProposed, isCharterElement, simpleCaseFold, type OwReadingAids } from '@onlyworlds/sdk';
import type { Element } from './types';

/** Which reading aid a pair makes (the charter profile's three). */
export type AidKind = 'charter' | 'guide' | 'domain';

/**
 * The pair alone, marked or not: which aid this element would be. The SDK's
 * own pairs (`CHARTER_PAIRS`) matched on the type and the supertype trimmed and
 * folded with the SDK's fold; `readingAidKey` does this inside the SDK and is
 * not exported yet (the 1.101 contract gate's G1), so no copy of the pairs
 * lives here.
 */
export function aidKind(el: Element): AidKind | null {
  const sup = (el as Record<string, unknown>).supertype;
  if (typeof el.type !== 'string' || typeof sup !== 'string') return null;
  const want = simpleCaseFold(sup.trim());
  const pair = CHARTER_PAIRS.find(p => p.type === el.type && simpleCaseFold(p.supertype) === want);
  return pair ? pair.aid : null;
}

/** A Law with supertype Charter, marked or not: the button's reach (core/charter-mark.ts). */
export function isCharter(el: Element): boolean {
  return aidKind(el) === 'charter';
}

/**
 * A reading aid as Atlas counts one, everywhere ("marked", the gate's N2): the
 * pair and the mark (the SDK's test, the mark by presence) and not proposed,
 * which is exactly what `charterOf` sees at the owner rung.
 */
export function isReadingAid(el: Element): boolean {
  return isCharterElement(el as never) && !handsOnAsProposed(el);
}

/** A Charter the profile counts: the pair and the mark, and not proposed. */
export function isMarkedCharter(el: Element): boolean {
  return el.type === 'law' && isReadingAid(el) && aidKind(el) === 'charter';
}

/** The SDK's packet and the marked Charters and Guides, once per elements array (the gate's G12). */
interface AidsMemo { from: readonly Element[]; packet: OwReadingAids; charters: string[]; guides: string[]; count: number }
let memo: AidsMemo | null = null;

export function readingAids(elements: readonly Element[]): AidsMemo {
  if (memo && memo.from === elements) return memo;
  const packet = charterOf({ elements } as never, { rung: 'owner' });
  const charters: string[] = [];
  const guides: string[] = [];
  let count = 0;
  for (const el of elements) {
    if (!isReadingAid(el)) continue;
    count++;
    const kind = aidKind(el);
    if (kind === 'charter') charters.push(el.id);
    else if (kind === 'guide') guides.push(el.id);
  }
  memo = { from: elements, packet, charters, guides, count };
  return memo;
}

/** The SDK's pick, memoised on the elements array (the store hands a new array on every change). */
function newestMarked(elements: readonly Element[]): string | null {
  return readingAids(elements).packet.charter?.id ?? null;
}

/** The leading marked Guide's id, or null. */
export function leadingGuideId(elements: readonly Element[]): string | null {
  return readingAids(elements).packet.guide?.id ?? null;
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
