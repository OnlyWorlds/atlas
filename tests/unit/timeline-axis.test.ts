/**
 * Timeline axis calculations — pure functions, easy to lock in.
 * Adapted from `tools/little-element-viewer/src/timeline/axis-calculator.ts`
 * (session 223). Verifies range padding, tick selection, and date→pixel mapping.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateTimeRange,
  calculateTicks,
  createDateToX,
} from '../../src/visualization/timeline/axis-calculator';
import { extractTemporalNodes } from '../../src/visualization/timeline/data-normalizer';
import type { Element } from '../../src/core/types';

describe('timeline axis-calculator', () => {
  it('calculateTimeRange returns defaults for empty input', () => {
    const r = calculateTimeRange([]);
    expect(r.min).toBe(0);
    expect(r.max).toBe(100);
  });

  it('calculateTimeRange pads min/max by 2%', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'event', name: 'A', startDate: 0, endDate: null, color: '#fff' },
      { id: 'b', elementType: 'event', name: 'B', startDate: 100, endDate: null, color: '#fff' },
    ]);
    // span 100, padding 2 → [-2, 102]
    expect(r.min).toBeCloseTo(-2, 5);
    expect(r.max).toBeCloseTo(102, 5);
  });

  it('calculateTimeRange handles endDate', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'narrative', name: 'A', startDate: 10, endDate: 200, color: '#fff' },
    ]);
    // min 10, max 200, span 190, padding 3.8
    expect(r.min).toBeCloseTo(10 - 3.8, 4);
    expect(r.max).toBeCloseTo(200 + 3.8, 4);
  });

  it('calculateTimeRange expands single-point range', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'event', name: 'A', startDate: 42, endDate: null, color: '#fff' },
    ]);
    // After max <= min fallback (max = min + 100) → padding kicks in too
    expect(r.max).toBeGreaterThan(r.min);
  });

  it('calculateTicks picks an interval matching ~100px tick spacing', () => {
    const range = { min: 0, max: 100 };
    const ticks = calculateTicks(range, 1000);
    // ~10 ticks expected at ~100px spacing — interval should be ~10
    expect(ticks.length).toBeGreaterThan(5);
    expect(ticks.length).toBeLessThan(20);
  });

  it('createDateToX maps min/max linearly to canvas usable width', () => {
    const dateToX = createDateToX({ min: 0, max: 100 }, 1000);
    const xMin = dateToX(0);
    const xMid = dateToX(50);
    const xMax = dateToX(100);
    // Linear interpolation: xMid should be roughly average of xMin and xMax
    expect((xMin + xMax) / 2).toBeCloseTo(xMid, 1);
  });

  it('createDateToX clamps when span is 0', () => {
    const dateToX = createDateToX({ min: 5, max: 5 }, 1000);
    const x = dateToX(5);
    expect(x).toBeGreaterThan(0); // PADDING_LEFT
  });
});

describe('timeline data-normalizer', () => {
  it('extracts character birth_date', () => {
    const elements: Element[] = [
      {
        id: 'c1',
        type: 'character',
        name: 'Alice',
        local_updated_at: '2026-01-01',
        birth_date: 1247,
      } as Element & { birth_date: number },
    ];
    const nodes = extractTemporalNodes(elements);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].startDate).toBe(1247);
    expect(nodes[0].endDate).toBeNull();
  });

  it('extracts narrative start_date + end_date', () => {
    const elements: Element[] = [
      {
        id: 'n1',
        type: 'narrative',
        name: 'Book 1',
        local_updated_at: '2026-01-01',
        start_date: 100,
        end_date: 200,
      } as Element & { start_date: number; end_date: number },
    ];
    const nodes = extractTemporalNodes(elements);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].startDate).toBe(100);
    expect(nodes[0].endDate).toBe(200);
  });

  it('skips elements without a date field', () => {
    const elements: Element[] = [
      { id: 'c1', type: 'character', name: 'Alice', local_updated_at: '2026-01-01' },
    ];
    expect(extractTemporalNodes(elements)).toHaveLength(0);
  });

  it('skips non-temporal types', () => {
    const elements: Element[] = [
      { id: 'm1', type: 'map', name: 'Map 1', local_updated_at: '2026-01-01' },
    ];
    expect(extractTemporalNodes(elements)).toHaveLength(0);
  });

  it('handles malformed dates by skipping them', () => {
    const elements: Element[] = [
      {
        id: 'c1', type: 'character', name: 'Alice', local_updated_at: '2026-01-01',
        birth_date: 'not a number',
      } as Element & { birth_date: string },
    ];
    expect(extractTemporalNodes(elements)).toHaveLength(0);
  });
});
