/**
 * Extract temporal data from atlas Elements into timeline-ready nodes.
 *
 * Atlas-specific adaptation of `tools/little-element-viewer/src/timeline/
 * data-normalizer.ts`. Differences:
 *   - Reads from atlas's `Element` shape (folder-store records), not the
 *     little-element-viewer's `ViewerElement`.
 *   - Color comes from a shared element-type color map; little-element-viewer
 *     had a per-type config object with more fields.
 *   - We don't extract narrative bars in v1 (deferred — see DESIGN_HOME.md).
 */

import { TEMPORAL_TYPE_FIELDS, parseTemporalValue } from './temporal-fields';
import type { LinkedRef, TimelineNode } from './types';
import type { Element, ElementType } from '../../core/types';
import { relationFieldsFor } from '../../editor/field-schema';
import { ELEMENT_TYPE_COLORS } from '../../core/constants';
import { computeDegrees } from './degree';

// Node colour is the ONE canonical per-type palette (`ELEMENT_TYPE_COLORS`),
// shared with pins, the static share renderer (chart-static.ts) and the rest of
// atlas. A former local map collapsed character/event/narrative all to one cyan
// (defeating type identity) AND disagreed with the published renderer (breaking
// "author preview ≡ served page"). One source: the room chart now matches both.
const FALLBACK_COLOR = '#94a3b8';

/** Humanise a relation field name into a chip label: "birthplace" → "Birthplace". */
function humanizeField(field: string): string {
  const bare = field.replace(/_ids$/, '').replace(/_id$/, '').replace(/_/g, ' ').trim();
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/**
 * Resolve every relation field on an element to the elements it points at —
 * the wedge graph read. Reads bare disk field names (content/zone/map store
 * relations un-suffixed); skips self-links, missing targets, and empties.
 */
function resolveLinks(el: Element, byId: Map<string, Element>): LinkedRef[] {
  const out: LinkedRef[] = [];
  const seen = new Set<string>();
  for (const rf of relationFieldsFor(el.type as ElementType)) {
    const raw = (el as Record<string, unknown>)[rf.diskField];
    if (raw == null || raw === '') continue;
    const ids = Array.isArray(raw) ? raw : [raw];
    const label = humanizeField(rf.schemaField);
    for (const v of ids) {
      const id = String(v);
      if (!id || id === el.id || seen.has(id)) continue;
      const target = byId.get(id);
      if (!target) continue;
      seen.add(id);
      out.push({ id, type: target.type, name: target.name || '(unnamed)', fieldLabel: label });
    }
  }
  return out;
}

/**
 * Convert atlas elements into timeline nodes. Only elements with a valid start
 * date become nodes. Optional end date is parsed when the type supports it.
 * Each node carries its resolved `links` (the elements it touches) — a pure
 * graph read, the heart of the timeline wedge.
 */
export function extractTemporalNodes(elements: Element[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  const byId = new Map<string, Element>(elements.map(e => [e.id, e]));

  for (const el of elements) {
    const fields = TEMPORAL_TYPE_FIELDS[el.type];
    if (!fields) continue;

    const startDate = parseTemporalValue((el as Record<string, unknown>)[fields.start]);
    if (startDate === null) continue;

    let endDate: number | null = null;
    if (fields.end) {
      endDate = parseTemporalValue((el as Record<string, unknown>)[fields.end]);
    }

    nodes.push({
      id: el.id,
      elementType: el.type,
      name: el.name || '(unnamed)',
      startDate,
      endDate,
      dateSpec: { kind: 'exact', value: startDate },
      color: ELEMENT_TYPE_COLORS[el.type as ElementType] ?? FALLBACK_COLOR,
      links: resolveLinks(el, byId),
      degree: 0, // filled below once every node exists (bidirectional read)
    });
  }

  // Significance = bidirectional dated-neighbour degree over the FULL dated set,
  // computed once so a node's anchor-rank is stable across scope/zoom (degree.ts).
  const degrees = computeDegrees(nodes);
  for (const n of nodes) n.degree = degrees.get(n.id) ?? 0;

  return nodes;
}
