/**
 * World units (#149, standard 00.31.00): which fields carry which unit, and
 * the label printed after the number.
 */

import { describe, it, expect } from 'vitest';
import { unitFieldFor, unitLabelFor } from '../../src/core/world-units';

const UNITS = { length_unit: 'cm', mass_unit: 'kg', distance_unit: 'leagues' };

describe('unitFieldFor', () => {
  it('names the nine fields the standard gives a unit, and only those', () => {
    const named: string[] = [];
    const types = ['ability', 'character', 'creature', 'location', 'object', 'species', 'map', 'event', 'title'];
    const fields = ['range', 'height', 'weight', 'speed', 'elevation', 'width', 'amount', 'birth_date'];
    for (const t of types) for (const f of fields) {
      const u = unitFieldFor(t, f);
      if (u) named.push(`${t}.${f}=${u}`);
    }
    expect(named.sort()).toEqual([
      'ability.range=distance_unit',
      'character.height=length_unit',
      'character.weight=mass_unit',
      'creature.height=length_unit',
      'creature.speed=distance_unit',
      'creature.weight=mass_unit',
      'location.elevation=distance_unit',
      'object.weight=mass_unit',
      'species.weight=mass_unit',
    ]);
  });
});

describe('unitLabelFor', () => {
  it('prints the world\'s unit as written', () => {
    expect(unitLabelFor('character', 'height', UNITS)).toBe('cm');
    expect(unitLabelFor('object', 'weight', UNITS)).toBe('kg');
    expect(unitLabelFor('location', 'elevation', UNITS)).toBe('leagues');
  });
  it('creature speed is per round', () => {
    expect(unitLabelFor('creature', 'speed', UNITS)).toBe('leagues/round');
  });
  it('a world without units, or a blank one, prints nothing', () => {
    expect(unitLabelFor('character', 'height', {})).toBe('');
    expect(unitLabelFor('character', 'height', { length_unit: '   ' })).toBe('');
    expect(unitLabelFor('character', 'height', null)).toBe('');
  });
  it('map pixels stay bare', () => {
    expect(unitLabelFor('map', 'height', UNITS)).toBe('');
  });
  it('trims what a hand edit left around the label', () => {
    expect(unitLabelFor('species', 'weight', { mass_unit: ' stone ' })).toBe('stone');
  });
});
