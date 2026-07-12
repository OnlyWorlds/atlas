/**
 * Timeline view layout kernels — the pure pieces of the interactive chart
 * renderer (timeline-view.ts). Locks the density-fan (beeswarm) placement and
 * the zoom/pan range clamp against the audit's B-armor/B-tail edges:
 *   - degenerate band (bottom <= top) must bail, not stack every node on a line;
 *   - anchors claim the centre spine, same-date neighbours fan apart;
 *   - off-screen nodes drop; effectiveRange clamps inside the padded base range.
 */

import { describe, it, expect } from 'vitest';
import { computeBeeswarm, clampWindow, zoomWindow, rangeVsNow } from '../../src/visualization/timeline/timeline-view';
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
    contentMass: 0,
  };
}

const identityX = (d: number): number => d;

describe('rangeVsNow — the forward-half classifier (Act 1)', () => {
  it('treats everything as past when there is no now', () => {
    expect(rangeVsNow(10, null, null)).toBe('past');
    expect(rangeVsNow(10, 50, null)).toBe('past');
  });

  it('classifies a point node against the seam (AT now = past, inclusive)', () => {
    expect(rangeVsNow(30, null, 40)).toBe('past');
    expect(rangeVsNow(40, null, 40)).toBe('past');   // exactly at now → past side
    expect(rangeVsNow(50, null, 40)).toBe('future');
  });

  it('classifies a range: wholly past, wholly future, or straddling', () => {
    expect(rangeVsNow(10, 30, 40)).toBe('past');      // ends before now
    expect(rangeVsNow(50, 70, 40)).toBe('future');    // starts after now
    expect(rangeVsNow(30, 45, 40)).toBe('straddle');  // now falls inside
  });

  it('a range ending exactly at now is past, not straddling', () => {
    expect(rangeVsNow(30, 40, 40)).toBe('past');
  });

  it('a zero/negative-length range falls back to point semantics', () => {
    expect(rangeVsNow(50, 50, 40)).toBe('future');    // end !> start → point at 50
    expect(rangeVsNow(30, 30, 40)).toBe('past');
  });
});

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

describe('clampWindow — the band clamp (S3)', () => {
  const bounds = { min: 0, max: 100 };

  it('keeps an in-bounds window unchanged', () => {
    expect(clampWindow({ start: 20, end: 60 }, bounds)).toEqual({ start: 20, end: 60 });
  });

  it('clamps a slide past the high edge to bounds.max + 5% pad, keeping the span', () => {
    const r = clampWindow({ start: 90, end: 140 }, bounds);
    expect(r.end).toBeCloseTo(105, 6);
    expect(r.start).toBeCloseTo(55, 6);
  });

  it('clamps a slide past the low edge to bounds.min - 5% pad, keeping the span', () => {
    const r = clampWindow({ start: -60, end: -10 }, bounds);
    expect(r.start).toBeCloseTo(-5, 6);
    expect(r.end).toBeCloseTo(45, 6);
  });

  it('a window wider than the padded bounds collapses to them', () => {
    const r = clampWindow({ start: -500, end: 500 }, bounds);
    expect(r.start).toBeCloseTo(-5, 6);
    expect(r.end).toBeCloseTo(105, 6);
  });

  it('degenerate bounds return the bounds themselves', () => {
    expect(clampWindow({ start: 0, end: 10 }, { min: 5, max: 5 })).toEqual({ start: 5, end: 5 });
  });
});

describe('zoomWindow — resize around the cursor date (S3)', () => {
  const bounds = { min: 0, max: 100 };

  it('halving the span keeps the anchor date at the same fraction', () => {
    // Window [0,100], anchor 25 (25% across). Zoom in ×0.5 → span 50; the
    // anchor stays 25% across the new window → [12.5, 62.5].
    const r = zoomWindow({ start: 0, end: 100 }, 0.5, 25, bounds);
    expect(r.start).toBeCloseTo(12.5, 6);
    expect(r.end).toBeCloseTo(62.5, 6);
  });

  it('zooming out clamps the span to bounds·1.1', () => {
    const r = zoomWindow({ start: 0, end: 100 }, 10, 50, bounds);
    expect(r.end - r.start).toBeCloseTo(110, 6);
  });

  it('zooming in clamps the span to bounds/ZOOM_MAX (never inverts)', () => {
    let win = { start: 40, end: 60 };
    for (let i = 0; i < 60; i++) win = zoomWindow(win, 0.5, 50, bounds);
    expect(win.end - win.start).toBeGreaterThan(0);
    expect(win.end - win.start).toBeCloseTo(100 / 200, 4);
  });

  it('a zoomed window stays inside the padded bounds', () => {
    const r = zoomWindow({ start: 60, end: 100 }, 2, 100, bounds);
    expect(r.end).toBeLessThanOrEqual(105 + 1e-9);
    expect(r.start).toBeGreaterThanOrEqual(-5 - 1e-9);
  });
});
