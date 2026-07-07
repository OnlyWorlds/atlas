/**
 * Timeline view layout kernels — the pure pieces of the interactive chart
 * renderer (timeline-view.ts). Locks the density-fan (beeswarm) placement and
 * the zoom/pan range clamp against the audit's B-armor/B-tail edges:
 *   - degenerate band (bottom <= top) must bail, not stack every node on a line;
 *   - anchors claim the centre spine, same-date neighbours fan apart;
 *   - off-screen nodes drop; effectiveRange clamps inside the padded base range.
 */

import { describe, it, expect } from 'vitest';
import { computeBeeswarm, effectiveRange } from '../../src/visualization/timeline/timeline-view';
import type { TimelineNode } from '../../src/visualization/timeline/types';

function node(id: string, startDate: number): TimelineNode {
  return {
    id,
    elementType: 'event',
    name: id,
    startDate,
    endDate: null,
    dateSpec: { kind: 'exact', value: startDate },
    color: '#fff',
    links: [],
    degree: 0,
  };
}

const identityX = (d: number): number => d;

describe('computeBeeswarm — density-fan layout', () => {
  it('returns [] for a degenerate band (bottom <= top)', () => {
    // axisY - 8 <= TOP_PAD(20) → no vertical room. Must bail (else the whole
    // chart stacks on one non-interactive line).
    const placed = computeBeeswarm([node('a', 100)], new Set(), identityX, 400, 25);
    expect(placed).toEqual([]);
  });

  it('lands a lone node on the centre spine', () => {
    // top=20, bottom=axisY-8=212 → centerY = 116.
    const placed = computeBeeswarm([node('a', 100)], new Set(), identityX, 400, 220);
    expect(placed).toHaveLength(1);
    expect(placed[0].y).toBe(116);
    expect(placed[0].x).toBe(100);
  });

  it('excludes nodes projected off-screen', () => {
    const placed = computeBeeswarm([node('a', -100)], new Set(), identityX, 400, 220);
    expect(placed).toEqual([]);
  });

  it('fans same-date nodes to distinct y levels', () => {
    const placed = computeBeeswarm([node('a', 100), node('b', 100)], new Set(), identityX, 400, 220);
    expect(placed).toHaveLength(2);
    const ys = placed.map(p => p.y);
    expect(new Set(ys).size).toBe(2); // not overlapping
  });

  it('lays anchors first so they hold the centre spine', () => {
    // Same date; 'b' is the anchor → it must win the centre, 'a' steps off.
    const placed = computeBeeswarm([node('a', 100), node('b', 100)], new Set(['b']), identityX, 400, 220);
    expect(placed.find(p => p.node.id === 'b')!.y).toBe(116);
    expect(placed.find(p => p.node.id === 'a')!.y).not.toBe(116);
  });
});

describe('effectiveRange — zoom/pan clamp', () => {
  const base = { min: 0, max: 100 };

  it('returns the base range unchanged at zoom <= 1', () => {
    expect(effectiveRange(base, 1, null)).toEqual(base);
    expect(effectiveRange(base, 0.5, 50)).toEqual(base);
  });

  it('returns the base range for a zero/negative span', () => {
    expect(effectiveRange({ min: 5, max: 5 }, 4, null)).toEqual({ min: 5, max: 5 });
  });

  it('centres a zoomed window on the base midpoint when unpanned', () => {
    // span 100 / zoom 2 = 50, centred on 50 → [25, 75].
    expect(effectiveRange(base, 2, null)).toEqual({ min: 25, max: 75 });
  });

  it('clamps a pan past the high edge to base.max + 5% pad', () => {
    // pad = 5. Panning far right pins max at 105 and keeps the effSpan (50).
    const r = effectiveRange(base, 2, 1000);
    expect(r.max).toBeCloseTo(105, 6);
    expect(r.min).toBeCloseTo(55, 6);
  });

  it('clamps a pan past the low edge to base.min - 5% pad', () => {
    const r = effectiveRange(base, 2, -1000);
    expect(r.min).toBeCloseTo(-5, 6);
    expect(r.max).toBeCloseTo(45, 6);
  });
});
