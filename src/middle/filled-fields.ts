/**
 * Which fields an element page shows when empty ones hide: during the tour
 * (S299, S311, S317) and, since #24 (S388), for anyone who turns on "Hide
 * empty fields". Pure, so the rule is testable without the page.
 */

import type { Element } from '../core/types';

/** A field holds something: not null, not blank text, not an empty list. */
export function isFieldFilled(el: Element, name: string): boolean {
  const v = (el as Record<string, unknown>)[name];
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * The sections with their empty fields taken out, and how many fields that
 * hid. A section left with none goes. `keepFirstWhole` keeps the first
 * section's full field set (the tour's Base on the consul step). When nothing
 * at all is filled, the first section stays whole, so the page never renders
 * fieldless and a new element still has somewhere to start.
 */
export function filledSections<S extends { fields: ReadonlyArray<{ name: string }> }>(
  sections: readonly S[],
  el: Element,
  opts: { keepFirstWhole?: boolean } = {},
): { sections: S[]; hidden: number } {
  const total = sections.reduce((n, s) => n + s.fields.length, 0);
  let kept = sections
    .map((s, i) => (i === 0 && opts.keepFirstWhole) ? s : ({ ...s, fields: s.fields.filter(f => isFieldFilled(el, f.name)) }))
    .filter(s => s.fields.length > 0);
  if (kept.length === 0) kept = sections.slice(0, 1);
  const shown = kept.reduce((n, s) => n + s.fields.length, 0);
  return { sections: kept, hidden: total - shown };
}
