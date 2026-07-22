/**
 * Element text matching — ONE search language for the command palette and
 * the elements-sidebar filter (the palette's "see all →" hands its query to
 * the sidebar, so the sidebar must match a superset of what the palette
 * ranks; a name-only sidebar filter would show "no matches" for a query the
 * palette just matched by description).
 *
 * Tiers (higher = better): name prefix 100 · name substring 80 · alias 70 ·
 * supertype/subtype 60 · description 40 · story 30 (both with a context
 * snippet).
 *
 * STORY is the prose body of a Narrative — the writing room's actual content.
 * It ranks LAST on purpose: a word appearing somewhere inside a chapter is the
 * weakest possible signal that the chapter is what you meant, so a story hit
 * must never outrank a name or even a description hit. It is included at all
 * because "find the scene where I wrote about the swamps" is a real thing
 * writers need and nothing else in atlas answers it.
 *
 * PERF (measured, S310, not assumed): on a worst-case 588-element world
 * carrying 2 MB of prose, adding this tier moved a full-world query from
 * 0.090 ms to 0.705 ms. That is 7.8x relative and irrelevant absolute — a
 * keystroke has ~16 ms before it drops a frame, so this spends 4% of the
 * budget. Re-measure before adding any further full-text tier; the ratio is
 * the thing that will keep growing.
 */

import type { Element } from './types';

const SNIPPET_RADIUS = 44;

export interface ElementMatch {
  score: number;
  /** Description context around the match (description-tier matches only). */
  snippet?: string;
}

/** Score an element against a normalized (trimmed, lowercased) query; null = no match. */
export function scoreElementMatch(el: Element, q: string): ElementMatch | null {
  const name = (el.name ?? '').trim().toLowerCase();
  if (name) {
    if (name.startsWith(q)) return { score: 100 };
    if (name.includes(q)) return { score: 80 };
  }
  const aliases = (el as Record<string, unknown>).atlas_aliases;
  if (Array.isArray(aliases) && aliases.some(a => typeof a === 'string' && a.trim().toLowerCase().includes(q))) {
    return { score: 70 };
  }
  const superT = String((el as Record<string, unknown>).supertype ?? '').trim().toLowerCase();
  const subT = String((el as Record<string, unknown>).subtype ?? '').trim().toLowerCase();
  if ((superT && superT.includes(q)) || (subT && subT.includes(q))) return { score: 60 };
  const desc = String((el as Record<string, unknown>).description ?? '');
  const at = desc.toLowerCase().indexOf(q);
  if (desc && at >= 0) {
    return { score: 40, snippet: snippetAround(desc, at, q.length) };
  }
  // Prose body, last: see the tier note in the module header.
  const story = String((el as Record<string, unknown>).story ?? '');
  const storyAt = story.toLowerCase().indexOf(q);
  if (story && storyAt >= 0) {
    return { score: 30, snippet: snippetAround(story, storyAt, q.length) };
  }
  return null;
}

/** Context window around a match, elided on whichever sides were cut. */
function snippetAround(text: string, at: number, queryLength: number): string {
  const start = Math.max(0, at - SNIPPET_RADIUS);
  const end = Math.min(text.length, at + queryLength + SNIPPET_RADIUS);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Boolean form for filter surfaces (the elements sidebar). Query may be raw. */
export function elementMatchesQuery(el: Element, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return scoreElementMatch(el, q) !== null;
}
