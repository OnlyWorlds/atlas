/**
 * Time axis calculation — range, ticks, and date-to-pixel mapping.
 *
 * Adapted nearly verbatim from
 * `tools/little-element-viewer/src/timeline/axis-calculator.ts`.
 * Pure functions — easy to unit-test.
 */

import type { TimelineNode, TimeRange } from './types';

const PADDING_LEFT = 32;
const PADDING_RIGHT = 16;
const TIME_RANGE_PADDING = 0.02;
/** Half-width of the window drawn around a zero-span range (see below). */
const ZERO_SPAN_HALF_WINDOW = 50;
/** Nice-interval mantissas: the ladder is 1, 2, 5 x 10^k, unbounded above
 *  (it used to stop at 2000, so wide spans drew a tick wall). */
const TICK_MANTISSAS = [1, 2, 5];
const IDEAL_TICK_PX = 100;
/** Hard cap on ticks computed per redraw (the axis redraws on every mousemove). */
export const MAX_AXIS_TICKS = 200;

export function calculateTimeRange(nodes: TimelineNode[]): TimeRange {
  if (nodes.length === 0) return { min: 0, max: 100 };

  let min = Infinity;
  let max = -Infinity;

  for (const node of nodes) {
    // Guard non-finite regardless of source (a future unresolved relative date
    // could inject NaN; never let it poison the axis scale). Gate finding.
    if (Number.isFinite(node.startDate)) {
      if (node.startDate < min) min = node.startDate;
      if (node.startDate > max) max = node.startDate;
    }
    if (node.endDate != null && Number.isFinite(node.endDate)) {
      if (node.endDate < min) min = node.endDate;
      if (node.endDate > max) max = node.endDate;
    }
  }

  // All nodes non-finite (or none) → safe default range.
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 100 };
  // ZERO-SPAN (one dated element, or several sharing one date): CENTER it.
  //
  // This used to read `max = min + 100`, which with the 2% padding put the
  // only dot at ~1.9% across — jammed against the left edge with the whole
  // width empty to its right. Every young world hits this: the moment
  // you date your first element the chart looks broken, and the guided tour
  // builds a chart up one element at a time, so it would hit it twice before
  // anything read correctly. A zero-span range has no information about
  // direction, so the honest rendering puts the moment in the middle and
  // shows equal time either side of it.
  if (max <= min) {
    const half = ZERO_SPAN_HALF_WINDOW;
    return { min: min - half, max: min + half };
  }

  const span = max - min;
  const padding = span * TIME_RANGE_PADDING;

  return { min: min - padding, max: max + padding };
}

export function calculateTicks(range: TimeRange, canvasWidth: number): number[] {
  const span = range.max - range.min;
  const usableWidth = Math.max(1, canvasWidth - PADDING_LEFT - PADDING_RIGHT);
  if (!(span > 0) || !Number.isFinite(span)) return [];
  const pxPerUnit = usableWidth / span;

  // Pick the ladder rung whose spacing lands nearest IDEAL_TICK_PX: search the
  // decades either side of the ideal raw interval (never below 1).
  const ideal = IDEAL_TICK_PX / pxPerUnit;
  const decade = Math.max(0, Math.floor(Math.log10(Math.max(1, ideal))));
  let bestInterval = 1;
  let bestDiff = Infinity;
  for (let k = Math.max(0, decade - 1); k <= decade + 1; k++) {
    for (const m of TICK_MANTISSAS) {
      const interval = m * Math.pow(10, k);
      const diff = Math.abs(interval * pxPerUnit - IDEAL_TICK_PX);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestInterval = interval;
      }
    }
  }
  // Hard cap: step up the ladder rather than truncate, so ticks always
  // spread across the whole visible range.
  while (span / bestInterval > MAX_AXIS_TICKS) bestInterval = nextNiceInterval(bestInterval);

  const firstTick = Math.ceil(range.min / bestInterval) * bestInterval;
  const ticks: number[] = [];
  for (let i = 0; i <= MAX_AXIS_TICKS; i++) {
    const t = firstTick + i * bestInterval;
    if (t > range.max) break;
    ticks.push(t);
  }
  return ticks;
}

/** The next rung up the 1, 2, 5 x 10^k ladder. */
function nextNiceInterval(interval: number): number {
  const k = Math.floor(Math.log10(interval));
  const base = Math.pow(10, k);
  const m = Math.round(interval / base);
  if (m < 2) return 2 * base;
  if (m < 5) return 5 * base;
  return 10 * base;
}

export function createDateToX(range: TimeRange, canvasWidth: number): (date: number) => number {
  const usableWidth = canvasWidth - PADDING_LEFT - PADDING_RIGHT;
  const span = range.max - range.min;

  return (date: number): number => {
    if (span === 0) return PADDING_LEFT;
    const ratio = (date - range.min) / span;
    return PADDING_LEFT + ratio * usableWidth;
  };
}

/**
 * Inverse of `createDateToX` — the ONE place the padded x→date math lives.
 * The view layer used to hold its own unpadded `(x / w) * span` twin, which
 * drew the now-line (and read drag/hover dates) PADDING_RIGHT px away from
 * where the same date's node renders — the old "now not on the events" gap.
 * Paired functions share code, never parallel constants.
 */
export function createXToDate(range: TimeRange, canvasWidth: number): (x: number) => number {
  const usableWidth = Math.max(1, canvasWidth - PADDING_LEFT - PADDING_RIGHT);
  const span = range.max - range.min;

  return (x: number): number => {
    if (span === 0) return range.min;
    return range.min + ((x - PADDING_LEFT) / usableWidth) * span;
  };
}
