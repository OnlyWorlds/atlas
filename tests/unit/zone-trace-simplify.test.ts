/**
 * A traced stroke goes into the world as the few points that carry its shape
 * (S423): `simplifyPath`, Douglas-Peucker on an open run.
 */

import { describe, it, expect } from 'vitest';
import { simplifyPath, simplifyStroke, distanceToSegment } from '../../src/visualization/leaflet-2d/ZoneGeometry';

// a wobbly hand stroke: 300 points along a wavy arc
const stroke = Array.from({ length: 300 }, (_, i) => {
  const t = i / 299;
  return { x: 100 + 800 * t, y: 500 + 120 * Math.sin(t * 6) + 3 * Math.sin(i * 1.7) };
});

describe('simplifyPath', () => {
  it('keeps both ends', () => {
    const out = simplifyPath(stroke, 4);
    expect(out[0]).toEqual(stroke[0]);
    expect(out[out.length - 1]).toEqual(stroke[stroke.length - 1]);
  });

  it('every dropped point stays within the tolerance of the kept line', () => {
    const tol = 4;
    const out = simplifyPath(stroke, tol);
    for (const p of stroke) {
      let best = Infinity;
      for (let i = 0; i < out.length - 1; i++) best = Math.min(best, distanceToSegment(p, out[i], out[i + 1]));
      expect(best).toBeLessThanOrEqual(tol + 1e-9);
    }
  });

  it('a hand wobble near the tolerance survives the simplification alone', () => {
    expect(simplifyPath(stroke, 4).length).toBeGreaterThan(60);
  });
});

describe('simplifyStroke', () => {
  it('a hand stroke comes down to a few dozen points', () => {
    const n = simplifyStroke(stroke, 4).length;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(40);
  });

  it('keeps both ends and the shape within the tolerance plus the wobble', () => {
    const out = simplifyStroke(stroke, 4);
    expect(out[0]).toEqual(stroke[0]);
    expect(out[out.length - 1]).toEqual(stroke[stroke.length - 1]);
    for (const p of stroke) {
      let best = Infinity;
      for (let i = 0; i < out.length - 1; i++) best = Math.min(best, distanceToSegment(p, out[i], out[i + 1]));
      expect(best).toBeLessThanOrEqual(4 + 3 + 1e-9);
    }
  });

  it('a straight run is its two ends', () => {
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i * 10, y: i * 5 }));
    expect(simplifyPath(line, 1)).toEqual([line[0], line[49]]);
  });

  it('two points or fewer come back as they are', () => {
    expect(simplifyPath([{ x: 1, y: 2 }], 5)).toEqual([{ x: 1, y: 2 }]);
    expect(simplifyPath([], 5)).toEqual([]);
  });
});
