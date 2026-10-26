/**
 * Pure-function tests for zone-drawing helpers.
 *
 * Only the pure name-resolution helper has unit coverage at this layer.
 *
 * ⚠ CORRECTED. This comment used to claim "module-level state +
 * DOM/Leaflet integration are exercised by smoke". They are not:
 * `smoke.spec.ts` contains no zone anything, and no e2e drives zone EDIT
 * mode at all. The claim survived because it read like coverage — a doc
 * asserting a test that does not exist is worse than no doc, because it
 * stops the next person looking. `zone-edit-mode.ts` (1000+ lines) got its
 * first tests (`zone-edit-snapshot.test.ts`) and still needs the
 * geometry kernels extracted and covered.
 */

import { describe, it, expect } from 'vitest';
import { findUniqueZoneName } from '../../src/tabs/right/zone-drawing';
import type { Zone } from '../../src/core/types';

function zone(name: string): Zone {
  return {
    id: name,
    type: 'zone',
    name,
    local_updated_at: '2026-05-16T00:00:00.000Z',
  };
}

describe('findUniqueZoneName', () => {
  it('returns the base name when nothing is taken', () => {
    expect(findUniqueZoneName('new zone', [])).toBe('new zone');
  });

  it('appends "(2)" when the base is taken', () => {
    expect(findUniqueZoneName('new zone', [zone('new zone')])).toBe('new zone (2)');
  });

  it('walks the numbered series to find a free slot', () => {
    const zones = [zone('new zone'), zone('new zone (2)'), zone('new zone (3)')];
    expect(findUniqueZoneName('new zone', zones)).toBe('new zone (4)');
  });

  it('handles holes in the series (returns the first free)', () => {
    const zones = [zone('new zone'), zone('new zone (3)')];
    expect(findUniqueZoneName('new zone', zones)).toBe('new zone (2)');
  });

  it('treats line and polygon namespaces separately by base', () => {
    const zones = [zone('new zone'), zone('new line')];
    expect(findUniqueZoneName('new zone', zones)).toBe('new zone (2)');
    expect(findUniqueZoneName('new line', zones)).toBe('new line (2)');
  });

  it('respects unrelated names', () => {
    const zones = [zone('Forest'), zone('Lake')];
    expect(findUniqueZoneName('new zone', zones)).toBe('new zone');
  });
});
