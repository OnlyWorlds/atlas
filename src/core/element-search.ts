/**
 * Element text matching — ONE search language for the command palette and
 * the elements-sidebar filter (the palette's "see all →" hands its query to
 * the sidebar, so the sidebar must match a superset of what the palette
 * ranks; a name-only sidebar filter would show "no matches" for a query the
 * palette just matched by description).
 *
 * Tiers (higher = better): name prefix 100 · name substring 80 · alias 70 ·
 * supertype/subtype 60 · description 40 (with a context snippet).
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
    const start = Math.max(0, at - SNIPPET_RADIUS);
    const end = Math.min(desc.length, at + q.length + SNIPPET_RADIUS);
    const snippet = `${start > 0 ? '…' : ''}${desc.slice(start, end).trim()}${end < desc.length ? '…' : ''}`;
    return { score: 40, snippet };
  }
  return null;
}

/** Boolean form for filter surfaces (the elements sidebar). Query may be raw. */
export function elementMatchesQuery(el: Element, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return scoreElementMatch(el, q) !== null;
}
