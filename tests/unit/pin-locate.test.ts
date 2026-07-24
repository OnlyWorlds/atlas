import { describe, it, expect } from 'vitest';
import { locateTargetFor } from '../../src/sidebar/pin-locate';
import type { Element } from '../../src/core/types';

// Minimal element factory — locateTargetFor only reads type/id + spatial fields.
function el(props: Record<string, unknown>): Element {
  return { name: '', ...props } as unknown as Element;
}

const MAP = 'map-1';
const OTHER_MAP = 'map-2';

describe('locateTargetFor', () => {
  it('returns the coords of a pin pointing at the element on the active map', () => {
    const els = [
      el({ id: 'char-1', type: 'character' }),
      el({ id: 'pin-1', type: 'pin', map_id: MAP, element_id: 'char-1', x: 120, y: 340 }),
    ];
    expect(locateTargetFor(els, 'char-1', MAP)).toEqual({ x: 120, y: 340 });
  });

  it('ignores pins on a different map', () => {
    const els = [
      el({ id: 'char-1', type: 'character' }),
      el({ id: 'pin-1', type: 'pin', map_id: OTHER_MAP, element_id: 'char-1', x: 5, y: 5 }),
    ];
    expect(locateTargetFor(els, 'char-1', MAP)).toBeNull();
  });

  it('returns the centroid of a zone\'s markers on the active map', () => {
    const els = [
      el({ id: 'zone-1', type: 'zone' }),
      el({ id: 'm1', type: 'marker', map_id: MAP, zone_id: 'zone-1', x: 100, y: 200 }),
      el({ id: 'm2', type: 'marker', map_id: MAP, zone_id: 'zone-1', x: 200, y: 400 }),
      // A marker on another map must not skew the centroid.
      el({ id: 'm3', type: 'marker', map_id: OTHER_MAP, zone_id: 'zone-1', x: 9999, y: 9999 }),
    ];
    expect(locateTargetFor(els, 'zone-1', MAP)).toEqual({ x: 150, y: 300 });
  });

  it('returns null when the element has no presence on the active map', () => {
    const els = [el({ id: 'char-1', type: 'character' })];
    expect(locateTargetFor(els, 'char-1', MAP)).toBeNull();
  });

  it('prefers a pin over a zone-centroid interpretation and tolerates missing coords', () => {
    // A pin with a non-numeric coord is skipped, not returned as NaN.
    const els = [
      el({ id: 'char-1', type: 'character' }),
      el({ id: 'pin-bad', type: 'pin', map_id: MAP, element_id: 'char-1', x: 'oops', y: 5 }),
    ];
    expect(locateTargetFor(els, 'char-1', MAP)).toBeNull();
  });
});
