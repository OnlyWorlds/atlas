/**
 * chart-static: the frozen chart renderer (share-builder preview + publish).
 * A zero-span block (one dated element, or all on one date)
 * must centre its nodes, as the live room does, not pin them to
 * the left padding.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { freezeChartBlock } from '../../src/visualization/timeline/chart-freeze';
import { renderChartView, drawnAxis } from '../../src/visualization/timeline/chart-static';
import { ELEMENT_ICONS } from '../../src/core/constants';
import type { ChartConfig } from '../../src/visualization/timeline/types';

const texts: { text: string; x: number }[] = [];
beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  const noop = () => {};
  (HTMLCanvasElement.prototype as any).getContext = () => ({
    setTransform: noop, clearRect: noop, fillRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
    stroke: noop, arc: noop, fill: noop, strokeText: noop,
    measureText: (t: string) => ({ width: t.length * 6 }),
    fillText: (text: string, x: number) => texts.push({ text, x }),
    set fillStyle(_v: unknown) {}, set strokeStyle(_v: unknown) {}, set lineWidth(_v: unknown) {},
    set font(_v: unknown) {}, set textAlign(_v: unknown) {}, set textBaseline(_v: unknown) {},
  });
});

const chart = {
  schema_version: 1, id: 'c1', name: 'The Siege', axis: { kind: 'time', direction: 'both' },
  scope: { kind: 'all' }, render: '2d',
} as ChartConfig;

/** Render at the fallback 600px width; return the x of every event glyph. */
function glyphXs(els: any[]): number[] {
  const block = freezeChartBlock('c1', 'b1', [chart], els, new Set())!;
  texts.length = 0;
  renderChartView(block);
  return texts.filter(t => t.text === ELEMENT_ICONS.event).map(t => t.x);
}

describe('renderChartView: zero-span axis', () => {
  it('all nodes on one date draw centred on a 600px canvas, not at the left edge', () => {
    const xs = glyphXs([
      { id: 'e1', type: 'event', name: 'The Siege', start_date: 454 },
      { id: 'e2', type: 'event', name: 'The Fall', start_date: 454 },
    ]);
    expect(xs.length).toBe(2);
    for (const x of xs) expect(x).toBeCloseTo(300, 5);
    // The lone date label sits under the nodes too.
    expect(texts.find(t => t.text === '454')!.x).toBeCloseTo(300, 5);
  });

  it('a real span still runs edge to edge (control)', () => {
    const xs = glyphXs([
      { id: 'e1', type: 'event', name: 'A', start_date: 100 },
      { id: 'e2', type: 'event', name: 'B', start_date: 200 },
    ]).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(18, 5);
    expect(xs[1]).toBeCloseTo(582, 5);
  });

  it('drawnAxis pads a zero span symmetrically and leaves a real span alone', () => {
    expect(drawnAxis(454, 454)).toEqual({ lo: 404, span: 100 });
    expect(drawnAxis(100, 200)).toEqual({ lo: 100, span: 100 });
  });
});
