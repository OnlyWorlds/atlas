/**
 * #24: the rule behind "Hide empty fields" (and the tour's sparse pages).
 */
import { describe, it, expect } from 'vitest';
import { filledSections, isFieldFilled } from '../../src/middle/filled-fields';
import type { Element } from '../../src/core/types';

const el = (extra: Record<string, unknown>) => ({ id: 'e1', type: 'character', name: 'Hero', ...extra }) as unknown as Element;
const sections = [
  { name: 'Base', fields: [{ name: 'description' }, { name: 'supertype' }, { name: 'image_url' }] },
  { name: 'Constitution', fields: [{ name: 'physicality' }, { name: 'mentality' }] },
  { name: 'Origins', fields: [{ name: 'birthplace' }, { name: 'languages' }] },
];

describe('isFieldFilled', () => {
  it('blank text, empty lists, null and absent are empty; anything else is filled', () => {
    const e = el({ a: '', b: '  ', c: [], d: null, f: 'x', g: [1], h: 0, i: false });
    for (const k of ['a', 'b', 'c', 'd', 'missing']) expect(isFieldFilled(e, k), k).toBe(false);
    for (const k of ['f', 'g', 'h', 'i']) expect(isFieldFilled(e, k), k).toBe(true);
  });
});

describe('filledSections', () => {
  it('keeps only filled fields, drops sections left empty, and counts what it hid', () => {
    const r = filledSections(sections, el({ description: 'Tall.', physicality: 'Wiry', languages: [] }));
    expect(r.sections.map(s => [s.name, s.fields.map(f => f.name)])).toEqual([
      ['Base', ['description']],
      ['Constitution', ['physicality']],
    ]);
    expect(r.hidden).toBe(5);
  });

  it('an element with nothing filled keeps its first section whole', () => {
    const r = filledSections(sections, el({}));
    expect(r.sections.map(s => s.name)).toEqual(['Base']);
    expect(r.sections[0]!.fields).toHaveLength(3);
    expect(r.hidden).toBe(4);
  });

  it('keepFirstWhole keeps the first section full (the tour\'s consul step)', () => {
    const r = filledSections(sections, el({ mentality: 'Calm' }), { keepFirstWhole: true });
    expect(r.sections.map(s => [s.name, s.fields.length])).toEqual([['Base', 3], ['Constitution', 1]]);
    expect(r.hidden).toBe(3);
  });
});
