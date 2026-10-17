import { describe, it, expect } from 'vitest';
import { inkPoints, inkMinSegment, mapStyleOf, zoneKindOf, segmentHash, MAP_STYLE_IDS, mapStylePreset, inkPatternId, ZONE_KIND_WORDS } from '../../src/core/map-ink';

const ring = Array.from({ length: 40 }, (_, i) => {
  const a = (i / 40) * Math.PI * 2;
  return { x: 1000 + 500 * Math.cos(a) + 40 * Math.sin(3 * a), y: 1000 + 400 * Math.sin(a) };
});
const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;

describe('zone kinds (Skeld h20 #6449: the subtype)', () => {
  it('reads the words case-insensitively and trimmed', () => {
    expect(zoneKindOf('Landmass')).toBe('landmass');
    expect(zoneKindOf('  RIVER ')).toBe('river');
  });
  it('reads Route and Path as roads', () => {
    expect(zoneKindOf('Route')).toBe('road');
    expect(zoneKindOf('path')).toBe('road');
  });
  it('leaves any other subtype plain', () => {
    expect(zoneKindOf('Sea lane')).toBeUndefined();
    expect(zoneKindOf('')).toBeUndefined();
    expect(zoneKindOf(undefined)).toBeUndefined();
    expect(zoneKindOf(42)).toBeUndefined();
  });
});

describe('map styles', () => {
  it('a map names ink on parchment', () => {
    expect(mapStyleOf({ atlas_map_style: 'ink' })?.id).toBe('ink');
  });
  it('anything else is plain', () => {
    expect(mapStyleOf({})).toBeUndefined();
    expect(mapStyleOf({ atlas_map_style: 'watercolour' })).toBeUndefined();
    expect(mapStyleOf(null)).toBeUndefined();
  });
});

describe('the ink holds still', () => {
  it('is identical on every draw', () => {
    expect(inkPoints(ring, 2, 0.22, true)).toEqual(inkPoints(ring, 2, 0.22, true));
  });

  it('keeps every stored point', () => {
    const drawn = new Set(inkPoints(ring, 5, 0.22, true).map(key));
    for (const p of ring) expect(drawn.has(key(p))).toBe(true);
  });

  it('an added vertex leaves every other segment untouched', () => {
    const k = 10;
    const added = ring.slice();
    added.splice(k + 1, 0, { x: (ring[k].x + ring[k + 1].x) / 2 + 15, y: (ring[k].y + ring[k + 1].y) / 2 });
    const seg = (pts: typeof ring, i: number) => inkPoints([pts[i], pts[(i + 1) % pts.length]], 2, 0.22, false);
    for (let i = 0; i < ring.length; i++) {
      if (i === k) continue;
      expect(seg(added, i < k ? i : i + 1)).toEqual(seg(ring, i));
    }
  });

  it('zooming in only adds points between the ones already drawn', () => {
    const coarse = inkPoints(ring, inkMinSegment(-1), 0.22, true);
    const fine = new Set(inkPoints(ring, inkMinSegment(1), 0.22, true).map(key));
    expect(coarse.length).toBeGreaterThan(ring.length);
    for (const p of coarse) expect(fine.has(key(p))).toBe(true);
  });

  it('does not depend on which way a segment runs', () => {
    expect(segmentHash(ring[0], ring[1])).toBe(segmentHash(ring[1], ring[0]));
  });

  it('rough 0 draws the stored points straight', () => {
    expect(inkPoints(ring, 2, 0, true)).toBe(ring);
  });

  it('an open line keeps its last point once', () => {
    const line = ring.slice(0, 5);
    const drawn = inkPoints(line, 5, 0.22, false);
    expect(drawn[drawn.length - 1]).toEqual(line[4]);
    expect(drawn.filter(p => key(p) === key(line[4]))).toHaveLength(1);
  });
});

describe('the styles (S424: ink on parchment, modern atlas)', () => {
  it('every style draws every kind, each under its own name', () => {
    for (const id of MAP_STYLE_IDS) {
      const p = mapStylePreset(id)!;
      expect(p.id).toBe(id);
      for (const w of ZONE_KIND_WORDS) expect(p.kinds[zoneKindOf(w)!].kind).toBe(zoneKindOf(w));
    }
  });
  it('a river ends at the coast in every style, and land and water are named for the clip', () => {
    for (const id of MAP_STYLE_IDS) {
      const k = mapStylePreset(id)!.kinds;
      expect(k.river.clipToLand).toBe(true);
      expect(k.landmass.region).toBe('land');
      expect([k.sea.region, k.lake.region]).toEqual(['water', 'water']);
    }
  });
  it('modern atlas draws every line straight', () => {
    for (const t of Object.values(mapStylePreset('atlas')!.kinds)) expect(t.rough).toBe(0);
  });
  it('hatched tells its kinds apart by texture, never by hue (S425)', () => {
    const sepias = new Set(['#28220f', '#3a2c1a', '#5a4a30']);
    const k = mapStylePreset('hatched')!.kinds;
    for (const t of Object.values(k)) expect(sepias.has(t.patternColor ?? t.stroke)).toBe(true);
    const areas = [k.range, k.forest, k.marsh, k.desert, k.territory];
    expect(new Set(areas.map(t => t.pattern)).size).toBe(areas.length);
  });
  it('a pattern in two colours is two patterns', () => {
    expect(inkPatternId('dots', '#3b2a1a')).not.toBe(inkPatternId('dots', '#9a8a6d'));
    expect(inkPatternId('dots', '#9a8a6d')).toMatch(/^[a-z0-9-]+$/i);
  });
});
