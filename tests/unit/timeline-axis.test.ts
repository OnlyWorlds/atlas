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
      { id: 'a', elementType: 'event', name: 'A', startDate: 0, endDate: null, dateSpec: { kind: 'exact', value: 0 }, color: '#fff', links: [] },
      { id: 'b', elementType: 'event', name: 'B', startDate: 100, endDate: null, dateSpec: { kind: 'exact', value: 100 }, color: '#fff', links: [] },
    ]);
    // span 100, padding 2 → [-2, 102]
    expect(r.min).toBeCloseTo(-2, 5);
    expect(r.max).toBeCloseTo(102, 5);
  });

  it('calculateTimeRange handles endDate', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'narrative', name: 'A', startDate: 10, endDate: 200, dateSpec: { kind: 'exact', value: 10 }, color: '#fff', links: [] },
    ]);
    // min 10, max 200, span 190, padding 3.8
    expect(r.min).toBeCloseTo(10 - 3.8, 4);
    expect(r.max).toBeCloseTo(200 + 3.8, 4);
  });

  it('calculateTimeRange expands single-point range', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'event', name: 'A', startDate: 42, endDate: null, dateSpec: { kind: 'exact', value: 42 }, color: '#fff', links: [] },
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

  it('every emitted node carries dateSpec exact, with value === startDate (invariant)', () => {
    const nodes = extractTemporalNodes([
      { id: 'c1', type: 'character', name: 'A', local_updated_at: 'x', birth_date: 1200 } as Element & Record<string, unknown>,
    ]);
    expect(nodes[0].dateSpec).toEqual({ kind: 'exact', value: 1200 });
    expect(nodes[0].dateSpec.kind === 'exact' && nodes[0].dateSpec.value).toBe(nodes[0].startDate);
  });

  it('rejects non-finite + non-scalar dates (Infinity / arrays / booleans drop the node)', () => {
    const make = (v: unknown) =>
      extractTemporalNodes([{ id: 'e', type: 'event', name: 'E', local_updated_at: 'x', start_date: v } as Element & Record<string, unknown>]);
    expect(make(Infinity)).toHaveLength(0);
    expect(make([120])).toHaveLength(0);
    expect(make(true)).toHaveLength(0);
    expect(make('that winter')).toHaveLength(0);
    expect(make(120)).toHaveLength(1);
    expect(make('120')).toHaveLength(1);
  });
});

describe('timeline node links (the wedge data)', () => {
  it('resolves single + multi relation fields to clickable refs', () => {
    const elements: Element[] = [
      { id: 'loc', type: 'location', name: 'Highspire', local_updated_at: '2026-01-01' },
      { id: 'sp', type: 'species', name: 'Highborn', local_updated_at: '2026-01-01' },
      {
        id: 'c1', type: 'character', name: 'Lyra', local_updated_at: '2026-01-01',
        birth_date: 1180, birthplace: 'loc', species: ['sp'],
      } as Element & Record<string, unknown>,
    ];
    const nodes = extractTemporalNodes(elements);
    const lyra = nodes.find(n => n.id === 'c1')!;
    expect(lyra.links).toHaveLength(2);
    const byId = Object.fromEntries(lyra.links.map(l => [l.id, l]));
    expect(byId['loc']).toMatchObject({ type: 'location', name: 'Highspire', fieldLabel: 'Birthplace' });
    expect(byId['sp']).toMatchObject({ type: 'species', name: 'Highborn', fieldLabel: 'Species' });
  });

  it('skips self-links, missing targets, and dedupes', () => {
    const elements: Element[] = [
      {
        id: 'ev', type: 'event', name: 'Battle', local_updated_at: '2026-01-01',
        start_date: 1185, location: 'ghost', characters: ['ev', 'real', 'real'],
      } as Element & Record<string, unknown>,
      { id: 'real', type: 'character', name: 'Oren', local_updated_at: '2026-01-01' },
    ];
    const [node] = extractTemporalNodes(elements);
    // 'ghost' target missing, 'ev' is self, 'real' appears twice → only one ref
    expect(node.links).toHaveLength(1);
    expect(node.links[0]).toMatchObject({ id: 'real', name: 'Oren' });
  });

  it('gives a node with no relations an empty links array (graceful)', () => {
    const elements: Element[] = [
      { id: 'ev', type: 'event', name: 'Lone', local_updated_at: '2026-01-01', start_date: 5 } as Element & Record<string, unknown>,
    ];
    expect(extractTemporalNodes(elements)[0].links).toEqual([]);
  });
});
