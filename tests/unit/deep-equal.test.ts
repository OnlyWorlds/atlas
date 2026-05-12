/**
 * deepEqual unit tests.
 *
 * Used by diffFieldNames to avoid false conflicts when key order differs
 * between local and server records (the API doesn't guarantee key ordering).
 */

import { describe, it, expect } from 'vitest';
import { deepEqual } from '../../src/sync/sync-engine';

describe('deepEqual', () => {
  it('compares primitives by value', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual(true, false)).toBe(false);
  });

  it('null does not equal undefined or {}', () => {
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual(undefined, {})).toBe(false);
  });

  it('NaN compares unequal (matches strict equality)', () => {
    expect(deepEqual(NaN, NaN)).toBe(false);
  });

  it('arrays compare positionally', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(deepEqual([], [])).toBe(true);
  });

  it('plain objects compare key-set sensitive, key-order insensitive', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 })).toBe(false);
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('arrays and objects with same shape compare false', () => {
    expect(deepEqual([1, 2], { 0: 1, 1: 2, length: 2 })).toBe(false);
  });

  it('nested structures', () => {
    const a = { name: 'Alice', tags: ['a', 'b'], meta: { age: 30, role: 'dm' } };
    const b = { tags: ['a', 'b'], meta: { role: 'dm', age: 30 }, name: 'Alice' };
    expect(deepEqual(a, b)).toBe(true);
  });

  it('detects deep differences', () => {
    const a = { meta: { age: 30 } };
    const b = { meta: { age: 31 } };
    expect(deepEqual(a, b)).toBe(false);
  });

  it('null inside an object', () => {
    expect(deepEqual({ x: null }, { x: null })).toBe(true);
    expect(deepEqual({ x: null }, { x: undefined })).toBe(false);
    expect(deepEqual({ x: null }, { x: 0 })).toBe(false);
  });
});
