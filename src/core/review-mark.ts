/**
 * The review profile's proposed mark (schema-dist dist.52 `profiles/review.md`,
 * Keel #565's reader rule, Skeld h29 #11116; conv. 168). An element whose
 * `x_review_proposed` is an object was written as proposed (an AI seat's new
 * element on a world whose keeper reviews them) and is not canon until a keeper
 * settles it: accept writes the mark null, decline deletes the element.
 *
 * Atlas shows a world to its people, so a proposed element is shown with the
 * word on it and never counted as what the world holds. Its share page hands a
 * world on, so there a proposed element is left out.
 *
 * Two readings, on purpose. Shown as proposed: an object (the profile's point
 * 4, any other value is ignored and stays a read-only custom field). Handed on
 * as proposed: any value but null (Kael's pack, `is_proposed`: a doubt leaves
 * the element out rather than handing it on as fact).
 */
import type { OwMember } from '@onlyworlds/sdk';
import type { Element } from './types';
import { memberNameOf } from './agent-mark';
import { escapeAttr, escapeText } from './dom-utils';

export const PROPOSED_MARK = 'x_review_proposed';

export interface ProposedMark {
  /** The membership that proposed it, when the mark names one. */
  by: string | null;
  /** The day it lapses (YYYY-MM-DD), when the mark gives one. */
  expires: string | null;
  /** `expires` has come: shown as lapsed, never deleted on its own. */
  lapsed: boolean;
}

/**
 * Today as the profile writes a day, in UTC: keel's queue reads a proposal as
 * lapsed from midnight UTC of its `expires` day (`state_of`; the S459 gate's F8),
 * so Atlas reads it on the same day keel does.
 */
export function todayDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The mark as shown, or null for a settled element (absent, null, or a value that is not an object). */
export function proposedMarkOf(el: unknown, today = todayDay()): ProposedMark | null {
  if (!el || typeof el !== 'object') return null;
  const v = (el as Record<string, unknown>)[PROPOSED_MARK];
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  const by = typeof m.by === 'string' && m.by.trim() ? m.by.trim() : null;
  const expires = typeof m.expires === 'string' && DAY.test(m.expires.trim()) ? m.expires.trim() : null;
  return { by, expires, lapsed: expires !== null && expires <= today };
}

export function isProposed(el: unknown): boolean {
  return proposedMarkOf(el) !== null;
}

/** Left out of anything Atlas hands on: the mark with any value but null. */
export function handsOnAsProposed(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const v = (el as Record<string, unknown>)[PROPOSED_MARK];
  return v !== undefined && v !== null;
}

/**
 * What a create keeps from keel's answer (keel #565, probed live S459): on a
 * world whose keeper reviews AI seats, keel writes the mark on a seat's new
 * element and answers with it. The push stamps only keel's time, so without
 * this the copy that made the element never carries the mark (keel's stamp then
 * equals the baseline, and no pull fetches it). Undefined when keel wrote none.
 */
export function keptOnCreate(response: unknown): Record<string, unknown> | undefined {
  if (!response || typeof response !== 'object') return undefined;
  const v = (response as Record<string, unknown>)[PROPOSED_MARK];
  return v === undefined || v === null ? undefined : { [PROPOSED_MARK]: v };
}

/**
 * The world as its counts read it: without proposed elements. Memoised on the
 * array, so a render gate keyed on the result redraws exactly when it moves, and
 * a world with nothing proposed returns its own array.
 */
let settledMemo: { from: readonly Element[]; out: Element[] } | null = null;
export function settledOf(elements: Element[]): Element[] {
  if (settledMemo && settledMemo.from === elements) return settledMemo.out;
  const out = elements.some(isProposed) ? elements.filter(el => !isProposed(el)) : elements;
  settledMemo = { from: elements, out };
  return out;
}

export function proposedCount(elements: readonly Element[]): number {
  let n = 0;
  for (const el of elements) if (isProposed(el)) n++;
  return n;
}

/** "22 November 2026" for a profile day. */
function dayWords(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** The word on a row or a header. */
export function proposedWord(mark: ProposedMark): string {
  return mark.lapsed ? 'Proposed, lapsed' : 'Proposed';
}

/** The word on a row built as HTML (the list, Home's Recent), or nothing for a settled element. */
export function proposedRowWord(el: unknown): string {
  const mark = proposedMarkOf(el);
  if (!mark) return '';
  const title = mark.lapsed ? 'Proposed and not yet reviewed; the proposal has lapsed' : 'Proposed and not yet reviewed: not part of the world until a keeper accepts it';
  return `<span class="atlas-row-proposed" data-role="proposed-word" title="${escapeAttr(title)}">${escapeText(proposedWord(mark))}</span>`;
}

/**
 * The one line, for the label, the tooltip and a tap: who proposed it (the
 * roster's name when there is one), that no keeper has reviewed it, and when it
 * lapses.
 */
export function proposedLine(
  mark: ProposedMark,
  roster: readonly OwMember[] | null,
  nameOf: (id: string) => string | undefined,
): string {
  const row = roster && mark.by ? roster.find(m => m.id === mark.by) ?? null : null;
  const name = row ? memberNameOf(mark.by, roster, nameOf) : null;
  const who = name ? `${name}${row?.kind === 'agent' ? ', an agent,' : ''}` : 'a member';
  const head = `Proposed by ${who} and not yet reviewed: it is not part of the world, or its counts, until a keeper accepts it.`;
  if (!mark.expires) return head;
  return mark.lapsed
    ? `${head} The proposal lapsed on ${dayWords(mark.expires)}.`
    : `${head} It lapses on ${dayWords(mark.expires)}.`;
}
