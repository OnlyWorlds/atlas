/**
 * The density layer's pure kernels. The DOM pass is exercised by the
 * maps e2e; these lock the placement rules that make a 200-pin map legible.
 */

import { describe, it, expect } from 'vitest';
import {
  chooseVisibleLabels,
  pinLabelPlacements,
  medianNearestNeighbour,
  pinScaleForSpacing,
  labelNameKey,
  PIN_SCALE_MIN,
  type Box,
  type LabelCandidate,
} from '../../src/tabs/right/map-label-density';

const VIEW = { w: 1000, h: 800 };
const box = (x0: number, y0: number, w = 60, h = 16): Box => ({ x0, y0, x1: x0 + w, y1: y0 + h });
const cand = (id: string, b: Box, extra: Partial<LabelCandidate> = {}): LabelCandidate =>
  ({ id, pri: 1, weight: 0, boxes: [b], ...extra });

describe('chooseVisibleLabels', () => {
  it('keeps every label that has room', () => {
    const chosen = chooseVisibleLabels([cand('a', box(0, 0)), cand('b', box(0, 100)), cand('c', box(200, 0))], VIEW);
    expect([...chosen.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect([...chosen.values()]).toEqual([0, 0, 0]);
  });

  it('drops the lower-priority label of a colliding pair', () => {
    const chosen = chooseVisibleLabels([cand('zone', box(10, 10), { pri: 2 }), cand('pin', box(20, 12), { pri: 1 })], VIEW);
    expect(chosen.has('pin')).toBe(true);
    expect(chosen.has('zone')).toBe(false);
  });

  it('within a tier the heavier label wins, ties broken by id for determinism', () => {
    const chosen = chooseVisibleLabels([cand('light', box(10, 10), { weight: 1 }), cand('heavy', box(20, 12), { weight: 9 })], VIEW);
    expect([...chosen.keys()]).toEqual(['heavy']);
    const tie = chooseVisibleLabels([cand('b', box(10, 10)), cand('a', box(20, 12))], VIEW);
    expect([...tie.keys()]).toEqual(['a']);
  });

  it('a label ending flush against another is a collision (the 4px pad)', () => {
    const chosen = chooseVisibleLabels([cand('a', box(0, 0, 60)), cand('b', box(62, 0, 60))], VIEW);
    expect(chosen.size).toBe(1);
    const apart = chooseVisibleLabels([cand('a', box(0, 0, 60)), cand('b', box(70, 0, 60))], VIEW);
    expect(apart.size).toBe(2);
  });

  it('falls through a label\'s placements in order and reports which one it took', () => {
    const blocker = cand('blocker', box(0, 20), { pri: 0 });
    const c: LabelCandidate = { id: 'c', pri: 1, weight: 0, boxes: [box(0, 20), box(0, 40), box(0, 60)] };
    const chosen = chooseVisibleLabels([blocker, c], VIEW);
    expect(chosen.get('c')).toBe(1);
  });

  it('never covers a pin icon that is not its own', () => {
    const icon = { id: 'p1', box: box(100, 100, 32, 32) };
    const own = cand('own', box(90, 130), { owner: 'p1' });
    const other = cand('other', box(110, 110), { owner: 'p2' });
    const chosen = chooseVisibleLabels([own, other], VIEW, [icon]);
    expect(chosen.has('own')).toBe(true);
    expect(chosen.has('other')).toBe(false);
  });

  it('a heavy label never covers another pin: it takes a clear side or is culled (show\'s rule)', () => {
    const icon = { id: 'p1', box: box(100, 100, 32, 32) };
    const heavy = cand('a', box(110, 110), { owner: 'x', weight: 1000, pri: 0 });
    expect(chooseVisibleLabels([heavy], VIEW, [icon]).has('a')).toBe(false);
    const withSide: LabelCandidate = { ...heavy, boxes: [box(110, 110), box(300, 300)] };
    expect(chooseVisibleLabels([withSide], VIEW, [icon]).get('a')).toBe(1);
  });

  it('prints a name once: the pin carries it, its same-name zone stays quiet', () => {
    const pin = cand('pin', box(10, 10), { pri: 1, name: 'snack nebula' });
    const zone = cand('zone', box(400, 400), { pri: 2, name: 'snack nebula' });
    const other = cand('other', box(400, 600), { pri: 2, name: 'crumblefields' });
    expect([...chooseVisibleLabels([zone, pin, other], VIEW).keys()].sort()).toEqual(['other', 'pin']);
  });

  it('a culled pin hands its name to the zone of the same name', () => {
    const blocker = cand('blocker', box(10, 10), { pri: 0 });
    const pin = cand('pin', box(12, 12), { pri: 1, name: 'snack nebula' });
    const zone = cand('zone', box(400, 400), { pri: 2, name: 'snack nebula' });
    expect([...chooseVisibleLabels([blocker, pin, zone], VIEW).keys()].sort()).toEqual(['blocker', 'zone']);
  });

  it('a box across the viewport edge is not taken: another side, else culled', () => {
    const c: LabelCandidate = { id: 'c', pri: 1, weight: 0, boxes: [box(-20, 100), box(40, 100)] };
    expect(chooseVisibleLabels([c], VIEW).get('c')).toBe(1);
    expect(chooseVisibleLabels([cand('edge', box(970, 100))], VIEW).has('edge')).toBe(false);
  });

  it('labels off screen neither compete nor get culled', () => {
    const chosen = chooseVisibleLabels([cand('off', box(-500, -500)), cand('on', box(10, 10))], VIEW);
    expect(chosen.get('off')).toBe(0);
    expect(chosen.get('on')).toBe(0);
  });
});

describe('pinLabelPlacements', () => {
  it('offers below (as measured), right, left, above, each clear of the icon by the gap', () => {
    const icon = box(100, 100, 32, 32);
    const ink = box(96, 139, 40, 14); // below, centred on 116
    const [below, right, left, above] = pinLabelPlacements(ink, icon, 7);
    expect(below).toEqual(ink);
    expect(right.x0).toBe(132 + 7);
    expect(right.y0 + (right.y1 - right.y0) / 2).toBe(116);
    expect(left.x1).toBe(100 - 7);
    expect(above.y1).toBe(100 - 7);
    expect(above.x0 + (above.x1 - above.x0) / 2).toBe(116);
    for (const b of [right, left, above]) {
      expect(b.x1 - b.x0).toBe(40);
      expect(b.y1 - b.y0).toBe(14);
    }
  });
});

describe('medianNearestNeighbour', () => {
  it('is Infinity below two points', () => {
    expect(medianNearestNeighbour([])).toBe(Infinity);
    expect(medianNearestNeighbour([{ x: 1, y: 1 }])).toBe(Infinity);
  });
  it('is the median of each point\'s nearest gap', () => {
    // 0, 10, 20 in a row: gaps 10, 10, 10; a far point at 100: gap 80.
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 100, y: 0 }];
    expect(medianNearestNeighbour(pts)).toBe(10);
  });
});

describe('pinScaleForSpacing', () => {
  it('never grows past 1 and floors at PIN_SCALE_MIN', () => {
    expect(pinScaleForSpacing(1000, 32)).toBe(1);
    expect(pinScaleForSpacing(Infinity, 32)).toBe(1);
    expect(pinScaleForSpacing(1, 32)).toBe(PIN_SCALE_MIN);
  });
  it('lets the icon fill ~70% of the gap between icons (Sikelia at fit: 24px gap → 17px icon)', () => {
    expect(pinScaleForSpacing(24, 32)).toBeCloseTo(0.525, 1);
    expect(pinScaleForSpacing(20, 32)).toBe(0.44);
    expect(pinScaleForSpacing(48, 32)).toBe(1);
  });
});

describe('labelNameKey', () => {
  it('compares names trimmed and case-folded; an empty name is no name', () => {
    expect(labelNameKey('  Snack Nebula ')).toBe('snack nebula');
    expect(labelNameKey('')).toBeUndefined();
    expect(labelNameKey(null)).toBeUndefined();
  });
});
