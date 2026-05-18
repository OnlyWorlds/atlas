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

import { TEMPORAL_TYPE_FIELDS } from './temporal-fields';
import type { TimelineNode } from './types';
import type { Element } from '../../core/types';

/** Element type → dot color. Falls back to muted text if unknown. */
const TYPE_COLOR: Record<string, string> = {
  character:   '#22d3ee', // cyan
  creature:    '#a78bfa', // violet
  species:     '#a78bfa',
  family:      '#fbbf24', // amber
  collective:  '#fbbf24',
  institution: '#f97316', // orange
  location:    '#34d399', // emerald
  object:      '#94a3b8', // slate
  construct:   '#94a3b8',
  ability:     '#ec4899', // pink
  trait:       '#ec4899',
  title:       '#fbbf24',
  language:    '#a78bfa',
  law:         '#f87171', // red
  event:       '#22d3ee',
  narrative:   '#22d3ee',
  phenomenon:  '#a78bfa',
  relation:    '#94a3b8',
  zone:        '#34d399',
};

const FALLBACK_COLOR = '#94a3b8';

/**
 * Convert atlas elements into timeline nodes. Only elements with a valid start
 * date become nodes. Optional end date is parsed when the type supports it.
 */
export function extractTemporalNodes(elements: Element[]): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  for (const el of elements) {
    const fields = TEMPORAL_TYPE_FIELDS[el.type];
    if (!fields) continue;

    const rawStart = (el as Element & Record<string, unknown>)[fields.start];
    if (rawStart == null || rawStart === '') continue;

    const startDate = Number(rawStart);
    if (Number.isNaN(startDate)) continue;

    let endDate: number | null = null;
    if (fields.end) {
      const rawEnd = (el as Element & Record<string, unknown>)[fields.end];
      if (rawEnd != null && rawEnd !== '') {
        const parsed = Number(rawEnd);
        if (!Number.isNaN(parsed)) endDate = parsed;
      }
    }

    nodes.push({
      id: el.id,
      elementType: el.type,
      name: el.name || '(unnamed)',
      startDate,
      endDate,
      color: TYPE_COLOR[el.type] ?? FALLBACK_COLOR,
    });
  }

  return nodes;
}
