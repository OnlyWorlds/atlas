/**
 * Freeze a saved chart into the share payload (DESIGN_CHARTS.md "a chart is a
 * block"). A chart block references a chart in `.atlas/charts.json` by id; at
 * publish it FREEZES into a self-contained snapshot the store-free `show`
 * viewer renders with zero fetches — resolved nodes (identity only) + axis
 * bounds.
 *
 * ## Disclosure
 * The chart's SCOPE is the disclosure boundary: every in-scope node discloses
 * name + type + date (the author chose to chart them — exactly like collection
 * members or map pins by name). A node carries a `ref` ONLY when its element is
 * ALSO carded on the page. No deep fields, no links — a chart is a temporal
 * index, not a profile leak.
 *
 * ## Scope is a live RULE, re-snapshot on republish (CONFIRMED — same as share blocks)
 * Unlike the map block (a frozen explicit pin INCLUDE-list), a chart's scope is
 * a RULE resolved against the LIVE elements at every publish/republish: a
 * `types`/`all` chart re-snapshots current membership (an element added later
 * JOINS a republished chart), and a `focus` chart discloses the focus element's
 * whole dated neighbourhood. **Captain confirmed (Bout 3): freeze-at-publish +
 * re-snapshot-on-republish IS the intended model — exactly how every share block
 * updates (publish = snapshot now; republish = refresh to current state),
 * consistent with the circle block.** Authors should still know republish can
 * GROW the disclosed set; that's the trade for "a timeline of all events"
 * meaning the *current* events.
 *
 * Pure module (no DOM/store). The renderer (`chart-static.ts`) draws this same
 * shape, so the builder preview and the public viewer render one look from two
 * sources. Versioned via PagePayload.schema_version — the viewer treats an
 * unknown chart shape as a graceful skip.
 */

import type { Element } from '../../core/types';
import type { ChartConfig } from './types';
import { extractTemporalNodes } from './data-normalizer';
import { filterNodesByScope } from './chart-recipe';
import { rankAnchors, ANCHOR_CAP } from './degree';

/** One node in a frozen chart — identity + axis position only. */
export interface PayloadChartNode {
  type: string;
  name: string;
  /**
   * Resolved start position on the time axis. Deliberately exact-resolved:
   * fuzzy/relative dates publish their resolved midpoint, and a future soft-band
   * render adds an OPTIONAL field (additive — old viewers ignore it), never a
   * reshape of `date` (the chart#1 axis flat-vs-tagged lesson). Gate-noted.
   */
  date: number;
  /** Range end, when the element carries one and it's after `date`. */
  endDate?: number;
  /** Top-N by significance — rendered larger + always-labelled. */
  anchor?: boolean;
  /** Present ONLY when the element is also carded on the page (click-through). */
  ref?: string;
}

/** The payload form of a chart block — frozen at build, self-contained. */
export interface PayloadChartBlock {
  id: string;
  kind: 'chart';
  /** The chart's name at publish time. */
  title: string;
  axisMin: number;
  axisMax: number;
  nodes: PayloadChartNode[];
}

/**
 * Freeze a chart block: resolve `chartId` against the saved charts + the world
 * elements into a frozen node snapshot. Returns null — the block drops from the
 * wire — when the chart id is dangling (discloses nothing). An empty in-scope
 * set yields an honest empty chart (a bare axis), never a crash.
 *
 * `includedIds` is the page's disclosed (carded/collection/pinned) set; a node
 * gets a click-through `ref` only when its element is in it.
 */
export function freezeChartBlock(
  chartId: string,
  blockId: string,
  charts: ChartConfig[],
  elements: Element[],
  includedIds: ReadonlySet<string>,
): PayloadChartBlock | null {
  const chart = charts.find(c => c.id === chartId);
  if (!chart) return null;

  const nodes = filterNodesByScope(extractTemporalNodes(elements), chart.scope);
  const anchors = rankAnchors(nodes, ANCHOR_CAP);

  const frozen: PayloadChartNode[] = nodes
    .slice()
    .sort((a, b) => a.startDate - b.startDate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map(n => {
      const node: PayloadChartNode = { type: n.elementType, name: n.name || '(unnamed)', date: n.startDate };
      if (n.endDate != null && n.endDate > n.startDate) node.endDate = n.endDate;
      if (anchors.has(n.id)) node.anchor = true;
      if (includedIds.has(n.id)) node.ref = n.id;
      return node;
    });

  let axisMin = Infinity;
  let axisMax = -Infinity;
  for (const n of frozen) {
    if (n.date < axisMin) axisMin = n.date;
    const hi = n.endDate ?? n.date;
    if (hi > axisMax) axisMax = hi;
  }
  if (!Number.isFinite(axisMin)) { axisMin = 0; axisMax = 0; }

  return { id: blockId, kind: 'chart', title: chart.name || '(untitled chart)', axisMin, axisMax, nodes: frozen };
}
