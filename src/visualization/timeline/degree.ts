/**
 * Node significance via graph degree — the "anchor beats" foundation
 * (DESIGN_CHARTS.md "Chart #2 — The Landing", system B).
 *
 * Significance = how connected a node is within the DATED set. We count
 * bidirectional edges (a link A→B counts for both A and B) but ONLY to other
 * dated nodes, so an event wired to ten undated objects isn't a false hub —
 * the same dated-neighbourhood lesson the recipe learned (`datedNeighborCount`,
 * chart-recipe.ts). Pure + deterministic; computed ONCE over the full dated set
 * (in the normalizer) so a node's significance is STABLE across scope/zoom —
 * filtering to a subset never changes who the anchors are (gate risk: a degree
 * recomputed per-filtered-render would make anchors flicker).
 */

import type { TimelineNode } from './types';

/** A handful of always-labelled "anchor beats" — the top-N by degree (chart #2). */
export const ANCHOR_CAP = 7;

/** id → bidirectional dated-neighbour degree, over the passed node set. */
export function computeDegrees(nodes: TimelineNode[]): Map<string, number> {
  const dated = new Set(nodes.map(n => n.id));
  const degree = new Map<string, number>();
  for (const n of nodes) degree.set(n.id, 0);
  for (const n of nodes) {
    for (const link of n.links) {
      if (!dated.has(link.id)) continue;      // only edges between dated nodes
      degree.set(n.id, (degree.get(n.id) ?? 0) + 1);     // outgoing endpoint
      degree.set(link.id, (degree.get(link.id) ?? 0) + 1); // incoming endpoint
    }
  }
  return degree;
}

/**
 * The `cap` most-significant nodes — the always-labelled, larger "anchor beats".
 * Ranks by the node's pre-attached `degree` (global, stable), tie-broken by
 * earliest date then id so the anchor SET never reshuffles between renders
 * (focus is re-derived every render — a jumping anchor set would read as a bug).
 */
export function rankAnchors(nodes: TimelineNode[], cap: number): Set<string> {
  if (cap <= 0 || nodes.length === 0) return new Set();
  const sorted = [...nodes].sort((a, b) =>
    b.degree - a.degree ||
    a.startDate - b.startDate ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return new Set(sorted.slice(0, cap).map(n => n.id));
}
