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
  createXToDate,
} from '../../src/visualization/timeline/axis-calculator';
import { suggestNow } from '../../src/middle/timeline';
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
      { id: 'a', elementType: 'event', name: 'A', startDate: 0, endDate: null, dateSpec: { kind: 'exact', value: 0 }, color: '#fff', links: [], degree: 0, contentMass: 0 },
      { id: 'b', elementType: 'event', name: 'B', startDate: 100, endDate: null, dateSpec: { kind: 'exact', value: 100 }, color: '#fff', links: [], degree: 0, contentMass: 0 },
    ]);
    // span 100, padding 2 → [-2, 102]
    expect(r.min).toBeCloseTo(-2, 5);
    expect(r.max).toBeCloseTo(102, 5);
  });

  it('calculateTimeRange handles endDate', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'narrative', name: 'A', startDate: 10, endDate: 200, dateSpec: { kind: 'exact', value: 10 }, color: '#fff', links: [], degree: 0, contentMass: 0 },
    ]);
    // min 10, max 200, span 190, padding 3.8
    expect(r.min).toBeCloseTo(10 - 3.8, 4);
    expect(r.max).toBeCloseTo(200 + 3.8, 4);
  });

  it('calculateTimeRange CENTERS a single dated element (S301)', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'event', name: 'A', startDate: 42, endDate: null, dateSpec: { kind: 'exact', value: 42 }, color: '#fff', links: [], degree: 0, contentMass: 0 },
    ]);
    // The old rule (max = min + 100, then 2% padding) put the only dot at
    // ~1.9% across — jammed against the left edge. This test asserted only
    // `max > min`, which is exactly the kind of wide assertion that
    // accommodates a bug. The contract now is: a zero-span range has no
    // direction, so the moment sits in the MIDDLE.
    expect(r.min).toBe(42 - 50);
    expect(r.max).toBe(42 + 50);
    expect((r.min + r.max) / 2).toBe(42);
  });

  it('calculateTimeRange centers several elements sharing ONE date', () => {
    // The guided tour's charts act deliberately puts two events at the same
    // moment before a third pulls the axis open; they must not stack in a
    // corner while it does.
    const at = (id: string) => ({
      id, elementType: 'event' as const, name: id, startDate: 7, endDate: null,
      dateSpec: { kind: 'exact' as const, value: 7 }, color: '#fff', links: [], degree: 0, contentMass: 0,
    });
    const r = calculateTimeRange([at('a'), at('b')]);
    expect((r.min + r.max) / 2).toBe(7);
    expect(r.max - r.min).toBe(100);
  });

  it('a real span is unaffected by the zero-span rule', () => {
    const r = calculateTimeRange([
      { id: 'a', elementType: 'event', name: 'A', startDate: 10, endDate: null, dateSpec: { kind: 'exact', value: 10 }, color: '#fff', links: [], degree: 0, contentMass: 0 },
      { id: 'b', elementType: 'event', name: 'B', startDate: 12, endDate: null, dateSpec: { kind: 'exact', value: 12 }, color: '#fff', links: [], degree: 0, contentMass: 0 },
    ]);
    // span 2, padding 0.04 → the tour's current event pair, untouched.
    expect(r.min).toBeCloseTo(9.96, 5);
    expect(r.max).toBeCloseTo(12.04, 5);
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

  it('createXToDate is the exact inverse of createDateToX (S318 — one padded space)', () => {
    // The view layer used to hold an UNPADDED x↔date twin, so the now-line
    // (drawn via date→x) landed PADDING_RIGHT px right of the node rendered
    // at the same date. The round-trip through the shared pair must be
    // identity — that property fails against any parallel-constants twin.
    const range = { min: -270, max: 12.04 };
    const w = 937;
    const toX = createDateToX(range, w);
    const toDate = createXToDate(range, w);
    for (const d of [-270, -251, 0, 1, 12, 12.04]) {
      expect(toDate(toX(d))).toBeCloseTo(d, 9);
    }
    for (const x of [32, 100, 500, w - 16]) {
      expect(toX(toDate(x))).toBeCloseTo(x, 9);
    }
  });
});

describe('suggestNow — the set-now default (S318)', () => {
  const node = (startDate: number, endDate: number | null = null) => ({ startDate, endDate });

  it('defaults to the LATEST start date (the tour: title 1, events 12+12 → 12)', () => {
    expect(suggestNow([node(1), node(12), node(12)])).toBe(12);
  });

  it('a recorded end date later than any start defines the present', () => {
    expect(suggestNow([node(1, 20), node(12)])).toBe(20);
  });

  it('open ends (null) do not count', () => {
    expect(suggestNow([node(3, null), node(7)])).toBe(7);
  });

  it('empty input falls back to 0', () => {
    expect(suggestNow([])).toBe(0);
  });

  it('rounds a fractional latest date', () => {
    expect(suggestNow([node(11.6)])).toBe(12);
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

  it('stamps the swords glyph on Chronicle-supertype nodes only (the tangle seam)', () => {
    const elements: Element[] = [
      {
        id: 'e1',
        type: 'event',
        name: 'Battle of the Ford',
        supertype: 'Chronicle',
        local_updated_at: '2026-01-01',
        start_date: 300,
      } as Element & { start_date: number },
      {
        id: 'e2',
        type: 'event',
        name: 'Coronation',
        supertype: 'Political',
        local_updated_at: '2026-01-01',
        start_date: 310,
      } as Element & { start_date: number },
    ];
    const nodes = extractTemporalNodes(elements);
    expect(nodes.find(n => n.id === 'e1')?.glyph).toBe('swords');
    expect(nodes.find(n => n.id === 'e2')?.glyph).toBeUndefined();
  });

  it('drops an inverted end_date (end before start) rather than drawing backwards', () => {
    const elements: Element[] = [
      {
        id: 'n2',
        type: 'narrative',
        name: 'Backwards',
        local_updated_at: '2026-01-01',
        start_date: 200,
        end_date: 100, // inverted
      } as Element & { start_date: number; end_date: number },
    ];
    const nodes = extractTemporalNodes(elements);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].startDate).toBe(200);
    expect(nodes[0].endDate).toBeNull(); // inverted range discarded
  });

  it('flags an unrevoked title open-ended; revoked, inverted-revoked, and end-less events stay closed (Act 2A)', () => {
    const nodes = extractTemporalNodes([
      { id: 't1', type: 'title', name: 'Held', local_updated_at: 'x', grant_date: 28 } as Element & Record<string, unknown>,
      { id: 't2', type: 'title', name: 'Past', local_updated_at: 'x', grant_date: 12, revoke_date: 31 } as Element & Record<string, unknown>,
      // Inverted revoke is RECORDED bad data — dropped as a range, but it must
      // not be reinterpreted as an ongoing tenure.
      { id: 't3', type: 'title', name: 'Bad', local_updated_at: 'x', grant_date: 30, revoke_date: 10 } as Element & Record<string, unknown>,
      { id: 'e1', type: 'event', name: 'Moment', local_updated_at: 'x', start_date: 40 } as Element & Record<string, unknown>,
    ]);
    expect(nodes.find(n => n.id === 't1')!.openEnded).toBe(true);
    expect(nodes.find(n => n.id === 't2')!.openEnded).toBeUndefined();
    expect(nodes.find(n => n.id === 't3')!.openEnded).toBeUndefined();
    expect(nodes.find(n => n.id === 'e1')!.openEnded).toBeUndefined(); // events are moments, not ongoing
  });

  it('keeps an equal end_date (zero-length range is valid)', () => {
    const elements: Element[] = [
      {
        id: 'n3',
        type: 'narrative',
        name: 'Instant',
        local_updated_at: '2026-01-01',
        start_date: 100,
        end_date: 100,
      } as Element & { start_date: number; end_date: number },
    ];
    expect(extractTemporalNodes(elements)[0].endDate).toBe(100);
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

describe('timeline node contentMass (S4 label weight input)', () => {
  it('counts description + story chars; absent fields count zero', () => {
    const nodes = extractTemporalNodes([
      {
        id: 'n1', type: 'narrative', name: 'Chronicle', local_updated_at: 'x',
        start_date: 10, description: 'ab', story: 'cdef',
      } as Element & Record<string, unknown>,
      {
        id: 'e1', type: 'event', name: 'Bare', local_updated_at: 'x', start_date: 20,
      } as Element & Record<string, unknown>,
    ]);
    expect(nodes.find(n => n.id === 'n1')!.contentMass).toBe(6);
    expect(nodes.find(n => n.id === 'e1')!.contentMass).toBe(0);
  });

  it('ignores non-string description values (never NaN)', () => {
    const nodes = extractTemporalNodes([
      {
        id: 'e2', type: 'event', name: 'Odd', local_updated_at: 'x',
        start_date: 30, description: null,
      } as unknown as Element,
    ]);
    expect(nodes[0].contentMass).toBe(0);
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
