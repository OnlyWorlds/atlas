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

/**
 * Multi-link relation fields on Narrative (per SDK ELEMENT_SECTIONS.narrative
 * "Involves" section). One field per element type — atlas walks this map to
 * decide where each prose-derived UUID lands.
 */
export const NARRATIVE_RELATION_FIELDS: Record<ElementType, string | null> = {
  character: 'characters',
  location: 'locations',
  event: 'events',
  object: 'objects',
  species: 'species',
  creature: 'creatures',
  institution: 'institutions',
  trait: 'traits',
  collective: 'collectives',
  zone: 'zones',
  ability: 'abilities',
  phenomenon: 'phenomena',
  language: 'languages',
  family: 'families',
  relation: 'relations',
  title: 'titles',
  construct: 'constructs',
  law: 'laws',
  // Not relation targets from Narrative (no multi-link field):
  narrative: null,
  map: null,
  pin: null,
  marker: null,
};

const OW_LINK_RE = /ow:\/\/([a-z_]+)\/([\w-]+)/gi;

/**
 * Parse markdown for `ow://<type>/<uuid>` links and group UUIDs by element type.
 * Duplicates within the same type are deduped.
 */
export function extractProseLinks(markdown: string): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  let match: RegExpExecArray | null;
  OW_LINK_RE.lastIndex = 0;
  while ((match = OW_LINK_RE.exec(markdown)) !== null) {
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
): Partial<Element> {
  const linksByType = extractProseLinks(markdown);
  const patch: Partial<Element> = {};

  for (const [type, ids] of Object.entries(linksByType)) {
    const field = NARRATIVE_RELATION_FIELDS[type as ElementType];
    if (!field) continue;
    const existing = (narrative as any)[field];
    const existingArr: string[] = Array.isArray(existing) ? existing.filter(x => typeof x === 'string') : [];
    const merged = unionPreserveOrder(existingArr, ids);
    if (!arraysEqual(existingArr, merged)) {
      (patch as any)[field] = merged;
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
