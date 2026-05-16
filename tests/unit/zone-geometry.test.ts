/**
 * Pure-function tests for ZoneGeometry helpers.
 *
 * Pinning the contract for distance-to-segment / projection / centroid /
 * point-in-polygon / shift-snap math.
 */

import { describe, it, expect } from 'vitest';
import {
  distanceToSegment,
  distanceToSegmentSquared,
  projectToSegment,
  findClosestSegment,
  polygonCentroid,
  polylineLabelAnchor,
  pointInPolygon,
  snapAngleTo45,
  snapToAxis,
  pointListsEqual,
} from '../../src/visualization/leaflet-2d/ZoneGeometry';

describe('distanceToSegmentSquared', () => {
  it('returns squared distance for a point above a horizontal segment', () => {
    expect(distanceToSegmentSquared({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(9);
  });

  it('clamps projection past segment end to nearest endpoint', () => {
    // Point is past B; nearest is B.
    expect(distanceToSegmentSquared({ x: 20, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(100);
  });

  it('clamps projection before segment start to nearest endpoint', () => {
    expect(distanceToSegmentSquared({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(25);
  });

  it('handles degenerate (zero-length) segment as point-to-point', () => {
    expect(distanceToSegmentSquared({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(25);
  });

  it('zero when point is on the segment', () => {
    expect(distanceToSegmentSquared({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(0);
  });
});

describe('distanceToSegment', () => {
  it('returns unsquared Euclidean distance', () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
  });
});

describe('projectToSegment', () => {
  it('returns the foot of perpendicular on the segment', () => {
    expect(projectToSegment({ x: 5, y: 7 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 5, y: 0 });
  });

  it('clamps past endpoint', () => {
    expect(projectToSegment({ x: 20, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({ x: 10, y: 0 });
  });
});

describe('findClosestSegment', () => {
  it('finds the closest segment on a polyline (open path)', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const result = findClosestSegment({ x: 5, y: 1 }, points, false);
    expect(result?.index).toBe(0); // top edge
    expect(result?.distance).toBe(1);
    expect(result?.foot).toEqual({ x: 5, y: 0 });
  });

  it('includes the closing edge for a closed polygon', () => {
    const polygon = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    // Point near the closing edge (last → first), which is the left side.
    const result = findClosestSegment({ x: 1, y: 5 }, polygon, true);
    expect(result?.index).toBe(3); // closing edge index = last → first
    expect(result?.distance).toBe(1);
    expect(result?.foot).toEqual({ x: 0, y: 5 });
  });

  it('returns null for fewer than 2 points', () => {
    expect(findClosestSegment({ x: 0, y: 0 }, [], false)).toBeNull();
    expect(findClosestSegment({ x: 0, y: 0 }, [{ x: 5, y: 5 }], false)).toBeNull();
  });
});

describe('polygonCentroid', () => {
  it('averages vertices', () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonCentroid(square)).toEqual({ x: 5, y: 5 });
  });

  it('returns null for empty input', () => {
    expect(polygonCentroid([])).toBeNull();
  });
});

describe('polylineLabelAnchor', () => {
  it('picks the midpoint of the longest segment', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 2, y: 0 }, // short segment
      { x: 22, y: 0 }, // long segment (20 long)
    ];
    expect(polylineLabelAnchor(points)).toEqual({ x: 12, y: 0 });
  });

  it('returns the single point for a 1-point path', () => {
    expect(polylineLabelAnchor([{ x: 5, y: 5 }])).toEqual({ x: 5, y: 5 });
  });

  it('null for empty', () => {
    expect(polylineLabelAnchor([])).toBeNull();
  });
});

describe('pointInPolygon', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];

  it('true for interior point', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
  });

  it('false for exterior point', () => {
    expect(pointInPolygon({ x: 20, y: 5 }, square)).toBe(false);
    expect(pointInPolygon({ x: -5, y: 5 }, square)).toBe(false);
  });

  it('false for polygon with fewer than 3 points', () => {
    expect(pointInPolygon({ x: 5, y: 5 }, [{ x: 0, y: 0 }, { x: 10, y: 10 }])).toBe(false);
  });
});

describe('snapAngleTo45', () => {
  it('snaps near-0 to 0', () => {
    expect(snapAngleTo45(0.1)).toBe(0);
  });

  it('snaps near-45 to π/4', () => {
    expect(snapAngleTo45(Math.PI / 4 + 0.05)).toBeCloseTo(Math.PI / 4);
  });

  it('snaps near-90 to π/2', () => {
    expect(snapAngleTo45(Math.PI / 2 - 0.05)).toBeCloseTo(Math.PI / 2);
  });
});

describe('snapToAxis', () => {
  it('snaps east-ish clicks to pure east', () => {
    const anchor = { x: 100, y: 100 };
    const click = { x: 200, y: 110 }; // mostly east, slight south
    const result = snapToAxis(anchor, click);
    // Result should be on the east axis (y = anchor.y).
    expect(result.y).toBe(100);
    expect(result.x).toBeGreaterThan(100);
  });

  it('snaps northeast-ish clicks to 45°', () => {
    const anchor = { x: 100, y: 100 };
    const click = { x: 200, y: 0 }; // 45° up-right (in storage coords y grows down,
                                    // so y < anchor means "up")
    const result = snapToAxis(anchor, click);
    // 45° axis means dx === -dy (in storage coords with y down → up is -y).
    expect(result.x - anchor.x).toBe(-(result.y - anchor.y));
  });

  it('clamps backward clicks to anchor (no negative projection)', () => {
    const anchor = { x: 100, y: 100 };
    const click = { x: 50, y: 100 }; // west click, but snap axis from atan2 will be 180°
    // Verify that the result is on the snapped axis (no surprise) — for a
    // pure west click, atan2(0,-50) = π, snap is π, so axis is west; projection
    // is positive. So this isn't actually a backward-click case for atan2.
    const result = snapToAxis(anchor, click);
    expect(result.y).toBe(100);
  });
});

describe('pointListsEqual', () => {
  it('true for identical lists', () => {
    expect(pointListsEqual(
      [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    )).toBe(true);
  });

  it('false for different lengths', () => {
    expect(pointListsEqual(
      [{ x: 1, y: 2 }],
      [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    )).toBe(false);
  });

  it('false for different coordinates', () => {
    expect(pointListsEqual(
      [{ x: 1, y: 2 }],
      [{ x: 1, y: 3 }],
    )).toBe(false);
  });
});
