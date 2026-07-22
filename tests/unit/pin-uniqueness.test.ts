/**
 * ONE ELEMENT, ONE PIN, ONE MAP (S307).
 *
 * The rule Captain reported broken: drag a character onto a map, then use
 * [+pin], and you got a SECOND pin for the same character on the same map.
 * Nothing anywhere enforced it — four UI paths and the import applier all
 * created pins with no dedupe.
 *
 * These test the PREDICATE. The store-level guard that consumes it is
 * exercised in `folder-store.pin-uniqueness.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { findDuplicatePin } from '../../src/core/pin-uniqueness';
import type { Element, Pin } from '../../src/core/types';

function pin(id: string, elementId: string, mapId: string): Pin {
  return { id, type: 'pin', name: id, element_id: elementId, map_id: mapId, x: 0, y: 0 } as Pin;
}

describe('findDuplicatePin', () => {
  it('finds the pin already occupying (element, map)', () => {
    const existing: Element[] = [pin('pin-1', 'char-1', 'map-1')];
    const dupe = findDuplicatePin({ element_id: 'char-1', map_id: 'map-1' }, existing);
    expect(dupe?.id).toBe('pin-1');
  });

  it('ALLOWS the same element on a DIFFERENT map', () => {
    // The rule is per-map, not per-element. This is the case the guard must
    // never block — a character legitimately appears on several maps.
    const existing: Element[] = [pin('pin-1', 'char-1', 'map-1')];
    expect(findDuplicatePin({ element_id: 'char-1', map_id: 'map-2' }, existing)).toBeUndefined();
  });

  it('ALLOWS a different element on the same map', () => {
    const existing: Element[] = [pin('pin-1', 'char-1', 'map-1')];
    expect(findDuplicatePin({ element_id: 'char-2', map_id: 'map-1' }, existing)).toBeUndefined();
  });

  it('exempts the candidate\'s own record (a re-write is not a duplicate of itself)', () => {
    const existing: Element[] = [pin('pin-1', 'char-1', 'map-1')];
    expect(findDuplicatePin({ element_id: 'char-1', map_id: 'map-1' }, existing, 'pin-1')).toBeUndefined();
  });

  it('ignores non-pin elements that happen to carry the same fields', () => {
    // A marker carries a map_id too. Only pins collide with pins.
    const existing = [
      { id: 'm-1', type: 'marker', name: 'm', element_id: 'char-1', map_id: 'map-1' } as unknown as Element,
    ];
    expect(findDuplicatePin({ element_id: 'char-1', map_id: 'map-1' }, existing)).toBeUndefined();
  });

  it('treats an unplaced pin (no element or no map) as nothing to collide with', () => {
    const existing: Element[] = [pin('pin-1', 'char-1', 'map-1')];
    expect(findDuplicatePin({ map_id: 'map-1' }, existing)).toBeUndefined();
    expect(findDuplicatePin({ element_id: 'char-1' }, existing)).toBeUndefined();
  });
});
