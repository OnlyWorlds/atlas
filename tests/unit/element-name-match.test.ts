/**
 * NPM autocomplete matcher tests (DESIGN_MAPS.md §3.7).
 *
 * Covers:
 *   - Category filter (only same-type elements qualify)
 *   - Prefix match (case-insensitive)
 *   - Strict length (exact-match doesn't produce a ghost)
 *   - Empty typed input → null
 *   - Multi-match tiebreaker: latest local_updated_at wins
 *   - Missing local_updated_at sorts last (defensive)
 */

import { describe, it, expect } from 'vitest';
import { findExistingNameMatch } from '../../src/ui/element-name-match';
import type { Element, ElementType } from '../../src/core/types';

function mkEl(opts: { id: string; type: ElementType; name: string; updated?: string }): Element {
  return {
    id: opts.id,
    type: opts.type,
    name: opts.name,
    local_updated_at: opts.updated ?? '2026-01-01T00:00:00Z',
  };
}

describe('findExistingNameMatch — basics', () => {
  it('matches startsWith case-insensitively', () => {
    const els = [mkEl({ id: 'c1', type: 'character', name: 'Aragorn' })];
    expect(findExistingNameMatch('ara', 'character', els)?.id).toBe('c1');
    expect(findExistingNameMatch('ARA', 'character', els)?.id).toBe('c1');
    expect(findExistingNameMatch('A', 'character', els)?.id).toBe('c1');
  });

  it('returns null for empty input', () => {
    const els = [mkEl({ id: 'c1', type: 'character', name: 'Aragorn' })];
    expect(findExistingNameMatch('', 'character', els)).toBeNull();
    expect(findExistingNameMatch('   ', 'character', els)).toBeNull();
  });

  it('returns null when no name starts with the prefix', () => {
    const els = [mkEl({ id: 'c1', type: 'character', name: 'Aragorn' })];
    expect(findExistingNameMatch('boro', 'character', els)).toBeNull();
  });

  it('strict-length: exact-match name does not qualify (no ghost suffix to render)', () => {
    const els = [mkEl({ id: 'c1', type: 'character', name: 'Aragorn' })];
    expect(findExistingNameMatch('Aragorn', 'character', els)).toBeNull();
  });

  it('respects category filter — only same-type elements qualify', () => {
    const els = [
      mkEl({ id: 'c1', type: 'character', name: 'Aragorn' }),
      mkEl({ id: 'l1', type: 'location', name: 'Arnor' }),
    ];
    expect(findExistingNameMatch('Ar', 'character', els)?.id).toBe('c1');
    expect(findExistingNameMatch('Ar', 'location', els)?.id).toBe('l1');
  });
});

describe('findExistingNameMatch — tiebreaker', () => {
  it('multi-match: latest local_updated_at wins', () => {
    const els = [
      mkEl({ id: 'older', type: 'character', name: 'Aragorn', updated: '2026-01-01T00:00:00Z' }),
      mkEl({ id: 'newer', type: 'character', name: 'Aragorn the Second', updated: '2026-05-15T00:00:00Z' }),
      mkEl({ id: 'mid', type: 'character', name: 'Aragorn II', updated: '2026-03-10T00:00:00Z' }),
    ];
    expect(findExistingNameMatch('Ara', 'character', els)?.id).toBe('newer');
  });

  it('missing local_updated_at sorts as oldest (defensive)', () => {
    const els = [
      mkEl({ id: 'stamped', type: 'character', name: 'Aragorn the Second', updated: '2026-01-01T00:00:00Z' }),
      { id: 'no-stamp', type: 'character', name: 'Aragorn The Bold' } as Element,
    ];
    expect(findExistingNameMatch('Ara', 'character', els)?.id).toBe('stamped');
  });
});
