/**
 * compareCodePoints: an id tie by Unicode code point, never by UTF-16 code
 * unit, and every tie that says "by code point" uses it.
 */
import { describe, it, expect } from 'vitest';
import { compareCodePoints } from '../../src/core/code-point';
import { mapPickOrder } from '../../src/tabs/right/auto-open-map';
import { gridOf } from '../../src/core/home-grid';
import { buildNarrativeIndex } from '../../src/middle/writing-helpers';
import type { Element, WorldMap } from '../../src/core/types';

// U+10000 is two code units, D800 DC00; U+FFFF is one. By code point U+FFFF comes first;
// by code unit (`<`) D800 < FFFF puts the astral one first.
const ASTRAL = 'a\u{10000}';
const BMP_HIGH = 'a￿';

describe('compareCodePoints', () => {
  it('orders an astral character after U+E000..U+FFFF, as its code point says', () => {
    expect(compareCodePoints(BMP_HIGH, ASTRAL)).toBe(-1);
    expect(compareCodePoints(ASTRAL, BMP_HIGH)).toBe(1);
    expect(compareCodePoints('a', 'a\u{1F600}')).toBe(-1);
  });

  it('no folding, a prefix first, equal strings 0', () => {
    expect(compareCodePoints('B', 'a')).toBe(-1);
    expect(compareCodePoints('ab', 'abc')).toBe(-1);
    expect(compareCodePoints('abc', 'ab')).toBe(1);
    expect(compareCodePoints(ASTRAL, ASTRAL)).toBe(0);
    expect(compareCodePoints('', '')).toBe(0);
    expect(compareCodePoints('a\u{10000}b', 'a\u{10000}c')).toBe(-1);
  });

  it('every "by code point" tie uses it: the map pick, Home\'s grid, the writing tree\'s cycle cut', () => {
    const map = (id: string): WorldMap => ({ id, type: 'map', name: 'Same', local_updated_at: '2026-01-01T00:00:00Z' }) as WorldMap;
    expect([map(ASTRAL), map(BMP_HIGH)].sort(mapPickOrder([])).map(m => m.id)).toEqual([BMP_HIGH, ASTRAL]);

    const g = gridOf([{ id: ASTRAL, type: 'x' }, { id: BMP_HIGH, type: 'x' }], [], 4);
    expect(g.cells.find(c => c.id === BMP_HIGH)!.col).toBe(0);
    expect(g.cells.find(c => c.id === ASTRAL)!.col).toBe(1);

    const n = (id: string, parent: string): Element =>
      ({ id, type: 'narrative', name: 'Twin', supertype: 'Chapter', parent_narrative: parent, order: 1, local_updated_at: '2026-01-01T00:00:00Z' }) as unknown as Element;
    const idx = buildNarrativeIndex([n(ASTRAL, BMP_HIGH), n(BMP_HIGH, ASTRAL)], 'w1');
    expect(idx.roots.map(r => r.el.id)).toEqual([BMP_HIGH]);
  });
});
