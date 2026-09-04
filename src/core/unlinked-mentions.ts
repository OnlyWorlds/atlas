/**
 * Unlinked mentions (S355): where an element's name or aliases appear as
 * plain prose across the world's narratives, not yet linked. Answers the
 * first half of a Discord request ("if I make a new element, is there a way
 * to search for any matching words and link those all at once") for the
 * context pane's preview line ("Mentioned, unlinked (7 in 4 scenes) · Link
 * all") and the create modal's nudge ("appears in 4 scenes").
 *
 * Pure and store-free: the caller hands in the elements array. Results are
 * cached per elements-array reference (the state swaps the array on every
 * write, so a stale cache is impossible and idle ticks cost nothing).
 *
 * The match rule is the find bar's, whole-word and case-insensitive, over
 * name ∪ aliases with the autolink kernel's minimum key length; text inside
 * an existing link is never counted. The same terms feed `bulkLinkTerm`, so
 * the count and the link agree by construction.
 */

import type { Element } from './types';
import { MIN_NAME_CHARS, findTermSpansMarkdown } from './prose-autolink';

export interface NarrativeMentions {
  id: string;
  name: string;
  count: number;
}

export interface UnlinkedMentions {
  /** Every match across every narrative. */
  total: number;
  /** Narratives with at least one match, most mentions first. */
  narratives: NarrativeMentions[];
  /** The terms that were scanned for (name ∪ aliases, trimmed, long enough). */
  terms: string[];
}

/** Types the autolink index never links; scanning for them would be noise. */
const NEVER_MENTIONED = new Set(['narrative', 'pin', 'marker', 'map']);

export const MENTION_MATCH = { wholeWord: true, caseSensitive: false } as const;

/** Name ∪ aliases as scan terms, trimmed, deduplicated, at least MIN_NAME_CHARS. */
export function mentionTermsFor(el: Element): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown): void => {
    if (typeof raw !== 'string') return;
    const t = raw.trim();
    if (t.length < MIN_NAME_CHARS) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(t);
  };
  push(el.name);
  if (Array.isArray(el.atlas_aliases)) el.atlas_aliases.forEach(push);
  return out;
}

const EMPTY: UnlinkedMentions = { total: 0, narratives: [], terms: [] };

const cache = new WeakMap<readonly Element[], Map<string, UnlinkedMentions>>();

export function findUnlinkedMentions(el: Element, elements: readonly Element[]): UnlinkedMentions {
  let perArray = cache.get(elements);
  if (!perArray) {
    perArray = new Map();
    cache.set(elements, perArray);
  }
  const hit = perArray.get(el.id);
  if (hit) return hit;
  const result = scan(el, elements);
  perArray.set(el.id, result);
  return result;
}

function scan(el: Element, elements: readonly Element[]): UnlinkedMentions {
  if (NEVER_MENTIONED.has(el.type)) return EMPTY;
  const terms = mentionTermsFor(el);
  if (terms.length === 0) return EMPTY;
  const narratives: NarrativeMentions[] = [];
  let total = 0;
  for (const n of elements) {
    if (n.type !== 'narrative' || n.id === el.id) continue;
    const story = typeof n.story === 'string' ? n.story : '';
    if (!story) continue;
    const count = findTermSpansMarkdown(story, terms, MENTION_MATCH).length;
    if (count === 0) continue;
    narratives.push({ id: n.id, name: n.name || '(unnamed)', count });
    total += count;
  }
  narratives.sort((a, b) => b.count - a.count || (a.name ?? '').localeCompare(b.name ?? ''));
  return { total, narratives, terms };
}

/** "7 in 4 scenes" / "1 in 1 scene", using the world's own tier word. */
export function mentionsPhrase(m: UnlinkedMentions, narrativeWord = 'scene'): string {
  const n = m.narratives.length;
  return `${m.total} in ${n} ${narrativeWord}${n === 1 ? '' : 's'}`;
}

/** The create modal's success line, with the nudge when there is something to link. */
export function createdToastText(typeLabel: string, name: string, m: UnlinkedMentions): string {
  const base = `Created ${typeLabel}: ${name}`;
  if (m.total === 0) return base;
  const n = m.narratives.length;
  return `${base} · appears in ${n} narrative${n === 1 ? '' : 's'}, unlinked`;
}
