/**
 * Pure-function tests for zone-drawing helpers.
 *
 * Module-level state + DOM/Leaflet integration are exercised by smoke; only
 * the pure name-resolution helper has unit coverage at this layer.
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
