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
  /** Grouping key for swimlanes (narrative id etc.) — used by the lanes bout. */
  laneKey?: string;
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
  render: '2d';
  style?: ChartStyle;
}
