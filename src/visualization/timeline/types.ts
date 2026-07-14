/**
 * Timeline / chart types — shapes for the compact home bar + the interactive
 * chart view. See DESIGN_CHARTS.md ("a chart is a saved, configurable,
 * shareable view of the world along chosen axes").
 *
 * Adapted from `tools/little-element-viewer/src/timeline/types.ts` (session 223).
 */

import type { ElementType } from '../../core/types';

/**
 * A resolved link from a timeline node to another element it touches —
 * the wedge data. Surfaced as a clickable chip in the node's card.
 */
export interface LinkedRef {
  id: string;
  type: string;
  name: string;
  /** Humanised relation-field label, e.g. "Birthplace", "Participants". */
  fieldLabel: string;
}

/**
 * The ORIGIN of a node's date — forward-proofing for fuzzy + relative dates
 * (Simmer's "felt time is the default" + tagged-union-from-the-start insurance).
 * Renderers read the resolved numeric `startDate` today; `dateSpec` lets later
 * bouts draw fuzzy as a soft band and resolve relative ("3 days after the
 * siege") at render. `exact` is the only kind chart #1 emits.
 */
/** Calendar granularity — shared by fuzzy precision and relative offset unit. */
export type DatePrecision = 'day' | 'week' | 'month' | 'season' | 'year';

export type DateSpec =
  | { kind: 'exact'; value: number }
  | { kind: 'fuzzy'; around: number; precision: DatePrecision }
  | { kind: 'relative'; anchorId: string; offset: number; unit: DatePrecision };

export interface TimelineNode {
  id: string;
  elementType: string;
  name: string;
  /** RESOLVED position for rendering (from dateSpec). */
  startDate: number;
  endDate: number | null;
  color: string;
  /**
   * The origin of the date — REQUIRED (the normalizer always populates it,
   * {kind:'exact'} today). Required (not optional) so the compiler enforces the
   * invariant the fuzzy/relative bouts will rely on (gate finding: optional was
   * a trap). `dateSpec` is a derived cache of the resolved value, NOT the raw
   * textual source — fuzzy parsing re-reads the element field (see DESIGN_CHARTS).
   */
  dateSpec: DateSpec;
  /**
   * Elements this node links to (via its relation fields). A pure graph read
   * — never stored. Empty when the element has no resolved relations. This is
   * the wedge: every competitor caps an event at one link; we surface them all.
   */
  links: LinkedRef[];
  /**
   * Bidirectional dated-neighbour graph degree — significance for "anchor
   * beats" (chart #2). Computed once over the full dated set by the normalizer
   * (see degree.ts); travels with the node through scope/zoom so significance is
   * stable. A pure render cache, never serialized.
   */
  degree: number;
  /**
   * Content mass — raw character count of the element's long-form text
   * (description + narrative story prose). Second input to the S4 label
   * weight (degree + content mass + favorites): an element someone wrote
   * three paragraphs about matters more than a bare-named stub at equal
   * degree. A pure render cache like `degree`, never serialized; the weight
   * function applies its own scaling (log), so this stays a raw count.
   */
  contentMass: number;
  /**
   * Short description excerpt for the docked card (S7 content budget). The
   * view is store-free, so the text travels with the node. Absent when the
   * element has no description.
   */
  snippet?: string;
  /** Grouping key for swimlanes (narrative id etc.) — used by the lanes bout. */
  laneKey?: string;
  /**
   * Open-end semantics (Act 2A): the type records spans and this node has a
   * start but NO recorded end — the span is still running (a held title). The
   * renderer resolves the effective end against the live now at draw time
   * (`effectiveEndDate`); this flag is type truth, not a resolved date.
   */
  openEnded?: boolean;
}

export interface PlacedDot {
  node: TimelineNode;
  x: number;
  y: number;
  radius: number;
}

export interface TimeRange {
  min: number;
  max: number;
}

// ===========================================================================
// Chart config — the saved/shareable contract (DESIGN_CHARTS.md). A chart is a
// view of the world along chosen axes; this object is what gets stored in
// `.atlas/charts.json` and published as a share block, so its shape must be
// extensible (new axes / render modes / scope kinds add, never break).
// ===========================================================================

/** Which elements a chart shows. */
export type ChartScope =
  | { kind: 'all' }
  | { kind: 'types'; types: ElementType[] }
  | { kind: 'focus'; elementId: string }
  | { kind: 'selection'; elementIds: string[] };

/**
 * The primary axis + its axis-specific settings, as a TAGGED UNION (gate
 * finding: `direction` is time-only and must not be a flat top-level field, or
 * map-charts/other-axes force a breaking reshape of stored configs). Time-only
 * fields (direction, window, future now-lines) live under the 'time' arm;
 * a future 'space' arm carries `mapId` etc. Readers MUST treat an unknown
 * axis kind as a graceful fallback (the `show` viewer is separately versioned).
 */
export type ChartAxis =
  | { kind: 'time'; direction: 'past' | 'future' | 'both'; window?: TimeRange };
  // future: | { kind: 'space'; mapId: string; … }

export interface ChartStyle {
  accent?: string;
}

/**
 * The saved/shareable contract. Persisted to `.atlas/charts.json` AND published
 * as a share block, so it carries `schema_version` like every sibling wire
 * shape (PagePayload.schema_version) — added NOW, before any chart JSON exists,
 * so later additive fields are version-disambiguable on read (gate finding:
 * the migration risk lives HERE, not in the recomputed TimelineNode).
 */
export interface ChartConfig {
  schema_version: 1;
  id: string;
  name: string;
  axis: ChartAxis;
  scope: ChartScope;
  /** How the chart draws: the pannable canvas or the scrolling document
   *  (2C, S13). Widened additively — older readers never inspect this field
   *  (verified: charts-store + freeze don't read it), and an unknown value
   *  falls back to '2d' at apply time. */
  render: '2d' | 'scroll';
  style?: ChartStyle;
  /**
   * The calendar LENS this chart was saved under (2B): a calendar Construct's
   * element id. Additive + optional — older readers ignore it, and a dangling
   * or malformed reference degrades to bare numbers (design §3). Covered by
   * rewriteChartScopeIds on id-swap like the scope ids.
   */
  calendarId?: string;
}
