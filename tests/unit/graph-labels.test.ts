/**
 * #141 (S387): the Web tab's label pass. A label takes the first clear side
 * of its node or waits for hover; the subject and the selection always print,
 * on their least crowded side. Labels yield, nodes never vanish.
 */
import { describe, it, expect } from 'vitest';
import { placeGraphLabels, labelBoxFor, GRAPH_LABEL_SIDES, type GraphLabelItem, type Box } from '../../src/tabs/right/graph-labels';

const frame = { w: 400, h: 400 };
const node = (id: string, cx: number, cy: number, priority = 0, extra: Partial<GraphLabelItem> = {}): GraphLabelItem =>
  ({ id, cx, cy, r: 18, w: 80, h: 12, priority, ...extra });

const overlap = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
const hitsCircle = (b: Box, n: GraphLabelItem) => {
  const nx = Math.min(Math.max(n.cx, b.left), b.right);
  const ny = Math.min(Math.max(n.cy, b.top), b.bottom);
  return (nx - n.cx) ** 2 + (ny - n.cy) ** 2 < n.r ** 2;
};

describe('placeGraphLabels', () => {
  it('a lone node labels below', () => {
    expect(placeGraphLabels([node('a', 200, 200)], frame).get('a')).toBe('below');
  });

  it('a node right under it pushes the label to the next clear side', () => {
    const sides = placeGraphLabels([node('a', 200, 200, 1), node('b', 200, 240)], frame);
    expect(sides.get('a')).toBe('right');
  });

  it('the frame edge counts: a node at the bottom labels elsewhere', () => {
    expect(placeGraphLabels([node('a', 200, 385)], frame).get('a')).not.toBe('below');
  });

  it('the higher priority speaks first, the other yields', () => {
    // Two nodes side by side, close enough that their below labels collide.
    const sides = placeGraphLabels([node('low', 240, 200, 1), node('high', 200, 200, 5)], frame);
    expect(sides.get('high')).toBe('below');
    expect(sides.get('low')).not.toBe('below');
  });

  it('with no clear side the label waits for hover, but the subject always prints', () => {
    // A node boxed in on every side and corner.
    const ring = [[0, -40], [0, 40], [-44, 0], [44, 0], [-40, -40], [40, -40], [-40, 40], [40, 40]]
      .map(([dx, dy], i) => node(`n${i}`, 200 + dx, 200 + dy, 10, { w: 0, h: 0 }));
    expect(placeGraphLabels([...ring, node('boxed', 200, 200)], frame).get('boxed')).toBeNull();
    expect(placeGraphLabels([...ring, node('subject', 200, 200, 0, { always: true })], frame).get('subject')).not.toBeNull();
  });

  it('on a crowded random scene, no placed label covers another label or any node', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let scene = 0; scene < 20; scene++) {
      const items = Array.from({ length: 40 }, (_, i) =>
        node(`n${i}`, 20 + rand() * 360, 20 + rand() * 360, Math.floor(rand() * 10), { w: 40 + rand() * 80 }));
      const sides = placeGraphLabels(items, frame);
      const boxes = items.filter(it => sides.get(it.id)).map(it => ({ it, b: labelBoxFor(it, sides.get(it.id)!) }));
      expect(boxes.length).toBeGreaterThan(0);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i].b, boxes[j].b)).toBe(false);
        for (const n of items) if (n !== boxes[i].it) expect(hitsCircle(boxes[i].b, n)).toBe(false);
        const b = boxes[i].b;
        expect(b.left >= 0 && b.top >= 0 && b.right <= frame.w && b.bottom <= frame.h).toBe(true);
      }
    }
  });

  it('every side keeps the label off its own node', () => {
    const it0 = node('a', 200, 200);
    for (const side of GRAPH_LABEL_SIDES) expect(hitsCircle(labelBoxFor(it0, side), it0)).toBe(false);
  });
});
