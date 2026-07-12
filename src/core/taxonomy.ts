/**
 * Taxonomy helpers (D9b) — supertype/subtype as the world's free labeling axis.
 *
 * `suggestionsForField`: distinct values for a (type, field) pair, derived
 * LIVE from the loaded elements — never tracked, so server-pulled values and
 * multi-device edits appear automatically. Most-used first; narrative
 * supertype pins the four writing-tier labels in tier order.
 *
 * `reservedValueHint`: the atlas semantics attached to a VALUE, surfaced as a
 * quiet mark wherever taxonomy shows (element detail label, sidebar rows).
 * Matching mirrors the semantic sites EXACTLY: writing tiers compare
 * case-sensitively (writing-helpers.tierFor), knowledge/page/circle subtypes
 * case-insensitively (core/knowledge + core/sharing predicates).
 */

import { getState } from './state';
import { getWritingLabels } from '../middle/writing-helpers';
import { KNOWLEDGE_SUBTYPE, CIRCLE_SUBTYPE } from './knowledge';
import { PAGE_SUBTYPE } from './sharing';
import { isCustomEditableField, isPopulatedCustomValue } from './constants';
import type { Element } from './types';

const TAXONOMY_SUGGESTION_CAP = 8;
const CUSTOM_FIELD_SUGGESTION_CAP = 12;

/**
 * Distinct custom-field NAMES already in use across the world (D9) — the
 * add-field datalist, so "population" stays one field instead of five
 * spellings. Derived live from loaded elements, never tracked (D9b law).
 *
 * Only `x_`-namespaced fields feed the list (the add flow mints x_ keys;
 * suggesting a shadow_/atlas_ name would create a DIFFERENT key). Names are
 * returned bare (prefix stripped — what the user types). Null-valued keys
 * (deleted fields) don't suggest.
 */
export function customFieldNameSuggestions(): string[] {
  const counts = new Map<string, number>();
  for (const el of getState().data.elements) {
    for (const [k, v] of Object.entries(el)) {
      if (!k.startsWith('x_') || !isCustomEditableField(k)) continue;
      if (!isPopulatedCustomValue(v)) continue;
      const bare = k.slice(2);
      counts.set(bare, (counts.get(bare) ?? 0) + 1);
    }
  }
  return [...counts.keys()]
    .sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b))
    .slice(0, CUSTOM_FIELD_SUGGESTION_CAP);
}

export function suggestionsForField(el: Element, fieldName: string): string[] | null {
  if (fieldName !== 'supertype' && fieldName !== 'subtype') return null;
  const pinned: string[] = [];
  if (el.type === 'narrative' && fieldName === 'supertype') {
    const active = getState().active;
    if (active) {
      const labels = getWritingLabels(active.worldId);
      pinned.push(labels.l1, labels.l2, labels.l3, labels.l4);
    }
  }
  const counts = new Map<string, number>();
  for (const other of getState().data.elements) {
    if (other.type !== el.type) continue;
    const v = (other as Record<string, unknown>)[fieldName];
    if (typeof v !== 'string') continue;
    const trimmed = v.trim();
    if (!trimmed) continue;
    counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  const derived = [...counts.keys()]
    .filter(v => !pinned.includes(v))
    .sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b));
  const merged = [...pinned, ...derived].slice(0, Math.max(TAXONOMY_SUGGESTION_CAP, pinned.length));
  return merged.length > 0 ? merged : null;
}

export function reservedValueHint(el: Element, fieldName: string): string | null {
  const raw = (el as Record<string, unknown>)[fieldName];
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const v = raw.trim();
  if (el.type === 'narrative' && fieldName === 'supertype') {
    const active = getState().active;
    if (active) {
      const labels = getWritingLabels(active.worldId);
      if (v === labels.l1 || v === labels.l2 || v === labels.l3 || v === labels.l4) {
        return `"${v}" places this narrative in the writing tree`;
      }
    }
  }
  if (el.type === 'narrative' && fieldName === 'subtype') {
    if (v.toLowerCase() === KNOWLEDGE_SUBTYPE) return `"${v}" makes this a knowledge entry; it lives in the knowledge room`;
    if (v.toLowerCase() === PAGE_SUBTYPE) return `"${v}" makes this a share page; it lives in the pages room`;
  }
  if (el.type === 'collective' && fieldName === 'subtype') {
    if (v.toLowerCase() === CIRCLE_SUBTYPE) return `"${v}" marks this collective as a knowledge circle`;
  }
  return null;
}

/** The row-level mark: a value on EITHER taxonomy field with atlas semantics. */
export function reservedRowHint(el: Element): string | null {
  return reservedValueHint(el, 'supertype') ?? reservedValueHint(el, 'subtype');
}
