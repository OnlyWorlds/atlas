/**
 * Default-chart recipe engine (DESIGN_CHARTS.md "The default").
 *
 * A world's full temporal dump is never a useful default (that's the "wall").
 * `pickDefaultChart` runs an ORDERED recipe list and returns the first that
 * fits — a focused opening view the user can immediately re-scope. No wizard:
 * the auto-default IS the welcome, the controls ARE the customization.
 *
 * Pure + deterministic (no Date/random; ties break by element order) so it's
 * trivially testable and safe under the workflow runtime's resume rules.
 */

import type { Element, ElementType } from '../../core/types';
import type { ChartConfig, ChartScope, TimelineNode } from './types';
import { TEMPORAL_TYPE_FIELDS, parseTemporalValue } from './temporal-fields';
import { relationFieldsFor } from '../../editor/field-schema';

/** Does this element carry a resolvable numeric start date for its type? */
function hasStartDate(el: Element): boolean {
  const fields = TEMPORAL_TYPE_FIELDS[el.type];
  if (!fields) return false;
  return parseTemporalValue((el as Record<string, unknown>)[fields.start]) !== null;
}

/** The set of element ids this element points AT via any relation field. */
function forwardLinkIds(el: Element): Set<string> {
  const out = new Set<string>();
  for (const rf of relationFieldsFor(el.type as ElementType)) {
    const raw = (el as Record<string, unknown>)[rf.diskField];
    if (raw == null || raw === '') continue;
    const ids = Array.isArray(raw) ? raw : [raw];
    for (const v of ids) out.add(String(v));
  }
  return out;
}

/**
 * Count DATED elements in `id`'s neighbourhood (both directions). This is the
 * ranking metric for the character-life recipe: it must agree with what the
 * focus chart actually RENDERS (dated nodes only). Ranking by total degree
 * (including undated referrers) made "Character life" collapse to a single dot
 * — gate finding. A character with zero dated neighbours scores 0 and the
 * recipe falls through rather than emit a lone-dot focus.
 */
function datedNeighborCount(id: string, elements: Element[]): number {
  const self = elements.find(e => e.id === id);
  const forward = self ? forwardLinkIds(self) : new Set<string>();
  let count = 0;
  for (const el of elements) {
    if (el.id === id || !hasStartDate(el)) continue;
    if (forward.has(el.id) || forwardLinkIds(el).has(id)) count++;
  }
  return count;
}

/**
 * Pick the opening chart for a world. Ordered recipes, first fit wins:
 *   1. Writing spine  — a narrative tree (parent_narrative) + dated content → narratives + events
 *   2. Story events   — dated events → events
 *   3. Character life — most-linked dated character → focus on it
 *   4. Deep time      — dated locations/institutions → those
 *   5. Fallback       — everything temporal (may render empty → honest CTA)
 */
export function pickDefaultChart(elements: Element[]): ChartConfig {
  const base = {
    schema_version: 1 as const,
    id: 'default',
    axis: { kind: 'time' as const, direction: 'both' as const },
    render: '2d' as const,
  };

  const datedEvents = elements.filter(e => e.type === 'event' && hasStartDate(e));
  const narratives = elements.filter(e => e.type === 'narrative');
  const datedNarratives = narratives.filter(hasStartDate);
  const hasNarrativeTree = narratives.some(
    n => typeof (n as Record<string, unknown>).parent_narrative === 'string'
      && (n as Record<string, unknown>).parent_narrative !== '',
  );

  // 1. Writing spine — a real narrative structure with some dated content.
  if (hasNarrativeTree && (datedNarratives.length + datedEvents.length) > 0) {
    return { ...base, name: 'Story', scope: { kind: 'types', types: ['narrative', 'event'] } };
  }

  // 2. Story events.
  if (datedEvents.length > 0) {
    return { ...base, name: 'Events', scope: { kind: 'types', types: ['event'] } };
  }

  // 3. Character life — the dated character with the largest DATED neighbourhood
  //    (so the focus chart is guaranteed to render >1 node). A dated character
  //    with no dated neighbours scores 0 and falls through (a lone-dot focus is
  //    worse than the next recipe). Ties keep the earlier character (strict >).
  const datedChars = elements.filter(e => e.type === 'character' && hasStartDate(e));
  if (datedChars.length > 0) {
    let best: Element | null = null;
    let bestN = 0;
    for (const c of datedChars) {
      const n = datedNeighborCount(c.id, elements);
      if (n > bestN) { best = c; bestN = n; }
    }
    if (best) {
      return { ...base, name: best.name || 'Character', scope: { kind: 'focus', elementId: best.id } };
    }
    // else: no dated character has a dated neighbour → fall through.
  }

  // 4. Deep time — foundings.
  const datedPlaces = elements.filter(
    e => (e.type === 'location' || e.type === 'institution') && hasStartDate(e),
  );
  if (datedPlaces.length > 0) {
    return { ...base, name: 'Foundings', scope: { kind: 'types', types: ['location', 'institution'] } };
  }

  // 5. Fallback — everything temporal (honest empty state if nothing has a date).
  return { ...base, name: 'Everything', scope: { kind: 'all' } };
}

/**
 * S5 protagonist-first — step 0 of the default view. Returns the OPENING
 * WINDOW (world-date units) centered on the protagonist's dated neighbourhood,
 * or null when there's nothing to center on (caller falls through to the
 * plain recipe fit). Deliberately a WINDOW, not an auto-focus URL: the landing
 * keeps its broad orient job, it just lands you AT the protagonist's era.
 *
 * Protagonist = the explicit favorite when set; else the dated character with
 * the largest dated neighbourhood (same inference the character-life recipe
 * uses). An undated explicit protagonist still works via its dated
 * neighbourhood (reverse links). Skips (null) when the neighbourhood span is
 * most of the universe anyway — a window that shows everything orients nothing.
 */
export function protagonistWindow(
  nodes: TimelineNode[],
  explicitProtagonistId: string | null,
): { start: number; end: number } | null {
  if (nodes.length === 0) return null;
  let pid = explicitProtagonistId;
  if (!pid) {
    // Infer: the character with the largest DATED neighbourhood. Characters
    // are usually UNDATED (no birth_date → no node), so counting only dated
    // character nodes misses the actual protagonist — tally every character
    // the dated set touches via its resolved links instead, plus the dated
    // character nodes' own degrees. Ties keep the first-seen (deterministic).
    const tally = new Map<string, number>();
    for (const n of nodes) {
      if (n.elementType === 'character') tally.set(n.id, (tally.get(n.id) ?? 0) + n.degree);
      for (const l of n.links) {
        if (l.type === 'character') tally.set(l.id, (tally.get(l.id) ?? 0) + 1);
      }
    }
    let bestId: string | null = null;
    let bestN = 0;
    for (const [id, count] of tally) {
      if (count > bestN) { bestId = id; bestN = count; }
    }
    // A one-event neighbourhood orients nothing — fall through to the plain fit.
    if (!bestId || bestN < 2) return null;
    pid = bestId;
  }

  // The neighbourhood's dates: the protagonist's own span + every dated node
  // it links to or that links to it (both directions, resolved node links).
  const self = nodes.find(n => n.id === pid);
  const dates: number[] = [];
  if (self) {
    dates.push(self.startDate);
    if (self.endDate != null) dates.push(self.endDate);
    for (const l of self.links) {
      const t = nodes.find(n => n.id === l.id);
      if (t) { dates.push(t.startDate); if (t.endDate != null) dates.push(t.endDate); }
    }
  }
  for (const n of nodes) {
    if (n.id === pid) continue;
    if (n.links.some(l => l.id === pid)) {
      dates.push(n.startDate);
      if (n.endDate != null) dates.push(n.endDate);
    }
  }
  if (dates.length === 0) return null;

  const uniMin = Math.min(...nodes.map(n => n.startDate));
  const uniMax = Math.max(...nodes.map(n => Math.max(n.startDate, n.endDate ?? n.startDate)));
  const uniSpan = Math.max(1e-9, uniMax - uniMin);
  // The protagonist's ERA is the DENSEST cluster of their neighbourhood, not
  // its min-max envelope — a single early chronicle or a birth date far from
  // the story's mass would otherwise stretch the window across most of history
  // (live finding: The Crumbler's envelope was 50..458 because of one year-50
  // reference; his story lives at 447..458). Smallest window covering ~75% of
  // the neighbourhood's dates, by sliding over the sorted list.
  dates.sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil(dates.length * 0.75));
  let bestStart = 0;
  let bestSpan = Infinity;
  for (let i = 0; i + k - 1 < dates.length; i++) {
    const s = dates[i + k - 1] - dates[i];
    if (s < bestSpan) { bestSpan = s; bestStart = i; }
  }
  const min = dates[bestStart];
  const max = dates[bestStart + k - 1];
  const span = max - min;
  // Even the dense window ≈ the whole universe → the window adds nothing.
  if (span / uniSpan > 0.8) return null;
  const pad = Math.max(span * 0.15, uniSpan * 0.02);
  return { start: min - pad, end: max + pad };
}

/**
 * The effective chart scope from the URL focus + the broad-view type filter
 * (chart #2 nav model). FOCUS (a `/timeline/<id>` in the URL) wins — it's the
 * dominant lens; otherwise the broad-view type filter; otherwise all. Pure, so
 * the "focus wins, else types, else all" rule is regression-locked independent
 * of the room's wiring.
 */
export function scopeFromFocus(
  focusId: string | null,
  typeFilter: ReadonlySet<ElementType> | null,
): ChartScope {
  if (focusId) return { kind: 'focus', elementId: focusId };
  if (typeFilter && typeFilter.size > 0) return { kind: 'types', types: [...typeFilter] };
  return { kind: 'all' };
}

/**
 * Filter timeline nodes down to a chart's scope — pure, operates on the
 * already-normalized node set (so it reads each node's resolved `links`).
 *   - all       → every node
 *   - types     → nodes whose element type is in the list
 *   - selection → nodes whose id is hand-picked
 *   - focus     → the focused node + every node linked to/from it (the
 *                 temporal neighborhood, both directions, via node.links)
 */
export function filterNodesByScope(nodes: TimelineNode[], scope: ChartScope): TimelineNode[] {
  switch (scope.kind) {
    case 'all':
      return nodes;
    case 'types': {
      const set = new Set<string>(scope.types);
      return nodes.filter(n => set.has(n.elementType));
    }
    case 'selection': {
      const set = new Set(scope.elementIds);
      return nodes.filter(n => set.has(n.id));
    }
    case 'focus': {
      const focusId = scope.elementId;
      const focusNode = nodes.find(n => n.id === focusId);
      const forward = new Set<string>(focusNode ? focusNode.links.map(l => l.id) : []);
      // Includes the focus node itself when it's dated, plus every node linked
      // to/from it. When the focus element has no node (undated/deleted), this
      // still surfaces its dated neighbourhood via incoming links — and an
      // empty result is an honest empty state, not a crash.
      return nodes.filter(n =>
        n.id === focusId
        || forward.has(n.id)
        || n.links.some(l => l.id === focusId),
      );
    }
    default: {
      // Unknown scope kind from a newer atlas / corrupt charts.json / a future
      // share block: fail SAFE to empty (an honest empty state), never dump the
      // entire world — that's the dense "wall" this feature exists to prevent.
      // Gate finding.
      const unknown = (scope as { kind?: string }).kind;
      if (unknown !== undefined) {
        console.warn(`[chart] unknown scope kind "${unknown}" — rendering empty (forward-compat fallback)`);
      }
      return [];
    }
  }
}
