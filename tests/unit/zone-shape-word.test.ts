import { describe, it, expect } from 'vitest';
import { supertypeForNewZone } from '../../src/core/zone-shape-word';

describe('a new zone\'s supertype (Titus\'s interim until the schema has a shape field)', () => {
  it('takes the shape\'s word when the user left it empty', () => {
    expect(supertypeForNewZone(undefined, 'polygon')).toBe('polygon');
    expect(supertypeForNewZone('', 'line')).toBe('line');
    expect(supertypeForNewZone('   ', 'line')).toBe('line');
  });
  it('keeps whatever the user typed (ZD6)', () => {
    expect(supertypeForNewZone('Regions', 'polygon')).toBe('Regions');
    expect(supertypeForNewZone('line', 'polygon')).toBe('line');
  });
});
