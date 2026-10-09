/**
 * The home strip's layout (#121, S382). Skeld's pre-smoke on Moppetopia found
 * "Admiral Splashworth" printed over the next label: the old layout kept one
 * right edge per row, reserved a flipped label by a different test than the
 * one the draw used, and dropped an overflow dot on whatever row was least
 * crowded, labels included. These lock the property instead: on every row,
 * no label touches a glyph or another label, and every node is placed.
 */

import { describe, it, expect } from 'vitest';
import { layoutStrip, type StripInput } from '../../src/visualization/timeline/chart-static';

const LABEL_OFFSET = 0.7;

function spans(nodes: readonly StripInput[], cssW: number, maxLevel: number) {
  const out = layoutStrip(nodes, cssW, maxLevel);
  return out.map((p, i) => {
    const n = nodes[i];
    const g = n.size / 2;
    const off = n.size * LABEL_OFFSET;
    const glyph = { a: n.x - g, b: n.x + g };
    const label = p.side === 'right' ? { a: n.x + off, b: n.x + off + n.labelW }
      : p.side === 'left' ? { a: n.x - off - n.labelW, b: n.x - off }
      : null;
    return { i, level: p.level, glyph, label };
  });
}

/** Every pair on one row where a label meets a glyph or a label: the defect, by ink. */
function clashes(nodes: readonly StripInput[], cssW: number, maxLevel: number): string[] {
  const s = spans(nodes, cssW, maxLevel);
  const hit = (p: { a: number; b: number }, q: { a: number; b: number }): boolean => p.a < q.b && p.b > q.a;
  const out: string[] = [];
  for (const u of s) {
    if (!u.label) continue;
    if (u.label.a < 0 || u.label.b > cssW) out.push(`${u.i} label leaves the canvas`);
    for (const v of s) {
      if (v.i === u.i || v.level !== u.level) continue;
      if (hit(u.label, v.glyph)) out.push(`${u.i} label over ${v.i} glyph`);
      if (v.label && v.i > u.i && hit(u.label, v.label)) out.push(`${u.i} label over ${v.i} label`);
    }
  }
  return out;
}

/** mulberry32: a seeded strip, so a failure names its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomStrip(seed: number, count: number, cssW: number): StripInput[] {
  const r = rng(seed);
  const nodes = Array.from({ length: count }, () => {
    const keep = r() < 0.2;
    return { x: 18 + r() * (cssW - 36), size: keep ? 19 : 14, labelW: 30 + r() * 110, keep };
  });
  return nodes.sort((a, b) => a.x - b.x);
}

describe('layoutStrip', () => {
  it('places every node, and on no row does a label touch a glyph or a label (200 seeded strips, 230 to 900px)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const cssW = [230, 390, 520, 900][seed % 4];
      const nodes = randomStrip(seed, 8 + (seed % 40), cssW);
      const out = layoutStrip(nodes, cssW, 2);
      expect(out).toHaveLength(nodes.length);
      expect(clashes(nodes, cssW, 2), `seed ${seed} at ${cssW}px`).toEqual([]);
    }
  });

  it('plain names give way before kept ones', () => {
    // Rows 0 and 1 hold kept names over x 150; rows -1, 2, -2 plain ones. The
    // glyph that has nowhere clear lands on a plain row.
    const nodes: StripInput[] = [
      { x: 100, size: 19, labelW: 200, keep: true },
      { x: 100, size: 19, labelW: 200, keep: true },
      ...Array.from({ length: 3 }, () => ({ x: 100, size: 14, labelW: 200 })),
      { x: 150, size: 14, labelW: 40 },
    ];
    const out = layoutStrip(nodes, 900, 2);
    expect(out[0].side).toBe('right');
    expect(out[1].side).toBe('right');
    expect([-1, 2, -2]).toContain(out[5].level);
    expect(clashes(nodes, 900, 2)).toEqual([]);
  });

  it('kept names (anchors, cast) take their labels before earlier plain names', () => {
    // A plain name dated first would take the midline row ahead of the anchor.
    const nodes: StripInput[] = [
      { x: 20, size: 14, labelW: 200 },
      { x: 60, size: 19, labelW: 60, keep: true },
    ];
    expect(layoutStrip(nodes, 300, 0)).toEqual([{ level: 0, side: null }, { level: 0, side: 'right' }]);
  });

  it('a label is reserved on the side it draws on (the old layout reserved left and drew right within 14px of the edge)', () => {
    // Ends at 374.8 on a 400px canvas: the old reservation (with its +14 pad)
    // called that a flip and kept the row free ahead of the dot, the old draw
    // printed it to the right, and the next node landed under the name.
    const cssW = 400;
    const nodes: StripInput[] = [
      { x: 300, size: 14, labelW: 65 },
      { x: 330, size: 14, labelW: 10 },
    ];
    const out = layoutStrip(nodes, cssW, 2);
    expect(out[0]).toEqual({ level: 0, side: 'right' });
    expect(out[1].level).not.toBe(0);
    expect(clashes(nodes, cssW, 2)).toEqual([]);
  });

  it('a name with no room on the right hangs left', () => {
    const nodes: StripInput[] = [{ x: 300, size: 14, labelW: 120 }];
    expect(layoutStrip(nodes, 400, 2)).toEqual([{ level: 0, side: 'left' }]);
  });

  it('a sparse strip keeps every label on the midline, to the right', () => {
    const nodes: StripInput[] = [
      { x: 20, size: 14, labelW: 50 },
      { x: 200, size: 14, labelW: 50 },
      { x: 400, size: 19, labelW: 80 },
    ];
    expect(layoutStrip(nodes, 900, 2)).toEqual([
      { level: 0, side: 'right' }, { level: 0, side: 'right' }, { level: 0, side: 'right' },
    ]);
  });

  it('when every row is full, the node still lands, and the labels it would cover give way', () => {
    // Five rows (maxLevel 2), each holding one long label across x 100..300,
    // then a sixth node at x 150 with nowhere to go.
    const nodes: StripInput[] = [
      ...Array.from({ length: 5 }, () => ({ x: 100, size: 14, labelW: 200 })),
      { x: 150, size: 14, labelW: 40 },
    ];
    const out = layoutStrip(nodes, 900, 2);
    expect(out).toHaveLength(6);
    expect(out[5].side).toBeNull();
    expect(clashes(nodes, 900, 2)).toEqual([]);
    expect(out.filter(p => p.side !== null)).toHaveLength(4);
  });
});
