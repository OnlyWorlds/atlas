/**
 * World-meta sync kernel tests (S262) — the pure functions under the engine's
 * meta step. The load-bearing locks, each tied to a gate finding:
 *  - canonical equality kills the undefined-vs-typed-empty oscillation
 *  - the encoder emits explicit null for cleared ints (resurrect fix)
 *  - the encoder whitelists (one stray field aborts the whole PATCH server-side)
 *  - three-way diff routes push/pull/contested/converged per field
 */

import { describe, it, expect } from 'vitest';
import {
  META_SYNC_FIELDS,
  META_SYNC_FIELD_NAMES,
  META_WIRE_RENAME,
  canonicalMetaValue,
  encodeMetaFieldsForPush,
  isMetaEmpty,
  metaEquals,
  metaFieldLengthError,
  pickSyncedMeta,
  threeWayMetaDiff,
} from '../../src/sync/world-meta-sync';

describe('META_SYNC_FIELDS', () => {
  it('covers exactly the 11 synced fields and excludes name (D4)', () => {
    expect([...META_SYNC_FIELD_NAMES].sort()).toEqual([
      'description', 'distance_unit', 'image_url', 'length_unit', 'mass_unit',
      'time_basic_unit', 'time_current', 'time_format_equivalents', 'time_format_names',
      'time_range_max', 'time_range_min',
    ]);
    expect(META_SYNC_FIELDS['name']).toBeUndefined();
  });

  it('renames only time_current on the wire', () => {
    expect(META_WIRE_RENAME).toEqual({ time_current: 'time_range_current' });
  });
});

describe('canonical equality (the oscillation lock)', () => {
  it('treats undefined ≡ empty string for text', () => {
    expect(metaEquals('text', undefined, '')).toBe(true);
    expect(metaEquals('text', undefined, 'x')).toBe(false);
  });
  it('treats undefined ≡ [] for lists, element-wise otherwise', () => {
    expect(metaEquals('list', undefined, [])).toBe(true);
    expect(metaEquals('list', ['a'], ['a'])).toBe(true);
    expect(metaEquals('list', ['a'], ['a', 'b'])).toBe(false);
    expect(metaEquals('list', ['a', 'b'], ['b', 'a'])).toBe(false);
  });
  it('treats undefined ≡ null for ints; NaN/Infinity are unset', () => {
    expect(metaEquals('int', undefined, null)).toBe(true);
    expect(metaEquals('int', 0, null)).toBe(false);
    expect(metaEquals('int', NaN, null)).toBe(true);
    expect(metaEquals('int', Infinity, null)).toBe(true);
    expect(metaEquals('int', 38, 38)).toBe(true);
  });
  it('canonicalizes non-string text values to empty (defensive)', () => {
    expect(canonicalMetaValue('text', 42)).toBe('');
    expect(canonicalMetaValue('list', 'not-a-list')).toEqual([]);
  });
});

describe('pickSyncedMeta / isMetaEmpty', () => {
  it('snapshots the 11 fields canonically from a sparse disk meta', () => {
    const snap = pickSyncedMeta({ id: 'w1', name: 'World', time_current: 38 });
    expect(snap).toEqual({
      description: '', image_url: '', time_basic_unit: '',
      time_format_names: [], time_format_equivalents: [],
      time_range_min: null, time_range_max: null, time_current: 38,
      length_unit: '', mass_unit: '', distance_unit: '',
    });
  });
  it('world units compare trimmed, as keel stores them (an untrimmed local value matches its echo)', () => {
    expect(metaEquals('label', ' cm ', 'cm')).toBe(true);
    expect(pickSyncedMeta({ length_unit: '  hands ' }).length_unit).toBe('hands');
    expect(encodeMetaFieldsForPush({ mass_unit: ' kg' })).toEqual({ mass_unit: 'kg' });
    expect(isMetaEmpty('distance_unit', '   ')).toBe(true);
    // description stays byte-exact: only the unit labels trim
    expect(metaEquals(META_SYNC_FIELDS.description, ' x ', 'x')).toBe(false);
  });
  it('isMetaEmpty matches canonical empties per kind', () => {
    expect(isMetaEmpty('description', undefined)).toBe(true);
    expect(isMetaEmpty('description', '')).toBe(true);
    expect(isMetaEmpty('description', 'x')).toBe(false);
    expect(isMetaEmpty('time_current', null)).toBe(true);
    expect(isMetaEmpty('time_current', 0)).toBe(false);
    expect(isMetaEmpty('time_format_names', [])).toBe(true);
  });
});

describe('threeWayMetaDiff', () => {
  const baseline = pickSyncedMeta({ description: 'old', time_current: 10 });

  it('no changes → all buckets empty (a fresh world never PATCHes)', () => {
    const local = { description: 'old', time_current: 10 };
    const server = { description: 'old', time_current: 10 };
    const d = threeWayMetaDiff(local, server, baseline);
    expect(d.pushFields).toEqual({});
    expect(d.pullFields).toEqual({});
    expect(d.contested).toEqual([]);
    expect(d.converged).toEqual([]);
  });

  it('disk-undefined vs baseline/server typed-empty is NOT a change', () => {
    // The gate HIGH: an api-linked world with unset fields must not re-PATCH
    // empties every round.
    const b = pickSyncedMeta({});
    const local = {};                        // disk: everything absent
    const server = { description: '', time_range_min: null, time_format_names: [] };
    const d = threeWayMetaDiff(local, server, b);
    expect(d.pushFields).toEqual({});
    expect(d.pullFields).toEqual({});
  });

  it('local-only change → push; server-only change → pull', () => {
    const local = { description: 'mine', time_current: 10 };
    const server = { description: 'old', time_current: 55 };
    const d = threeWayMetaDiff(local, server, baseline);
    expect(d.pushFields).toEqual({ description: 'mine' });
    expect(d.pullFields).toEqual({ time_current: 55 });
    expect(d.contested).toEqual([]);
  });

  it('both changed to different values → contested', () => {
    const local = { description: 'mine', time_current: 10 };
    const server = { description: 'theirs', time_current: 10 };
    const d = threeWayMetaDiff(local, server, baseline);
    expect(d.contested).toEqual(['description']);
    expect(d.pushFields).toEqual({});
  });

  it('both changed to the SAME value → converged (baseline advances, no wire)', () => {
    const local = { description: 'same', time_current: 10 };
    const server = { description: 'same', time_current: 10 };
    const d = threeWayMetaDiff(local, server, baseline);
    expect(d.converged).toEqual(['description']);
    expect(d.pushFields).toEqual({});
    expect(d.contested).toEqual([]);
  });

  it('a locally-cleared int (undefined on disk, value in baseline) is a PUSH of null', () => {
    // setNow(null) writes undefined to disk; the clear must reach the wire.
    const local = { description: 'old' };    // time_current gone
    const server = { description: 'old', time_current: 10 };
    const d = threeWayMetaDiff(local, server, baseline);
    expect(d.pushFields).toEqual({ time_current: null });
  });
});

describe('encodeMetaFieldsForPush', () => {
  it('emits explicit null for cleared ints (the resurrect fix)', () => {
    expect(encodeMetaFieldsForPush({ time_current: undefined })).toEqual({ time_current: null });
  });
  it('emits typed empties for text and lists', () => {
    expect(encodeMetaFieldsForPush({ description: undefined, time_format_names: undefined }))
      .toEqual({ description: '', time_format_names: [] });
  });
  it('whitelists: strays and name never reach the body', () => {
    expect(encodeMetaFieldsForPush({ name: 'x', bogus: 1, description: 'd' }))
      .toEqual({ description: 'd' });
  });
  it('keeps disk names (the adapter owns the wire rename)', () => {
    expect(encodeMetaFieldsForPush({ time_current: 5 })).toEqual({ time_current: 5 });
  });
});

describe('metaFieldLengthError (dig Q9: keel never length-validates)', () => {
  it('flags image_url > 1024 and time_basic_unit > 128', () => {
    expect(metaFieldLengthError('image_url', 'x'.repeat(1025))).toMatch(/1024/);
    expect(metaFieldLengthError('image_url', 'x'.repeat(1024))).toBeNull();
    expect(metaFieldLengthError('time_basic_unit', 'x'.repeat(129))).toMatch(/128/);
  });
  it('flags a world unit over 64 after the trim, as keel measures it', () => {
    expect(metaFieldLengthError('length_unit', 'x'.repeat(65))).toMatch(/64/);
    expect(metaFieldLengthError('length_unit', ` ${'x'.repeat(64)} `)).toBeNull();
  });
  it('description is unbounded (TextField)', () => {
    expect(metaFieldLengthError('description', 'x'.repeat(100_000))).toBeNull();
  });
});
