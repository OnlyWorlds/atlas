/**
 * Conv. 200: which values keel keeps in an integer field as written, and the import's half: a field the
 * standard types integer is left out when it holds anything else (the review says so), never rounded.
 */
import { describe, it, expect } from 'vitest';
import { KIND_FAULT_MESSAGE, KIND_WAITS_MESSAGE, keepsAsWhole, kindFaultOf, shownValue } from '../../src/sync/kind-fault';
import { classifyFailure, describeFailures } from '../../src/sync/sync-failure-copy';
import { syncIssueLine } from '../../src/middle/settings-world';
import { normalizeRecord } from '../../src/import/normalize';
import type { PerElementFailure } from '../../src/core/types';

describe('keepsAsWhole', () => {
  it('takes a whole number, a whole number as text, and an unset field', () => {
    for (const v of [12, -3, 0, '7', ' 7 ', '+7', '-7', '07', null, undefined, '']) expect(keepsAsWhole(v)).toBe(true);
  });
  it('refuses a fraction, a word, a yes or no, a list and a group of fields, and text keel\'s int() refuses', () => {
    for (const v of [2.5, '2.5', 'tall', true, false, [1], { n: 1 }, Number.NaN, '1e3', '7.0', '7.']) expect(keepsAsWhole(v)).toBe(false);
  });
});

describe('kindFaultOf', () => {
  it('names the first integer field in the schema\'s order, and reads no text or custom field', () => {
    expect(kindFaultOf('character', { name: '2.5', description: 2.5, x_score: 2.5 })).toBeNull();
    expect(kindFaultOf('character', { height: 170, weight: 72.5 })).toEqual({ field: 'weight', value: '72.5' });
    expect(kindFaultOf('pin', { x: 412.6, y: 3 })).toEqual({ field: 'x', value: '412.6' });
  });
  it('shows a long text cut, and a list or a group by what it is', () => {
    expect(shownValue('a'.repeat(50))).toBe(`"${'a'.repeat(40)}…"`);
    expect(shownValue([1, 2])).toBe('a list');
    expect(shownValue({})).toBe('a group of fields');
    expect(shownValue(true)).toBe('yes');
  });
});

describe('the words', () => {
  const held = (id: string, field: string, value: string): PerElementFailure =>
    ({ element_id: id, type: 'character', operation: 'create', message: KIND_FAULT_MESSAGE, source: 'disk', kind_fault: { field, value } });
  it('Settings names the field and the value, and where it stays', () => {
    const f = held('a', 'hit_points', '"lots"');
    expect(syncIssueLine({ kind: classifyFailure(f), type: 'character', failure: f } as never, 'browser'))
      .toBe('Its hit points field holds "lots", and OnlyWorlds takes only a whole number there, such as 12, so it was not sent. Change it to a whole number to let it sync. It stays in this browser.');
    const w: PerElementFailure = { element_id: 'b', type: 'character', operation: 'create', message: KIND_WAITS_MESSAGE };
    expect(syncIssueLine({ kind: classifyFailure(w), type: 'character', failure: w } as never)).toBe('It links to a new element that was not sent, and syncs when that one does.');
  });
  it('the toast names two by field and value and counts the rest', () => {
    const fs = [held('a', 'height', '2.5'), held('b', 'x', '412.6'), held('c', 'level', '"high"'), held('d', 'level', '1.5')];
    expect(describeFailures(fs, 'browser')).toBe('4 elements were not sent: fields that take only a whole number hold something else (height 2.5, x 412.6, and 2 more), which OnlyWorlds would not keep as written. Change each to a whole number, such as 12, to let them sync. They stay in this browser.');
  });
});

describe('the import leaves a wrong kind in an integer field out', () => {
  it('a fraction, a fraction as text and a word go; a whole number as text becomes the number; text fields keep theirs', () => {
    const { record } = normalizeRecord({ name: 'Vera', height: 180.5, weight: '72.5', birth_date: 'spring', level: '7', hit_points: 12, description: 'Tall.' }, 'character');
    expect(record).toEqual({ name: 'Vera', level: 7, hit_points: 12, description: 'Tall.' });
  });
});
