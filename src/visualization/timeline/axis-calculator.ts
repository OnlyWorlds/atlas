/**
 * Time axis calculation — range, ticks, and date-to-pixel mapping.
 *
 * Adapted nearly verbatim from
 * `tools/little-element-viewer/src/timeline/axis-calculator.ts` (session 223).
 * Pure functions — easy to unit-test.
 */

import type { TimelineNode, TimeRange } from './types';

const PADDING_LEFT = 32;
const PADDING_RIGHT = 16;
const TIME_RANGE_PADDING = 0.02;
const TICK_TARGETS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
const IDEAL_TICK_PX = 100;

export function calculateTimeRange(nodes: TimelineNode[]): TimeRange {
  if (nodes.length === 0) return { min: 0, max: 100 };

  let min = Infinity;
  let max = -Infinity;

  for (const node of nodes) {
    if (node.startDate < min) min = node.startDate;
    if (node.startDate > max) max = node.startDate;
    if (node.endDate != null) {
      if (node.endDate < min) min = node.endDate;
      if (node.endDate > max) max = node.endDate;
    }
  }

  if (max <= min) max = min + 100;

  const span = max - min;
  const padding = span * TIME_RANGE_PADDING;

  return { min: min - padding, max: max + padding };
}

export function calculateTicks(range: TimeRange, canvasWidth: number): number[] {
  const span = range.max - range.min;
  const usableWidth = Math.max(1, canvasWidth - PADDING_LEFT - PADDING_RIGHT);
  const pxPerUnit = usableWidth / span;

  let bestInterval = TICK_TARGETS[TICK_TARGETS.length - 1];
  let bestDiff = Infinity;

  for (const target of TICK_TARGETS) {
    const tickPx = target * pxPerUnit;
    const diff = Math.abs(tickPx - IDEAL_TICK_PX);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestInterval = target;
    }
  }

  const firstTick = Math.ceil(range.min / bestInterval) * bestInterval;
  const ticks: number[] = [];
  for (let t = firstTick; t <= range.max; t += bestInterval) {
    ticks.push(t);
  }
  return ticks;
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
