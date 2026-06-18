/**
 * Import payload parse + format detection (DESIGN_IMPORT.md "Format model").
 *
 * Covers:
 *   - reject non-object / array / empty
 *   - full-world detection (has "World")
 *   - loose detection (type-keyed lists, no World)
 *   - PascalCase bucket keys lowercased to ElementType
 *   - unknown buckets routed aside (not imported)
 *   - non-array under a known type → unknown bucket
 *   - element count
 */

import { describe, it, expect } from 'vitest';
import { parsePayload } from '../../src/import/parse';

describe('parsePayload — rejects non-OnlyWorlds shapes', () => {
  it('rejects null / primitives', () => {
    expect(parsePayload(null).ok).toBe(false);
    expect(parsePayload('nope').ok).toBe(false);
    expect(parsePayload(42).ok).toBe(false);
  });

  it('rejects a top-level array', () => {
    const r = parsePayload([{ name: 'x' }]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/object/i);
  });

  it('rejects an object with no World and no element buckets', () => {
    const r = parsePayload({ foo: 'bar', notes: [] });
    expect(r.ok).toBe(false);
    expect(r.unknownBuckets).toContain('foo');
  });
});

describe('parsePayload — format detection', () => {
  it('detects full-world from a World key', () => {
    const r = parsePayload({ World: { api_key: '0000000038', name: 'Blood Meridian' }, Character: [{ name: 'The Kid' }] });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('full-world');
    expect(r.world).toEqual({ api_key: '0000000038', name: 'Blood Meridian' });
    expect(r.totalElements).toBe(1);
  });

  it('treats a World-only payload as a valid (empty) full-world', () => {
    const r = parsePayload({ World: { api_key: 'x', name: 'Empty' } });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('full-world');
    expect(r.totalElements).toBe(0);
  });

  it('detects loose from type-keyed lists with no World', () => {
    const r = parsePayload({ Character: [{ name: 'A' }, { name: 'B' }], Location: [{ name: 'L' }] });
    expect(r.ok).toBe(true);
    expect(r.format).toBe('loose');
    expect(r.totalElements).toBe(3);
  });
});

describe('parsePayload — bucketing', () => {
  it('lowercases PascalCase bucket keys to ElementType', () => {
    const r = parsePayload({ Character: [{ name: 'A' }], Object: [{ name: 'O' }] });
    expect([...r.byType.keys()].sort()).toEqual(['character', 'object']);
  });

  it('routes unknown buckets aside without importing them', () => {
    const r = parsePayload({ Character: [{ name: 'A' }], Widgets: [{ name: 'W' }] });
    expect(r.byType.has('character' as never)).toBe(true);
    expect(r.unknownBuckets).toEqual(['Widgets']);
    expect(r.totalElements).toBe(1);
  });

  it('treats a known type with a non-array value as an unknown bucket', () => {
    const r = parsePayload({ Character: { name: 'oops' } });
    expect(r.ok).toBe(false);
    expect(r.unknownBuckets).toContain('Character');
  });

  it('drops non-object entries inside a type array', () => {
    const r = parsePayload({ Character: [{ name: 'A' }, 'garbage', null, ['x']] });
    expect(r.byType.get('character' as never)?.length).toBe(1);
    expect(r.totalElements).toBe(1);
  });
});
