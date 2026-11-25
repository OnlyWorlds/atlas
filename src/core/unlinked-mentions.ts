/**
 * Unlinked mentions: where an element's name or aliases appear as
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
 * The match rule is the writing hints': the element's own name finder
 * (`elementSpans`: name and aliases, a word edge in every script, folded
 * case), over the stored `story`, a name a markdown label cannot hold passed
 * over (`MENTIONS_MARKDOWN`). Link all writes by the same spans and the same
 * rule (`bulkLinkSpans`), so the count and the link agree on the story.
 */

import type { Element } from './types';
import { MIN_NAME_CHARS, MENTIONS_MARKDOWN, elementSpans, findSpansMarkdown } from './prose-autolink';
import { nameOrUnnamed, ownName } from './type-words';

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
  /** Name ∪ aliases, trimmed, long enough; no count or write reads it (the finder reads its own names). */
  terms: string[];
}

/** Types the autolink index never links; scanning for them would be noise. */
const NEVER_MENTIONED = new Set(['narrative', 'pin', 'marker', 'map']);

/** Name ∪ aliases, trimmed, deduplicated, at least MIN_NAME_CHARS: the result's `terms`. */
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
  const spans = elementSpans(el);
  if (!spans) return EMPTY;
  const terms = mentionTermsFor(el);
  const narratives: NarrativeMentions[] = [];
  // Sorted by the narrative's own name: an unnamed one sorts first, never among the T's.
  const sortName = new Map<string, string>();
  let total = 0;
  for (const n of elements) {
    if (n.type !== 'narrative' || n.id === el.id) continue;
    const story = typeof n.story === 'string' ? n.story : '';
    if (!story) continue;
    const count = findSpansMarkdown(story, spans, MENTIONS_MARKDOWN).length;
    if (count === 0) continue;
    // Each is a link of its own after "Mentioned, unlinked (…):", and a reader may say it alone: the capital.
    narratives.push({ id: n.id, name: nameOrUnnamed(n, { start: true }), count });
    sortName.set(n.id, ownName(n));
    total += count;
  }
  narratives.sort((a, b) => b.count - a.count || (sortName.get(a.id) ?? '').localeCompare(sortName.get(b.id) ?? ''));
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
