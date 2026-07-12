/**
 * Chart scope engine (DESIGN_CHARTS.md "The default").
 *
 * A world's full temporal dump is never a useful default (that's the "wall").
 * `tableauScope` composes the opening view — cast, leads, one seat per type,
 * then weight-filled to the budget. No wizard: the auto-default IS the
 * welcome, the controls ARE the customization.
 *
 * Pure + deterministic (no Date/random; ties break by id) so it's trivially
 * testable and safe under the workflow runtime's resume rules.
 */

import type { ElementType } from '../../core/types';
import type { ChartScope, TimelineNode } from './types';

// (pickDefaultChart — the ordered-recipe engine — deleted S256: dead code
// since the tableau became the room default (S248/S251), and the home strip
// now runs the same tableauScope. Its dated-neighbourhood ranking lesson
// lives on in degree.ts's dated-bidirectional counting.)

/** Same weight the label budget uses: connectivity + how much is written. */
function nodeWeight(n: TimelineNode): number {
  return n.degree + Math.log10(1 + n.contentMass);
}

/**
 * The TABLEAU (Captain, 2026-07-10) — the world's default view when no type
 * filter is active: cast-centered essentials across categories, deliberately
 * not-crowded. Protagonist + nexus when set (and dated); otherwise the most
 * weighted character and location stand in; then the top-weighted nodes fill
 * across types (per-type cap so no single category floods it). Replaces the
 * old all-chips-off → whole-world-soup inversion. Deterministic.
 */
export function tableauScope(nodes: TimelineNode[], favoriteIds: string[]): ChartScope {
  const TOTAL_CAP = 22;
  const PER_TYPE_CAP = 4; // diversity-pass cap only — the overflow pass relaxes it (S256)
  const picked = new Set<string>();
  const typeCounts = new Map<string, number>();
  const take = (n: TimelineNode): void => {
    picked.add(n.id);
    typeCounts.set(n.elementType, (typeCounts.get(n.elementType) ?? 0) + 1);
  };
  const byWeight = (a: TimelineNode, b: TimelineNode): number =>
    nodeWeight(b) - nodeWeight(a) || (a.id < b.id ? -1 : 1);

  // 1. The cast — always in, never counted against the caps.
  for (const id of favoriteIds) {
    const n = nodes.find(x => x.id === id);
    if (n && !picked.has(n.id)) take(n);
  }
  // 2. A lead character + a lead location, when the cast doesn't cover them.
  for (const t of ['character', 'location'] as const) {
    if ([...picked].some(id => nodes.find(n => n.id === id)?.elementType === t)) continue;
    const best = nodes.filter(n => n.elementType === t).sort(byWeight)[0];
    if (best) take(best);
  }
  // 3. Type fairness (S256, charts lab fx-6: institutions got ZERO slots while
  //    peers held duplicates): every type present seats its best node before
  //    any type doubles up. Alphabetical type order for determinism.
  for (const t of [...new Set(nodes.map(n => n.elementType))].sort()) {
    if (picked.size >= TOTAL_CAP) break;
    if ((typeCounts.get(t) ?? 0) > 0) continue;
    const best = nodes.filter(n => n.elementType === t && !picked.has(n.id)).sort(byWeight)[0];
    if (best) take(best);
  }
  // 4. Essentials across categories: global weight order, per-type capped —
  //    diversity wins the early slots.
  const global = [...nodes].sort(byWeight);
  for (const n of global) {
    if (picked.size >= TOTAL_CAP) break;
    if (picked.has(n.id)) continue;
    if ((typeCounts.get(n.elementType) ?? 0) >= PER_TYPE_CAP) continue;
    take(n);
  }
  // 5. Overflow (S256, charts lab fx-4: 63 dated elements opened as SEVEN dots
  //    because the per-type cap strangled the dominant type): remaining slots
  //    fill by weight regardless of type. In a world that is mostly events,
  //    events ARE the world — TOTAL_CAP alone guards against the wall.
  for (const n of global) {
    if (picked.size >= TOTAL_CAP) break;
    if (!picked.has(n.id)) take(n);
  }
  return { kind: 'selection', elementIds: [...picked] };
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
