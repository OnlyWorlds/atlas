import { describe, it, expect } from 'vitest';
import { freezeChartBlock } from '../../src/visualization/timeline/chart-freeze';
import type { ChartConfig } from '../../src/visualization/timeline/types';
import type { Element } from '../../src/core/types';

function chart(id: string, scope: ChartConfig['scope']): ChartConfig {
  return { schema_version: 1, id, name: 'C', axis: { kind: 'time', direction: 'both' }, scope, render: '2d' };
}
function ev(id: string, name: string, start: number, extra: Record<string, unknown> = {}): Element {
  return { id, type: 'event', name, start_date: start, ...extra } as Element;
}

const NODE_ALLOWED = new Set(['type', 'name', 'date', 'endDate', 'anchor', 'ref']);

describe('freezeChartBlock', () => {
  const charts = [chart('ch1', { kind: 'all' })];
  const elements = [
    ev('e1', 'Founding', 1000),
    ev('e2', 'War', 1015, { end_date: 1018 }),
    ev('e3', 'Pact', 1025),
  ];

  it('returns null for a dangling chartId (discloses nothing)', () => {
    expect(freezeChartBlock('nope', 'b1', charts, elements, new Set())).toBeNull();
  });

  it('freezes in-scope nodes with NO field beyond identity/position', () => {
    const frozen = freezeChartBlock('ch1', 'b1', charts, elements, new Set())!;
    expect(frozen.kind).toBe('chart');
    expect(frozen.nodes.length).toBe(3);
    for (const n of frozen.nodes) {
      for (const k of Object.keys(n)) expect(NODE_ALLOWED.has(k)).toBe(true);
    }
    expect(frozen.axisMin).toBe(1000);
    expect(frozen.axisMax).toBe(1025);
  });

  it('carries endDate only when after date; axis accounts for ranges', () => {
    const frozen = freezeChartBlock('ch1', 'b1', charts, elements, new Set())!;
    const war = frozen.nodes.find(n => n.name === 'War')!;
    expect(war.endDate).toBe(1018);
    expect(frozen.nodes.find(n => n.name === 'Founding')!.endDate).toBeUndefined();
  });

  it('adds ref ONLY for elements in the included (carded) set', () => {
    const frozen = freezeChartBlock('ch1', 'b1', charts, elements, new Set(['e1']))!;
    expect(frozen.nodes.find(n => n.name === 'Founding')!.ref).toBe('e1');
    expect(frozen.nodes.find(n => n.name === 'War')!.ref).toBeUndefined();
  });

  it('empty in-scope set yields a bare axis, not a crash', () => {
    const frozen = freezeChartBlock(
      'ch1', 'b1', [chart('ch1', { kind: 'types', types: ['ability'] })], elements, new Set(),
    )!;
    expect(frozen.nodes).toEqual([]);
    expect(frozen.axisMin).toBe(0);
    expect(frozen.axisMax).toBe(0);
  });

  describe('the calendar publish bake (2B — additive, date stays numeric)', () => {
    const CAL = {
      version: 1, grain: 'year',
      eras: [{ name: 'After Empire', abbrev: 'AE', start: 1000, restart: true }],
      format: '{year} {era}',
    };
    const withCal = [
      ...elements,
      { id: 'cal1', type: 'construct', name: 'Imperial', atlas_calendar: CAL } as never as Element,
    ];
    const lensedChart: ChartConfig = { ...chart('ch1', { kind: 'all' }), calendarId: 'cal1' };

    it('bakes node labels + axis ticks through the chart lens; numbers untouched', () => {
      const frozen = freezeChartBlock('ch1', 'b1', [lensedChart], withCal, new Set())!;
      const founding = frozen.nodes.find(n => n.name === 'Founding')!;
      expect(founding.date).toBe(1000);            // numeric forever
      expect(founding.label).toBe('1 AE');
      const war = frozen.nodes.find(n => n.name === 'War')!;
      expect(war.endLabel).toBe('19 AE');
      expect(frozen.axisTicks!.length).toBeGreaterThan(0);
      for (const t of frozen.axisTicks!) {
        expect(typeof t.position).toBe('number');
        expect(t.label).toMatch(/AE|\d/);
      }
    });

    it('a dangling calendarId bakes nothing — the block stays purely numeric', () => {
      const dangling: ChartConfig = { ...chart('ch1', { kind: 'all' }), calendarId: 'gone' };
      const frozen = freezeChartBlock('ch1', 'b1', [dangling], withCal, new Set())!;
      expect(frozen.axisTicks).toBeUndefined();
      expect(frozen.nodes.every(n => n.label === undefined)).toBe(true);
    });

    it('a lensless chart is byte-identical to the pre-bake shape', () => {
      const frozen = freezeChartBlock('ch1', 'b1', charts, withCal, new Set())!;
      expect(frozen.axisTicks).toBeUndefined();
      for (const n of frozen.nodes) {
        for (const k of Object.keys(n)) expect(NODE_ALLOWED.has(k)).toBe(true);
      }
    });
  });
});
