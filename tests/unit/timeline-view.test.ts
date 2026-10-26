/**
 * Timeline view layout kernels — the pure pieces of the interactive chart
 * renderer (timeline-view.ts). Locks the density-fan (beeswarm) placement and
 * the zoom/pan range clamp against the audit's B-armor/B-tail edges:
 *   - degenerate band (bottom <= top) must bail, not stack every node on a line;
 *   - anchors claim the centre spine, same-date neighbours fan apart;
 *   - off-screen nodes drop; effectiveRange clamps inside the padded base range.
 */

import { describe, it, expect } from 'vitest';
import { computeBeeswarm, clampWindow, zoomWindow, navBounds, rangeVsNow, extendRangeForOpenEnds, temporalMetaLine, focusInferredEnd, glyphDropDate } from '../../src/visualization/timeline/timeline-view';
import { effectiveEndDate } from '../../src/visualization/timeline/temporal-fields';
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

describe('effectiveEndDate — open-end resolution (Act 2A)', () => {
  it('a recorded end always wins', () => {
    expect(effectiveEndDate(10, 30, true, 50)).toBe(30);
    expect(effectiveEndDate(10, 30, undefined, 50)).toBe(30);
  });

  it('an open-ended span runs to the now when the now is ahead of the start', () => {
    expect(effectiveEndDate(28, null, true, 38)).toBe(38);
  });

  it('stays a point without a now, or when the now is at/behind the start', () => {
    expect(effectiveEndDate(28, null, true, null)).toBeNull();
    expect(effectiveEndDate(28, null, true, 28)).toBeNull();  // granted AT now — no span yet
    expect(effectiveEndDate(28, null, true, 20)).toBeNull();  // granted in the future
  });

  it('a non-open-ended node never runs to the now', () => {
    expect(effectiveEndDate(28, null, undefined, 38)).toBeNull();
    expect(effectiveEndDate(28, null, false, 38)).toBeNull();
  });
});

describe('extendRangeForOpenEnds — the fit shows the open end (Act 2A)', () => {
  const openNode = { startDate: 28, endDate: null, openEnded: true };

  it('extends the max to the now (plus pad) when an open span runs past it', () => {
    const r = extendRangeForOpenEnds({ min: 8, max: 28 }, [openNode], 38);
    expect(r.max).toBeGreaterThan(38);
    expect(r.min).toBe(8);
  });

  it('no now / no open nodes / now inside the range → unchanged', () => {
    expect(extendRangeForOpenEnds({ min: 8, max: 28 }, [openNode], null)).toEqual({ min: 8, max: 28 });
    expect(extendRangeForOpenEnds({ min: 8, max: 28 }, [{ startDate: 12, endDate: 20 }], 38)).toEqual({ min: 8, max: 28 });
    expect(extendRangeForOpenEnds({ min: 8, max: 50 }, [openNode], 38)).toEqual({ min: 8, max: 50 });
  });
});

describe('focusInferredEnd — the presumed-alive life-line (Act 2A, focus-only)', () => {
  it('a character born before the now is presumed alive to it', () => {
    expect(focusInferredEnd({ elementType: 'character', startDate: 5, endDate: null }, 38)).toBe(38);
    expect(focusInferredEnd({ elementType: 'creature', startDate: 5, endDate: null }, 38)).toBe(38);
  });

  it('no now, born at/after the now, or a recorded/open span → no inference', () => {
    expect(focusInferredEnd({ elementType: 'character', startDate: 5, endDate: null }, null)).toBeNull();
    expect(focusInferredEnd({ elementType: 'character', startDate: 38, endDate: null }, 38)).toBeNull();
    expect(focusInferredEnd({ elementType: 'character', startDate: 45, endDate: null }, 38)).toBeNull();
    expect(focusInferredEnd({ elementType: 'character', startDate: 5, endDate: 30 }, 38)).toBeNull();
  });

  it('only life types infer — a dateless-end event or a title stays out', () => {
    expect(focusInferredEnd({ elementType: 'event', startDate: 5, endDate: null }, 38)).toBeNull();
    expect(focusInferredEnd({ elementType: 'title', startDate: 5, endDate: null, openEnded: true }, 38)).toBeNull();
  });
});

describe('temporalMetaLine — the card speaks type vocabulary (Act 2A)', () => {
  it('a closed tenure reads granted/revoked/held', () => {
    expect(temporalMetaLine({ elementType: 'title', startDate: 12, endDate: 31 }, 38))
      .toBe('granted 12 · revoked 31 · held 19');
  });

  it('an ongoing tenure reads held-so-far against the now', () => {
    expect(temporalMetaLine({ elementType: 'title', startDate: 28, endDate: null, openEnded: true }, 38))
      .toBe('granted 28 · held 10 so far');
  });

  it('an ongoing tenure without a now reads granted only', () => {
    expect(temporalMetaLine({ elementType: 'title', startDate: 28, endDate: null, openEnded: true }, null))
      .toBe('granted 28');
  });

  it('a character reads born + age against the now', () => {
    expect(temporalMetaLine({ elementType: 'character', startDate: 5, endDate: null }, 38))
      .toBe('born 5 · age 33');
    expect(temporalMetaLine({ elementType: 'character', startDate: 5, endDate: null }, null))
      .toBe('born 5');
    expect(temporalMetaLine({ elementType: 'character', startDate: 45, endDate: null }, 38))
      .toBe('born 45'); // not yet born — no negative age
  });

  it('founded/formed vocabulary for institutions, locations, collectives', () => {
    expect(temporalMetaLine({ elementType: 'institution', startDate: 8, endDate: null }, 38)).toBe('founded 8');
    expect(temporalMetaLine({ elementType: 'location', startDate: 2, endDate: null }, null)).toBe('founded 2');
    expect(temporalMetaLine({ elementType: 'collective', startDate: 3, endDate: null }, null)).toBe('formed 3');
  });

  it('other types keep the plain range / point forms', () => {
    expect(temporalMetaLine({ elementType: 'event', startDate: 25, endDate: 27 }, 38)).toBe('25 – 27');
    expect(temporalMetaLine({ elementType: 'event', startDate: 40, endDate: null }, 38)).toBe('40');
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

  it('the focus node places first and its inferred life-line claims the lane (Act 2A)', () => {
    // Focused character born 100, now 300 → subject spine 100→300. A narrative
    // range starting inside that span must step OFF the spine (no collinear
    // ranges with the subject line — live finding), even though the character
    // has no recorded span at all.
    const chara: TimelineNode = { ...node('c', 100), elementType: 'character' };
    const range: TimelineNode = { ...node('n', 180), endDate: 260 };
    const placed = computeBeeswarm([range, chara], new Set(['n']), identityX, 400, 220, undefined, 300, 'c');
    expect(placed.find(p => p.node.id === 'c')!.y).toBe(116); // subject holds the spine (beats the anchor)
    expect(placed.find(p => p.node.id === 'n')!.y).not.toBe(116);
  });

  it('an open-ended span claims its lane to the now — later points step off it (Act 2A)', () => {
    // Tenure a: 100 → now (300). Point b at 200 falls INSIDE the held span; it
    // must not sit on the bar's lane. Without a now, the same b keeps the spine.
    const tenure = { ...node('a', 100), openEnded: true };
    const withNow = computeBeeswarm([tenure, node('b', 200)], new Set(), identityX, 400, 220, undefined, 300);
    const aY = withNow.find(p => p.node.id === 'a')!.y;
    const bY = withNow.find(p => p.node.id === 'b')!.y;
    expect(bY).not.toBe(aY);
    const noNow = computeBeeswarm([tenure, node('b', 200)], new Set(), identityX, 400, 220, undefined, null);
    expect(noNow.find(p => p.node.id === 'b')!.y).toBe(116); // no span claimed → spine free
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

  it('day-grain worlds zoom past the ratio cap down to a fixed step window (2B)', () => {
    // A 20000-step (≈55-year day-grain) world: the 200× ratio cap alone would
    // stop at a 100-step window — the day rung could never engage. The floor
    // is now the looser of ratio cap and MIN_WINDOW_STEPS.
    const bigBounds = { min: 0, max: 20000 };
    let win = { start: 0, end: 20000 };
    for (let i = 0; i < 80; i++) win = zoomWindow(win, 0.5, 7600, bigBounds);
    expect(win.end - win.start).toBeCloseTo(24, 4);
  });
});

describe('navBounds: the camera can reach a now outside history', () => {
  const universe = [node('a', 0), node('b', 100)];

  it('a now at 1000 with history 0..100 is reachable by pan and by zoom-out', () => {
    const bounds = navBounds({ universe, baseRange: null, now: 1000 })!;
    const panned = clampWindow({ start: 950, end: 1050 }, bounds);
    expect(panned.start).toBeLessThanOrEqual(1000);
    expect(panned.end).toBeGreaterThanOrEqual(1000);
    let win = { start: 0, end: 100 };
    for (let i = 0; i < 50; i++) win = zoomWindow(win, 1.2, win.end, bounds);
    expect(win.end).toBeGreaterThanOrEqual(1000);
  });

  it('a now before every event widens the low edge', () => {
    const bounds = navBounds({ universe, baseRange: null, now: -500 })!;
    expect(bounds.min).toBeLessThanOrEqual(-500);
    expect(clampWindow({ start: -550, end: -450 }, bounds).start).toBeLessThanOrEqual(-500);
  });

  it('no now (or a now inside history) leaves the bounds on recorded history', () => {
    const plain = navBounds({ universe, baseRange: null, now: null })!;
    expect(navBounds({ universe, baseRange: null, now: 50 })).toEqual(plain);
    expect(plain.min).toBeLessThan(0);
    expect(plain.max).toBeGreaterThan(100);
    expect(plain.max).toBeLessThan(110);
  });

  it('falls back to the scoped fit when there is no universe, still taking in the now', () => {
    expect(navBounds({ universe: [], baseRange: { min: 0, max: 100 }, now: 400 })).toEqual({ min: 0, max: 400 });
    expect(navBounds({ universe: [], baseRange: null, now: 400 })).toBeNull();
  });
});

describe('glyphDropDate — re-dating snap + range clamp', () => {
  it('rounds to whole dates', () => {
    expect(glyphDropDate(12.4, null)).toBe(12);
    expect(glyphDropDate(12.6, null)).toBe(13);
    expect(glyphDropDate(-3.5, null)).toBe(-3);
  });

  it('clamps a range start at its recorded end (the end is anchored)', () => {
    expect(glyphDropDate(99, 8)).toBe(8);
    expect(glyphDropDate(8.4, 8)).toBe(8);
  });

  it('a fractional end clamps to its floor (start never passes the end)', () => {
    expect(glyphDropDate(99, 8.7)).toBe(8);
  });

  it('dates at or before the end pass through untouched', () => {
    expect(glyphDropDate(5, 8)).toBe(5);
    expect(glyphDropDate(8, 8)).toBe(8);
    expect(glyphDropDate(-40, 8)).toBe(-40);
  });

  it('an end-stretch clamps at the recorded start (the other grip)', () => {
    expect(glyphDropDate(-5, null, 5)).toBe(5);
    expect(glyphDropDate(4.4, null, 5)).toBe(5);
    expect(glyphDropDate(20, null, 5)).toBe(20);
    expect(glyphDropDate(3, null, 4.3)).toBe(5); // fractional start ceils
  });
});
