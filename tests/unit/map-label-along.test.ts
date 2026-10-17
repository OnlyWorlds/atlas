/**
 * A name written along a line on a styled map (S424) joins the density
 * layer: it covers the screen piece by piece along its line, and when an
 * area's name sits where it would print, it slides along the line to a
 * clear spot, or drops.
 */

import { describe, it, expect } from 'vitest';
import {
  alongLabelPlacements, chooseVisibleLabels, ALONG_SHARES, type Box, type LabelCandidate,
} from '../../src/tabs/right/map-label-density';

// a river across the screen, left to right, then down
const river = [{ x: 100, y: 300 }, { x: 500, y: 300 }, { x: 500, y: 700 }];

const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;

describe('alongLabelPlacements', () => {
  it('offers the middle first, then the shares either side', () => {
    const ps = alongLabelPlacements(river, 120, 8, 12);
    expect(ps.map(p => p.share)).toEqual([...ALONG_SHARES]);
  });

  it('puts the middle placement at the middle of the line (800 px long: at 400 px, x 500 y 300)', () => {
    const [mid] = alongLabelPlacements(river, 40, 8, 0);
    const cx = (mid.box.x0 + mid.box.x1) / 2;
    expect(cx).toBeGreaterThan(470);
    expect(cx).toBeLessThan(530);
  });

  it('lifts the pieces above a line that runs left to right', () => {
    const [p] = alongLabelPlacements([{ x: 0, y: 100 }, { x: 400, y: 100 }], 100, 8, 12);
    for (const part of p.parts) expect((part.y0 + part.y1) / 2).toBeCloseTo(88, 6);
  });

  it('covers the name, not the line\'s bounds: a diagonal river leaves its corners clear', () => {
    const diag = [{ x: 0, y: 0 }, { x: 600, y: 600 }];
    const [p] = alongLabelPlacements(diag, 120, 8, 0);
    const corner: Box = { x0: 200, y0: 350, x1: 260, y1: 400 };
    expect(overlaps(p.box, corner)).toBe(true);
    expect(p.parts.some(part => overlaps(part, corner))).toBe(false);
  });

  it('has no place for a name longer than its line', () => {
    expect(alongLabelPlacements([{ x: 0, y: 0 }, { x: 50, y: 0 }], 80, 8, 0)).toEqual([]);
  });

  it('keeps a river\'s name on its land, the middle of the longest stretch first', () => {
    const line = [{ x: 0, y: 0 }, { x: 1000, y: 0 }];
    // land on the first 60%, the mouth at sea after it
    const ps = alongLabelPlacements(line, 100, 8, 0, ALONG_SHARES, [[0, 0.6]]);
    expect(ps[0].share).toBeCloseTo(0.3, 9);
    for (const p of ps) expect(p.box.x1 - 8).toBeLessThanOrEqual(600 + 1e-6);
    expect(ps.map(p => p.share)).not.toContain(0.65);
  });

  it('leaves out a share whose span runs off an end', () => {
    // 200 px line, 100 px name: 0.2 and 0.8 would run off (centres at 40 and 160)
    const ps = alongLabelPlacements([{ x: 0, y: 0 }, { x: 200, y: 0 }], 100, 8, 0);
    expect(ps.map(p => p.share)).toEqual([0.5, 0.35, 0.65]);
  });
});

describe('chooseVisibleLabels with a name along a line', () => {
  const viewport = { w: 1000, h: 1000 };
  const ps = alongLabelPlacements(river, 120, 8, 12);
  const along: LabelCandidate = {
    id: 'along:r', pri: 3, weight: 800,
    boxes: ps.map(p => p.box), parts: ps.map(p => p.parts), name: 'the river',
  };

  it('takes the middle when nothing is in the way', () => {
    expect(chooseVisibleLabels([along], viewport).get('along:r')).toBe(0);
  });

  it('slides along its line when an area\'s name sits on the middle', () => {
    const area: LabelCandidate = {
      id: 'zone:forest', pri: 2, weight: 300, name: 'the forest',
      boxes: [{ x0: 430, y0: 270, x1: 520, y1: 300 }],
    };
    const chosen = chooseVisibleLabels([along, area], viewport);
    expect(chosen.get('zone:forest')).toBe(0);
    const idx = chosen.get('along:r');
    expect(idx).toBeDefined();
    expect(idx).toBeGreaterThan(0);
    for (const part of ps[idx!].parts) expect(overlaps(part, area.boxes[0])).toBe(false);
  });

  it('an area\'s name off the line but inside its bounds does not move it (the pieces collide, not the bounds)', () => {
    const diag = [{ x: 0, y: 0 }, { x: 600, y: 600 }];
    const dps = alongLabelPlacements(diag, 120, 8, 0);
    const d: LabelCandidate = { id: 'along:d', pri: 3, weight: 1, boxes: dps.map(p => p.box), parts: dps.map(p => p.parts) };
    const area: LabelCandidate = { id: 'zone:a', pri: 2, weight: 1, boxes: [{ x0: 230, y0: 330, x1: 280, y1: 370 }] };
    expect(overlaps(dps[0].box, area.boxes[0])).toBe(true);
    expect(chooseVisibleLabels([d, area], viewport).get('along:d')).toBe(0);
  });

  it('a pin icon in the way moves it too (labels never cover pins)', () => {
    const icon = { id: 'p1', box: { x0: 480, y0: 270, x1: 500, y1: 300 } };
    expect(chooseVisibleLabels([along], viewport, [icon]).get('along:r')).not.toBe(0);
  });

  it('a name already printed by a pin is not printed again along the line', () => {
    const pin: LabelCandidate = { id: 'pin:x', pri: 1, weight: 1, name: 'the river', boxes: [{ x0: 0, y0: 0, x1: 40, y1: 10 }] };
    expect(chooseVisibleLabels([along, pin], viewport).has('along:r')).toBe(false);
  });
});
