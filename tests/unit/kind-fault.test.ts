/**
 * Conv. 200: which values OnlyWorlds keeps as written in a standard field, by the SDK's own rule
 * (`kindFaults`), and the import's half: an integer field holding anything but a whole number is left
 * out (the review says so), never rounded; a number in a text field becomes its text.
 */
import { describe, it, expect } from 'vitest';
import { KIND_FAULT_MESSAGE, KIND_WAITS_MESSAGE, kindFaultOf, shownValue } from '../../src/sync/kind-fault';
import { classifyFailure, describeFailures } from '../../src/sync/sync-failure-copy';
import { syncIssueLine } from '../../src/middle/settings-world';
import { normalizeRecord } from '../../src/import/normalize';
import type { PerElementFailure } from '../../src/core/types';

describe('kindFaultOf', () => {
  it('takes a whole number, an unset field and an empty text in an integer field, and text in a text field', () => {
    for (const v of [12, -3, 0, 2.0, null, undefined, '']) expect(kindFaultOf('character', { height: v })).toBeNull();
    for (const v of ['Tall.', '', null]) expect(kindFaultOf('character', { description: v })).toBeNull();
  });
  it('names a fraction, a whole number as text, a word, a yes or no, a list and NaN in an integer field', () => {
    expect(kindFaultOf('character', { height: 170, weight: 72.5 })).toEqual({ field: 'weight', value: '72.5', kind: 'integer' });
    expect(kindFaultOf('character', { height: '7' })).toEqual({ field: 'height', value: '"7" as text', kind: 'integer' });
    expect(kindFaultOf('character', { height: 'tall' })).toEqual({ field: 'height', value: '"tall" as text', kind: 'integer' });
    expect(kindFaultOf('character', { height: true })).toEqual({ field: 'height', value: 'yes', kind: 'integer' });
    expect(kindFaultOf('character', { height: [1] })).toEqual({ field: 'height', value: 'a list', kind: 'integer' });
    expect(kindFaultOf('character', { height: Number.NaN })?.field).toBe('height');
    expect(kindFaultOf('pin', { x: 412.6, y: 3 })).toEqual({ field: 'x', value: '412.6', kind: 'integer' });
  });
  it('names a number, a yes or no and a list in a text field', () => {
    expect(kindFaultOf('character', { description: 12 })).toEqual({ field: 'description', value: '12 as a number', kind: 'text' });
    expect(kindFaultOf('character', { description: false })).toEqual({ field: 'description', value: 'no', kind: 'text' });
    expect(kindFaultOf('character', { description: ['a'] })).toEqual({ field: 'description', value: 'a list', kind: 'text' });
  });
  it('reads no extension, no link field and no type outside the standard', () => {
    expect(kindFaultOf('character', { x_score: 2.5, atlas_note: 3, location: 12, species: [1] })).toBeNull();
    expect(kindFaultOf('notatype' as never, { height: 2.5 })).toBeNull();
  });
  it('shows a long text cut, and a list or a group by what it is', () => {
    expect(shownValue('a'.repeat(50))).toBe(`"${'a'.repeat(40)}…"`);
    expect(shownValue([1, 2])).toBe('a list');
    expect(shownValue({})).toBe('a group of fields');
    expect(shownValue(true)).toBe('yes');
  });
});

describe('the words', () => {
  const held = (id: string, field: string, value: string, kind?: 'integer' | 'text'): PerElementFailure =>
    ({ element_id: id, type: 'character', operation: 'create', message: KIND_FAULT_MESSAGE, source: 'disk', kind_fault: { field, value, ...(kind ? { kind } : {}) } });
  const line = (f: PerElementFailure, where?: string) => syncIssueLine({ kind: classifyFailure(f), type: 'character', failure: f } as never, where as never);
  it('Settings names the field and the value, what the field takes and where it stays', () => {
    expect(line(held('a', 'hit_points', '"lots" as text', 'integer'), 'browser'))
      .toBe('Its hit points field holds "lots" as text, and OnlyWorlds takes only a whole number there, such as 12, so it was not sent. Change it to a whole number to let it sync. It stays in this browser.');
    expect(line(held('a', 'description', '12 as a number', 'text'), 'browser'))
      .toBe('Its description field holds 12 as a number, and OnlyWorlds takes only text there, so it was not sent. Save it again in its field to let it sync. It stays in this browser.');
    const w: PerElementFailure = { element_id: 'b', type: 'character', operation: 'create', message: KIND_WAITS_MESSAGE };
    expect(line(w)).toBe('It links to a new element that was not sent, and syncs when that one does.');
  });
  it('a record from 1.125.49, with no kind, reads as a whole number', () => {
    expect(line(held('a', 'height', '2.5'), 'browser')).toMatch(/takes only a whole number there, such as 12/);
  });
  it('the toast names two by field and value and counts the rest', () => {
    const fs = [held('a', 'height', '2.5', 'integer'), held('b', 'x', '412.6'), held('c', 'level', '"high" as text', 'integer'), held('d', 'level', '1.5', 'integer')];
    expect(describeFailures(fs, 'browser')).toBe('4 elements were not sent: fields that take only a whole number hold something else (height 2.5, x 412.6, and 2 more), which OnlyWorlds would not keep as written. Change each to a whole number, such as 12, to let them sync. They stay in this browser.');
  });
  it('the toast with a text field among them says both kinds and sends the person to Settings', () => {
    const fs = [held('a', 'height', '2.5', 'integer'), held('b', 'description', '12 as a number', 'text')];
    expect(describeFailures(fs, 'browser')).toBe('2 elements were not sent: fields hold a value of another kind than they take (height 2.5, description 12 as a number), which OnlyWorlds would not keep as written. Settings, under This world, says how to set each right. They stay in this browser.');
  });
});

describe('the import', () => {
  it('leaves a fraction, a fraction as text and a word out of an integer field; a whole number as text becomes the number', () => {
    const { record } = normalizeRecord({ name: 'Vera', height: 180.5, weight: '72.5', birth_date: 'spring', level: '7', hit_points: 12, description: 'Tall.' }, 'character');
    expect(record).toEqual({ name: 'Vera', level: 7, hit_points: 12, description: 'Tall.' });
  });
  it('writes a number in a text field as its text, which nothing then holds back', () => {
    const { record } = normalizeRecord({ name: 'Vera', description: 12, background: 2.5 }, 'character');
    expect(record).toEqual({ name: 'Vera', description: '12', background: '2.5' });
    expect(kindFaultOf('character', record)).toBeNull();
  });
});
