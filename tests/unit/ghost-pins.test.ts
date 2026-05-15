/**
 * Ghost pins — pure-helper tests (DESIGN_MAPS.md §3.8).
 *
 * Covers:
 *   - isGhostEligible: SDK-FIELD_SCHEMA-derived membership (character,
 *     creature, object). Map excluded per §1.4.
 *   - computeGhostCandidates: same-location filter, exclude source, exclude
 *     already-pinned, exclude wrong type.
 *   - computeGhostPositions: count, ring geometry, deterministic order.
 */

import { describe, it, expect } from 'vitest';
import {
  computeGhostCandidates,
  computeGhostPositions,
  isGhostEligible,
  GHOST_RADIUS_PX,
} from '../../src/tabs/right/ghost-pins';
import type { Element, ElementType } from '../../src/core/types';

function mkEl(opts: { id: string; type: ElementType; name?: string; location?: string }): Element {
  const el: Element = {
    id: opts.id,
    type: opts.type,
    name: opts.name ?? opts.id,
    local_updated_at: '2026-05-15T00:00:00Z',
  };
  if (opts.location !== undefined) (el as Record<string, unknown>).location = opts.location;
  return el;
}

function mkPin(opts: { id: string; element_id: string; map_id: string; x?: number; y?: number }): Element {
  return {
    id: opts.id,
    type: 'pin',
    name: '',
    local_updated_at: '2026-05-15T00:00:00Z',
    element_id: opts.element_id,
    map_id: opts.map_id,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
  } as Element;
}

describe('isGhostEligible — SDK FIELD_SCHEMA driven', () => {
  it('includes character, creature, object (types with location single_link)', () => {
    expect(isGhostEligible('character')).toBe(true);
    expect(isGhostEligible('creature')).toBe(true);
    expect(isGhostEligible('object')).toBe(true);
  });

  it('excludes map (§1.4 — pins do not target maps)', () => {
    expect(isGhostEligible('map')).toBe(false);
  });

  it('excludes location (no `location` field — has `parent_location` instead)', () => {
    expect(isGhostEligible('location')).toBe(false);
  });

  it('excludes pin (no location field; pins live on maps)', () => {
    expect(isGhostEligible('pin')).toBe(false);
  });
});

describe('computeGhostCandidates — eligibility rules', () => {
  it('returns elements with same `location` as the source pin element', () => {
    const source = mkEl({ id: 's', type: 'character', name: 'Source', location: 'loc-1' });
    const sibling = mkEl({ id: 'a', type: 'character', name: 'A', location: 'loc-1' });
    const other = mkEl({ id: 'b', type: 'character', name: 'B', location: 'loc-2' });
    const sourcePin = mkPin({ id: 'p1', element_id: 's', map_id: 'm1' });

    const ghosts = computeGhostCandidates('s', 'm1', [source, sibling, other, sourcePin]);
    expect(ghosts.map(g => g.id)).toEqual(['a']);
  });

  it('excludes the source element itself', () => {
    // Two characters both at loc-1, but source character could match itself by
    // location. Source must be filtered out.
    const source = mkEl({ id: 's', type: 'character', location: 'loc-1' });
    const ghost = mkEl({ id: 'g', type: 'character', location: 'loc-1' });
    expect(computeGhostCandidates('s', 'm1', [source, ghost]).map(g => g.id)).toEqual(['g']);
  });

  it('excludes elements that already have a real pin on this map', () => {
    const source = mkEl({ id: 's', type: 'character', location: 'loc-1' });
    const alreadyPinned = mkEl({ id: 'pinned', type: 'character', location: 'loc-1' });
    const notPinned = mkEl({ id: 'free', type: 'character', location: 'loc-1' });
    const sourcePin = mkPin({ id: 'p-s', element_id: 's', map_id: 'm1' });
    const realPin = mkPin({ id: 'p-pinned', element_id: 'pinned', map_id: 'm1' });

    const ghosts = computeGhostCandidates('s', 'm1', [source, alreadyPinned, notPinned, sourcePin, realPin]);
    expect(ghosts.map(g => g.id)).toEqual(['free']);
  });

  it('elements pinned on OTHER maps still qualify', () => {
    const source = mkEl({ id: 's', type: 'character', location: 'loc-1' });
    const otherMapPinned = mkEl({ id: 'other-pinned', type: 'character', location: 'loc-1' });
    const sourcePin = mkPin({ id: 'p-s', element_id: 's', map_id: 'm1' });
    const elsewherePin = mkPin({ id: 'p-other', element_id: 'other-pinned', map_id: 'm2' });

    const ghosts = computeGhostCandidates('s', 'm1', [source, otherMapPinned, sourcePin, elsewherePin]);
    expect(ghosts.map(g => g.id)).toEqual(['other-pinned']);
  });

  it('skips elements of ineligible types (e.g. Location)', () => {
    const source = mkEl({ id: 's', type: 'character', location: 'loc-1' });
    // Locations have parent_location, not location — they should never appear
    // as ghost candidates even if matched by some quirk.
    const sibling = mkEl({ id: 'a', type: 'character', location: 'loc-1' });
    // A Map element with location: 'loc-1' — must be excluded per §1.4.
    const mapAtLoc = mkEl({ id: 'm-loc', type: 'map', location: 'loc-1' });
    expect(computeGhostCandidates('s', 'm1', [source, sibling, mapAtLoc]).map(g => g.id)).toEqual(['a']);
  });

  it('returns [] when source element has no `location` set', () => {
    const source = mkEl({ id: 's', type: 'character' }); // no location field
    const other = mkEl({ id: 'a', type: 'character', location: 'loc-1' });
    expect(computeGhostCandidates('s', 'm1', [source, other])).toEqual([]);
  });

  it('returns [] when no other elements share the location', () => {
    const source = mkEl({ id: 's', type: 'character', location: 'loc-1' });
    expect(computeGhostCandidates('s', 'm1', [source])).toEqual([]);
  });

  it('returns [] when source element does not exist', () => {
    const other = mkEl({ id: 'a', type: 'character', location: 'loc-1' });
    expect(computeGhostCandidates('missing', 'm1', [other])).toEqual([]);
  });

  it('Location source: uses source.id as the locId — ghosts all elements anchored to it', () => {
    // Captain's bug from session 211 smoke: right-click on a Location pin
    // said "no location set" because Location elements have parent_location,
    // not location. The fix: for Location sources, the locId IS the source's
    // own id (which is what other elements' `location` fields point at).
    const loc = mkEl({ id: 'eldoria', type: 'location' });
    const charA = mkEl({ id: 'a', type: 'character', name: 'A', location: 'eldoria' });
    const charB = mkEl({ id: 'b', type: 'character', name: 'B', location: 'eldoria' });
    const charElsewhere = mkEl({ id: 'c', type: 'character', name: 'C', location: 'other' });
    const sourcePin = mkPin({ id: 'p-loc', element_id: 'eldoria', map_id: 'm1' });

    const ghosts = computeGhostCandidates('eldoria', 'm1', [loc, charA, charB, charElsewhere, sourcePin]);
    expect(ghosts.map(g => g.id).sort()).toEqual(['a', 'b']);
  });

  it('Location source: ghosts mixed eligible types (character/creature/object)', () => {
    const loc = mkEl({ id: 'place', type: 'location' });
    const char = mkEl({ id: 'char', type: 'character', location: 'place' });
    const crea = mkEl({ id: 'crea', type: 'creature', location: 'place' });
    const obj = mkEl({ id: 'obj', type: 'object', location: 'place' });
    const sourcePin = mkPin({ id: 'sp', element_id: 'place', map_id: 'm1' });
    expect(computeGhostCandidates('place', 'm1', [loc, char, crea, obj, sourcePin]).map(g => g.id).sort())
      .toEqual(['char', 'crea', 'obj']);
  });
});

describe('computeGhostPositions — geometry', () => {
  it('returns [] for count = 0', () => {
    expect(computeGhostPositions(100, 100, 0)).toEqual([]);
  });

  it('places single ghost above source (12 o\'clock)', () => {
    const [p] = computeGhostPositions(100, 100, 1, 50);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(50, 5);   // Y - radius (up in storage coords is also negative-Y here)
  });

  it('places N ghosts at evenly-spaced angles', () => {
    const positions = computeGhostPositions(100, 100, 4, 50);
    expect(positions).toHaveLength(4);
    // i=0: top (x=100, y=50)
    expect(positions[0].x).toBeCloseTo(100, 5);
    expect(positions[0].y).toBeCloseTo(50, 5);
    // i=1: right (x=150, y=100)
    expect(positions[1].x).toBeCloseTo(150, 5);
    expect(positions[1].y).toBeCloseTo(100, 5);
    // i=2: bottom (x=100, y=150)
    expect(positions[2].x).toBeCloseTo(100, 5);
    expect(positions[2].y).toBeCloseTo(150, 5);
    // i=3: left (x=50, y=100)
    expect(positions[3].x).toBeCloseTo(50, 5);
    expect(positions[3].y).toBeCloseTo(100, 5);
  });

  it('uses the default radius constant when not specified', () => {
    const [p] = computeGhostPositions(0, 0, 1);
    // First ghost at top → x = 0, y = -GHOST_RADIUS_PX
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(-GHOST_RADIUS_PX, 5);
  });

  it('GHOST_RADIUS_PX is tuned to the close-around target (≤50)', () => {
    // Session 211 smoke: Captain felt the original 70px too far. 45 is the
    // current target. Test sets a ceiling so future tuning past 50 has to
    // come back and update intent.
    expect(GHOST_RADIUS_PX).toBeLessThanOrEqual(50);
    expect(GHOST_RADIUS_PX).toBeGreaterThan(20);
  });

  it('is deterministic — same inputs, same outputs', () => {
    const a = computeGhostPositions(50, 50, 5, 30);
    const b = computeGhostPositions(50, 50, 5, 30);
    expect(a).toEqual(b);
  });
});
