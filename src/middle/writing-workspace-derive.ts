/**
 * Auto-derive narrative relation fields from prose links.
 *
 * Convention #50 (DESIGN_WRITING.md): on every workspace save the markdown is
 * scanned for `ow://<type>/<uuid>` links. UUIDs are grouped by element type
 * and unioned into the matching multi-link relation field on the Narrative.
 * Manual additions are preserved (UNION semantics, never destructive).
 *
 * Single-link fields (protagonist / antagonist / narrator / conservator) are
 * NOT auto-derived — they're authorial choices, not "every character who
 * happens to be mentioned." Only the "Involves" multi-link fields receive
 * the auto-populated UUIDs.
 */

import type { Element, ElementType } from '../core/types';
import { NARRATIVE_RELATION_FIELDS } from '../core/narrative-fields';
// Scanner from core/ow-links (NOT the chip module) — keeps this module
// TipTap-free so the knowledge room can import it statically without
// breaking the editor code-split.
import { createOwLinkScanner } from '../core/ow-links';

// Canonical map lives in core/narrative-fields.ts (also consumed by
// core/knowledge.ts). Re-exported here for the writing modules + tests.
export { NARRATIVE_RELATION_FIELDS };

/**
 * Parse markdown for `ow://<type>/<uuid>` links and group UUIDs by element type.
 * Duplicates within the same type are deduped.
 */
export function extractProseLinks(markdown: string): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  // Fresh scanner per call — never share a /g regex (lastIndex is stateful).
  const scanner = createOwLinkScanner();
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(markdown)) !== null) {
    const type = match[1].toLowerCase();
    const id = match[2];
    if (!out[type]) out[type] = new Set();
    out[type].add(id);
  }
  const flat: Record<string, string[]> = {};
  for (const [type, ids] of Object.entries(out)) {
    flat[type] = Array.from(ids);
  }
  return flat;
}

/** Does a prose link point at an element that exists, with that type? */
export type LinkTargetExists = (type: string, id: string) => boolean;

/**
 * The existence check every derive caller passes, built from the world's
 * element list. A chip can outlive its element: a delete scrubs the link
 * FIELDS (conv. 101) and deliberately leaves the prose alone, so the derive
 * must not put the dead id back (S364: it did, at every scene open).
 */
export function linkTargetsIn(elements: readonly Element[]): LinkTargetExists {
  const typeOf = new Map<string, string>();
  for (const e of elements) typeOf.set(e.id, e.type);
  return (type, id) => typeOf.get(id) === type;
}

/**
 * Given a Narrative element and a markdown snapshot, compute the patch needed
 * to update the multi-link relation fields. Returns ONLY the fields that
 * would change — empty object if no diff. The caller decides whether to
 * write (avoiding no-op writes that would just stamp `local_updated_at`).
 *
 * Semantics: each relation field becomes UNION(prose-derived, existing). We
 * never remove a manual entry just because it isn't mentioned in prose.
 */
export function computeRelationPatch(
  narrative: Element,
  markdown: string,
  exists: LinkTargetExists,
): Partial<Element> {
  const linksByType = extractProseLinks(markdown);
  const patch: Partial<Element> = {};

  for (const [type, ids] of Object.entries(linksByType)) {
    const field = NARRATIVE_RELATION_FIELDS[type as ElementType];
    if (!field) continue;
    // Dynamic field access (field name is a string key). Element's index
    // signature returns `unknown`; cast through Record so we don't widen
    // to `any` — TS still catches misuse downstream.
    const existing = (narrative as Record<string, unknown>)[field];
    const existingArr: string[] = Array.isArray(existing) ? existing.filter(x => typeof x === 'string') : [];
    // Only LIVE targets are derived; an entry already in the field stays
    // (manual links are never removed here; the delete scrub owns that).
    const merged = unionPreserveOrder(existingArr, ids.filter(id => exists(type, id)));
    if (!arraysEqual(existingArr, merged)) {
      (patch as Record<string, unknown>)[field] = merged;
    }
  }

  return patch;
}

function unionPreserveOrder(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of existing) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of incoming) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
