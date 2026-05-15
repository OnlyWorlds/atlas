/**
 * NPM autocomplete matcher (DESIGN_MAPS.md §3.7).
 *
 * Given the user's typed name prefix + the currently-selected category + the
 * full element list, return the best existing-element candidate to autocomplete
 * to. Used by ElementCreateModal's NPM mode for "place existing" via TAB.
 *
 * Rules:
 *   - Only consider elements of the selected category (type === category).
 *   - Name must startsWith the typed prefix (case-insensitive).
 *   - Name must be STRICTLY longer than the typed prefix — exact-match doesn't
 *     produce a ghost suffix (nothing to display).
 *   - Multi-match tiebreaker: latest `local_updated_at` wins (descending).
 *
 * Returns null when typed is empty or no candidate qualifies. Pure function.
 */

import type { Element, ElementType } from '../core/types';

export interface NameMatchResult {
  id: string;
  type: ElementType;
  name: string;
}

export function findExistingNameMatch(
  typedRaw: string,
  category: ElementType,
  elements: readonly Element[],
): NameMatchResult | null {
  const typed = typedRaw.trim();
  if (!typed) return null;
  const lower = typed.toLowerCase();
  const matches: Element[] = [];
  for (const el of elements) {
    if (el.type !== category) continue;
    const name = (el.name ?? '').trim();
    if (name.length <= typed.length) continue;
    if (name.toLowerCase().startsWith(lower)) matches.push(el);
  }
  if (matches.length === 0) return null;
  matches.sort((a, b) => {
    const aT = a.local_updated_at ?? '';
    const bT = b.local_updated_at ?? '';
    return bT.localeCompare(aT);
  });
  const winner = matches[0];
  return { id: winner.id, type: winner.type, name: winner.name ?? '' };
}
