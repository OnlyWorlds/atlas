/**
 * Mention-picker item builder for the writing workspace.
 *
 * Powers the @-mention suggestion list: an empty query surfaces picker-recents
 * then recently-edited elements; a typed query runs alias-aware fuzzy scoring
 * across the world. Extracted from writing-workspace.ts — it's a
 * pure read of global state + recents with no workspace-mount closure
 * dependencies, so it lives standalone and is independently testable.
 */

import { getState } from '../core/state';
import { typeName } from '../core/type-words';
import type { Element } from '../core/types';
import { getRecents } from './writing-workspace-recents';
import type { MentionSuggestionItem } from './writing-workspace-mention';
import { currentLore } from '../core/parlor-room';

/**
 * Element types that shouldn't appear in the picker — they aren't
 * narrative-linkable entities. Markers and pins are map-internal (anchors on
 * maps, not story characters/places). Narratives can't link to themselves.
 * Maps are debatable but excluded for v1 to keep the picker focused on
 * world-building entities.
 */
const PICKER_EXCLUDED_TYPES = new Set(['narrative', 'pin', 'marker', 'map']);

export function buildMentionItems(query: string): MentionSuggestionItem[] {
  const state = getState();
  if (!state.active) return [];
  const worldId = state.active.worldId;
  const q = query.toLowerCase().trim();
  // Mentions offer the lore (conv. 161): a story never mentions the parlor's room by accident.
  const elements = currentLore();
  const byId = new Map<string, Element>();
  for (const e of elements) byId.set(e.id, e);

  // Empty query → recently-edited elements (by local_updated_at desc), with
  // picker recents promoted to the top. "Recently-edited" matches the writer's
  // natural workflow ("I just touched X, now I'm writing about it"). Once the
  // user types, fuzzy match takes over.
  if (q === '') {
    const out: MentionSuggestionItem[] = [];
    const seen = new Set<string>();
    // First: explicit picker recents (the writer's intentional history).
    for (const id of getRecents(worldId)) {
      const el = byId.get(id);
      if (!el || PICKER_EXCLUDED_TYPES.has(el.type)) continue;
      seen.add(id);
      out.push(toItem(el));
    }
    // Then: recently-edited elements (whatever the writer touched lately in
    // element-detail elsewhere — Drizzle's description, etc.). Sorted by
    // local_updated_at desc. Pad up to 8.
    if (out.length < 8) {
      const byMtime = elements
        .filter(e => !PICKER_EXCLUDED_TYPES.has(e.type) && !seen.has(e.id))
        .slice()
        .sort((a, b) => {
          const aT = a.local_updated_at ?? '';
          const bT = b.local_updated_at ?? '';
          return aT < bT ? 1 : aT > bT ? -1 : 0;
        });
      for (const el of byMtime) {
        if (out.length >= 8) break;
        out.push(toItem(el));
      }
    }
    return out;
  }

  const scored: Array<{ score: number; item: MentionSuggestionItem }> = [];
  for (const el of elements) {
    if (PICKER_EXCLUDED_TYPES.has(el.type)) continue;
    const aliases = el.atlas_aliases;
    const name = (el.name || '').toLowerCase();
    const aliasMatches = Array.isArray(aliases) ? aliases.map(a => a.toLowerCase()) : [];

    let score = 0;
    if (name.startsWith(q)) {
      score = 100;
    } else if (name.includes(q)) {
      score = 50;
    } else if (aliasMatches.some(a => a.startsWith(q))) {
      score = 80;
    } else if (aliasMatches.some(a => a.includes(q))) {
      score = 40;
    }
    if (score === 0) continue;

    scored.push({ score, item: toItem(el) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.item).slice(0, 50);
}

function toItem(el: Element): MentionSuggestionItem {
  const aliases = el.atlas_aliases;
  return {
    id: el.id,
    type: el.type,
    name: el.name || '(unnamed)',
    subtitle: buildSubtitle(el),
    aliases,
  };
}

function buildSubtitle(el: Element): string | undefined {
  // For v1 keep it light — just the element-type label. Disambiguation by
  // parent location / family / etc. is a polish refinement.
  return typeName(el.type, { supertype: el.supertype });
}
