/**
 * Scroll-view layout kernel tests (2C) — pacing clamp, gap seams, era
 * section seams, the now seam, determinism, and the y↔date maps. Fixture
 * calendar mirrors calendar-axis.test.ts (Vessach: two eras with a gap).
 */
import { describe, it, expect } from 'vitest';
import type { CalendarConfig } from '@onlyworlds/sdk';
import type { TimelineNode } from '../../src/visualization/timeline/types';
import {
  layoutScroll, SCROLL_TOP_PAD, SCROLL_MIN_GAP, SCROLL_MAX_GAP,
  type ScrollNodeItem, type ScrollGapItem, type ScrollEraItem,
} from '../../src/visualization/timeline/scroll-layout';

const VESSACH: CalendarConfig = {
  version: 1,
  grain: 'year',
  eras: [
    { name: 'First Age', abbrev: 'FA', start: -20000, end: -10000, restart: true, year_base: 0 },
    { name: 'Third Age', abbrev: 'TA', start: 0, restart: true, year_base: 0 },
  ],
  format: '{year} {era}',
};

function node(id: string, date: number, endDate: number | null = null): TimelineNode {
  return {
    id, elementType: 'event', name: `n-${id}`, startDate: date, endDate,
    color: '#fff', dateSpec: { kind: 'exact', value: date }, links: [],
    degree: 0, contentMass: 0,
  };
}

function nodesOf(layout: ReturnType<typeof layoutScroll>): ScrollNodeItem[] {
  return layout.items.filter((i): i is ScrollNodeItem => i.kind === 'node');
}

describe('layoutScroll', () => {
  it('empty world → empty items, finite height', () => {
    const l = layoutScroll([]);
    expect(l.items).toEqual([]);
    expect(Number.isFinite(l.totalHeight)).toBe(true);
  });

  it('single node anchors at the top pad', () => {
    const l = layoutScroll([node('a', 100)]);
    const n = nodesOf(l);
    expect(n).toHaveLength(1);
    expect(n[0].y).toBe(SCROLL_TOP_PAD);
  });

  it('sorts by date then id and alternates sides deterministically', () => {
    const l1 = layoutScroll([node('b', 20), node('a', 10), node('c', 20)]);
    const l2 = layoutScroll([node('c', 20), node('a', 10), node('b', 20)]);
    const ids1 = nodesOf(l1).map(n => n.node.id);
    expect(ids1).toEqual(['a', 'b', 'c']); // date, then id tiebreak
    expect(nodesOf(l1).map(n => n.side)).toEqual(['right', 'left', 'right']);
    // Input order never changes the layout.
    expect(nodesOf(l2).map(n => ({ id: n.node.id, y: n.y }))).toEqual(
      nodesOf(l1).map(n => ({ id: n.node.id, y: n.y })));
  });

  it('same-date cluster members keep MIN_GAP; y strictly increases', () => {
    const l = layoutScroll([node('a', 50), node('b', 50), node('c', 50)]);
    const ys = nodesOf(l).map(n => n.y);
    expect(ys[1] - ys[0]).toBe(SCROLL_MIN_GAP);
    expect(ys[2] - ys[1]).toBe(SCROLL_MIN_GAP);
  });

  it('spacing clamps into [MIN_GAP, MAX_GAP] band', () => {
    // Gaps: 1, 2, 400 — the huge gap must not become huge pixels.
    const l = layoutScroll([node('a', 0), node('b', 1), node('c', 3), node('d', 403)]);
    const ys = nodesOf(l).map(n => n.y);
    for (let i = 1; i < ys.length; i++) {
      const gapPx = ys[i] - ys[i - 1];
      expect(gapPx).toBeGreaterThanOrEqual(SCROLL_MIN_GAP);
      // The d-anchor also absorbs its gap seam's height; the SPACING itself
      // stays clamped, so the total stays well under raw proportionality.
      expect(gapPx).toBeLessThanOrEqual(SCROLL_MAX_GAP + 120);
    }
  });

  it('a gap far beyond the median inserts a named gap seam', () => {
    const l = layoutScroll([node('a', 0), node('b', 10), node('c', 20), node('d', 520)]);
    const gaps = l.items.filter((i): i is ScrollGapItem => i.kind === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].steps).toBe(500);
    // Seam sits between c and d.
    const c = nodesOf(l).find(n => n.node.id === 'c')!;
    const d = nodesOf(l).find(n => n.node.id === 'd')!;
    expect(gaps[0].y).toBeGreaterThan(c.y);
    expect(gaps[0].y).toBeLessThan(d.y);
  });

  it('a uniform world never seams', () => {
    const l = layoutScroll([node('a', 0), node('b', 100), node('c', 200), node('d', 300)]);
    expect(l.items.some(i => i.kind === 'gap')).toBe(false);
  });

  it('era seams announce the opening era and each era change; gap nodes get none', () => {
    // FA: -20000..-10000 · gap · TA: 0.. — one node in each region.
    const l = layoutScroll(
      [node('fa', -15000), node('mid', -5000), node('ta', 100)],
      { calendar: VESSACH },
    );
    const eras = l.items.filter((i): i is ScrollEraItem => i.kind === 'era');
    expect(eras.map(e => e.name)).toEqual(['First Age', 'Third Age']);
    // The First Age header opens the document (above its first node).
    expect(eras[0].y).toBeLessThan(nodesOf(l)[0].y);
    // The gap node carries no header; Third Age announces before `ta`.
    const mid = nodesOf(l).find(n => n.node.id === 'mid')!;
    const ta = nodesOf(l).find(n => n.node.id === 'ta')!;
    expect(eras[1].y).toBeGreaterThan(mid.y);
    expect(eras[1].y).toBeLessThan(ta.y);
  });

  it('no calendar → no era items', () => {
    const l = layoutScroll([node('a', 0), node('b', 50)]);
    expect(l.items.some(i => i.kind === 'era')).toBe(false);
  });

  it('the now seam lands between the straddling nodes', () => {
    const l = layoutScroll([node('a', 0), node('b', 100)], { now: 50 });
    const now = l.items.find(i => i.kind === 'now')!;
    const [a, b] = nodesOf(l);
    expect(now.y).toBeGreaterThan(a.y);
    expect(now.y).toBeLessThan(b.y);
  });

  it('a now beyond recorded history closes the document; before it, opens it', () => {
    const after = layoutScroll([node('a', 0), node('b', 100)], { now: 500 });
    const nowAfter = after.items.find(i => i.kind === 'now')!;
    expect(nowAfter.y).toBeGreaterThan(nodesOf(after)[1].y);
    const before = layoutScroll([node('a', 0), node('b', 100)], { now: -500 });
    const nowBefore = before.items.find(i => i.kind === 'now')!;
    expect(nowBefore.y).toBeLessThan(nodesOf(before)[0].y);
  });

  it('yForDate interpolates between anchors and clamps at the edges', () => {
    const l = layoutScroll([node('a', 0), node('b', 100)]);
    const [a, b] = nodesOf(l);
    expect(l.yForDate(-50)).toBe(a.y);
    expect(l.yForDate(1000)).toBe(b.y);
    const midY = l.yForDate(50);
    expect(midY).toBeGreaterThan(a.y);
    expect(midY).toBeLessThan(b.y);
  });

  it('dateForY inverts yForDate on the interior', () => {
    const l = layoutScroll([node('a', 0), node('b', 100), node('c', 300)]);
    const y = l.yForDate(150);
    expect(l.dateForY(y)!).toBeCloseTo(150, 6);
    expect(l.dateForY(-999)).toBe(0);
    expect(layoutScroll([]).dateForY(10)).toBe(null);
  });

  it('total height grows monotonically with content and stays finite', () => {
    const few = layoutScroll([node('a', 0), node('b', 10)]);
    const many = layoutScroll(Array.from({ length: 40 }, (_, i) => node(`n${i}`, i * 10)));
    expect(many.totalHeight).toBeGreaterThan(few.totalHeight);
    expect(Number.isFinite(many.totalHeight)).toBe(true);
  });
});
