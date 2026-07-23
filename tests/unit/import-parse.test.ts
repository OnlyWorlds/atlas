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

describe('parsePayload — keel world-export envelope (onlyworlds-world-export)', () => {
  // The shape ow.com emits today (keel portal/views.py; canonical, Orrery
  // spec § world-export). Lowercase `world` with id present, nested lowercase
  // `elements`, plus the format/schema_version/exported_at wrapper.
  const envelope = () => ({
    format: 'onlyworlds-world-export',
    schema_version: '0.30.00',
    exported_at: '2026-07-22T19:05:12.662490+00:00',
    world: {
      id: '068e012b-52a9-79bf-8000-26bb67891425',
      name: 'Hyperion',
      created_at: '2025-10-03T18:15:17Z',
      updated_at: '2025-12-21T12:23:37Z',
    },
    elements: {
      ability: [{ type: 'ability', id: 'a1', name: 'Piano Playing', change_seq: 1 }],
      character: [{ type: 'character', id: 'c1', name: 'The Consul' }, { type: 'character', id: 'c2', name: 'Kassad' }],
      marker: [{ type: 'marker', id: 'm1', name: 'Swamps - Point 0' }],
    },
  });

  it('detects the envelope as a full-world and captures the world block WITH its id', () => {
    const r = parsePayload(envelope());
    expect(r.ok).toBe(true);
    expect(r.format).toBe('full-world');
    expect(r.world?.id).toBe('068e012b-52a9-79bf-8000-26bb67891425');
    expect(r.world?.name).toBe('Hyperion');
    expect(r.totalElements).toBe(4);
  });

  it('unwraps the nested lowercase `elements` object into byType', () => {
    const r = parsePayload(envelope());
    expect([...r.byType.keys()].sort()).toEqual(['ability', 'character', 'marker']);
    expect(r.byType.get('character' as never)?.length).toBe(2);
  });

  it('does NOT bucket the wrapper keys (format/schema_version/exported_at) as unknown', () => {
    const r = parsePayload(envelope());
    expect(r.unknownBuckets).toEqual([]);
  });

  it('routes an unknown type slug inside `elements` aside', () => {
    const e = envelope();
    (e.elements as Record<string, unknown>).widget = [{ name: 'W' }];
    const r = parsePayload(e);
    expect(r.unknownBuckets).toContain('widget');
    expect(r.byType.has('widget' as never)).toBe(false);
  });

  it('detects the envelope structurally even without the format tag', () => {
    const e = envelope() as Record<string, unknown>;
    delete e.format;
    const r = parsePayload(e);
    expect(r.ok).toBe(true);
    expect(r.format).toBe('full-world');
    expect(r.world?.id).toBe('068e012b-52a9-79bf-8000-26bb67891425');
  });

  it('rejects an envelope with a world block but no parseable elements as empty-but-valid', () => {
    // A world with an empty elements object is still a legitimate (empty) world.
    const r = parsePayload({ format: 'onlyworlds-world-export', world: { id: 'w', name: 'Empty' }, elements: {} });
    expect(r.ok).toBe(true);
    expect(r.totalElements).toBe(0);
    expect(r.world?.id).toBe('w');
  });
});
