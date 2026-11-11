/**
 * The review profile's proposed mark (schema-dist dist.52 `profiles/review.md`,
 * keel's reader rule, Skeld 2026-10-23; conv. 168). An element whose
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
 *
 * Both readings are the SDK's since 4.84 (the profile's readers: `proposedMarkOf`
 * shows, `handsOnAsProposed` hands on; trimmed by the profile's white space, so a
 * byte order mark stays, and a `today` not shaped YYYY-MM-DD is refused).
 */
import { handsOnAsProposed, proposedMarkOf, PROPOSED_MARK, type OwMember, type OwProposedMark } from '@onlyworlds/sdk';
import type { Element } from './types';
import { escapeAttr, escapeText } from './dom-utils';

export { handsOnAsProposed, proposedMarkOf, PROPOSED_MARK };

export type ProposedMark = OwProposedMark;

/**
 * Today as the profile writes a day, in UTC: keel's queue reads a proposal as
 * lapsed from midnight UTC of its `expires` day (`state_of`),
 * so Atlas reads it on the same day keel does (the SDK's default too).
 */
export function todayDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function isProposed(el: unknown): boolean {
  return proposedMarkOf(el) !== null;
}

/**
 * What a create keeps from keel's answer (probed live): on a
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
 * a world with nothing proposed returns its own array. One slot per array: Home
 * hands it the lore and the lore with the aids, and a single slot evicted the
 * other each render, so every reading memoised on the result read again (the
 * 1.118.0 gate's N8: the graph reader re-run on each Home render).
 */
const settledMemo = new WeakMap<readonly Element[], Element[]>();
export function settledOf(elements: Element[]): Element[] {
  const memo = settledMemo.get(elements);
  if (memo) return memo;
  const out = elements.some(isProposed) ? elements.filter(el => !isProposed(el)) : elements;
  settledMemo.set(elements, out);
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

/** The short line under a row's or a graph node's word (its tooltip). */
export function proposedTitle(mark: ProposedMark): string {
  return mark.lapsed ? 'Proposed and not yet reviewed; the proposal has lapsed' : 'Proposed and not yet reviewed: not part of the world until a keeper accepts it';
}

/** The word on a row built as HTML (the list, Home's Recent), or nothing for a settled element. */
export function proposedRowWord(el: unknown): string {
  const mark = proposedMarkOf(el);
  if (!mark) return '';
  return `<span class="atlas-row-proposed" data-role="proposed-word" title="${escapeAttr(proposedTitle(mark))}">${escapeText(proposedWord(mark))}</span>`;
}

/**
 * An id as the platform's ids are compared (the review profile's "Who `by` names", serial 116:
 * "comparing ids as ids, both parsed"): keel's are UUIDs and keel reads any spelling of one, as
 * Python's `uuid.UUID` parses it (urn: and uuid: dropped, braces at the ends, hyphens anywhere,
 * either case). Null for anything that is not one, White_Space around it included.
 */
export function uuidKey(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const hex = v.replace(/urn:/g, '').replace(/uuid:/g, '').replace(/^[{}]+|[{}]+$/g, '').replace(/-/g, '');
  return /^[0-9a-fA-F]{32}$/.test(hex) ? hex.toLowerCase() : null;
}

/** Unicode White_Space, as the profiles read it (U+FEFF is not White_Space, U+0085 is). */
const WHITE_SPACE_ONLY = /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

/**
 * Who a mark's `by` names, said as the mark's word (the review profile, serial 116): only a member
 * on the roster or the world's owner (by the platform's name, its kind beside it), or a Character
 * of this world ("the Character Rachmaninov"). Anything else, or a `by` that names nobody (not a
 * string, White_Space alone), is null: the line then says no name, and the raw value stays in the
 * mark's own read-only row, as data. `by` is read as stored, never trimmed. `characterName` is
 * asked with a `uuidKey`, so it compares the world's Character ids by `uuidKey` too.
 */
export function markNames(
  by: unknown,
  roster: readonly OwMember[] | null,
  characterName: (id: string) => unknown,
): string | null {
  if (typeof by !== 'string' || WHITE_SPACE_ONLY.test(by)) return null;
  const served = (row: OwMember | undefined) => (typeof row?.name === 'string' && row.name.trim() ? row.name.trim() : null);
  // keel writes the exact word `owner` as the `by` of the world's owner, who has no membership. Only a
  // platform resolves it: a world with no roster (a folder, an unlinked world, a roster not read) has
  // nobody to resolve it to, so there the word is the mark's raw value (the S591 gate's M1).
  if (by === 'owner') {
    if (!roster) return null;
    const name = served(roster?.find(m => m.kind === 'owner'));
    return name ? `${name}, the world's owner` : "the world's owner";
  }
  const key = uuidKey(by);
  if (!key) return null;
  const row = roster?.find(m => uuidKey(m.id) === key);
  if (row) {
    // A seat chooses its own name ("the owner" included), so a seat is said with its kind.
    const kind = row.kind === 'agent' ? ", an AI's seat" : row.kind === 'player' ? ", a player's seat" : '';
    return `${served(row) ?? by}${kind}`;
  }
  const character = characterName(key);
  return typeof character === 'string' && character.trim() ? `the Character ${character.trim()}` : null;
}

/**
 * The one line, for the label, the tooltip and a tap: that no keeper has reviewed it, whom the
 * mark names when it names someone this reader knows (`markNames`), and when it lapses. Never
 * "proposed by": a `by` is the writer's word, not a fact (serial 116).
 */
export function proposedLine(
  mark: ProposedMark,
  by: unknown,
  roster: readonly OwMember[] | null,
  characterName: (id: string) => unknown,
): string {
  const head = 'Proposed and not yet reviewed: it is not part of the world, or its counts, until a keeper accepts it.';
  const who = markNames(by, roster, characterName);
  const named = who ? `${head} The mark names ${who}.` : head;
  if (!mark.expires) return named;
  return mark.lapsed
    ? `${named} The proposal lapsed on ${dayWords(mark.expires)}.`
    : `${named} It lapses on ${dayWords(mark.expires)}.`;
}

/** A mark's `by` as stored on the element, never trimmed (the SDK's reader trims it). */
export function rawProposedBy(el: unknown): unknown {
  const v = el && typeof el === 'object' ? (el as Record<string, unknown>)[PROPOSED_MARK] : undefined;
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>).by : undefined;
}
