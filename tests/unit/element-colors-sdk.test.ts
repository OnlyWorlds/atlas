/**
 * Atlas's colour families are the standard's groups, every type of the 22
 * checked, not a sample: serial 86 moved Construct to pink and Ability to
 * amber, and a reader kept on its own table passes any test that leaves those
 * two out.
 */
import { describe, it, expect } from 'vitest';
import { ELEMENT_GROUPS, GROUP_COLORS } from '@onlyworlds/sdk';
import { ELEMENT_FAMILIES, FAMILY_COLORS, elementColor, familyOf } from '../../src/core/element-colors';

const WORD = { agents: 'blue', world: 'green', abstract: 'pink', temporal: 'amber' } as const;

describe('element colour families follow the SDK groups', () => {
  it('every one of the 22 types sits in the SDK\'s group, with the SDK\'s hex in both modes', () => {
    const types = Object.keys(ELEMENT_GROUPS);
    expect(types).toHaveLength(22);
    for (const t of types) {
      const g = ELEMENT_GROUPS[t as keyof typeof ELEMENT_GROUPS];
      expect(WORD[familyOf(t)], t).toBe(g);
      expect(elementColor(t, 'dark'), t).toBe(GROUP_COLORS[g].dark);
      expect(elementColor(t, 'light'), t).toBe(GROUP_COLORS[g].light);
    }
    expect(Object.keys(ELEMENT_FAMILIES).sort()).toEqual([...types].sort());
  });

  it('the two serial 86 moved: Construct is pink, Ability amber', () => {
    expect(familyOf('construct')).toBe('abstract');
    expect(familyOf('ability')).toBe('temporal');
    expect(FAMILY_COLORS.abstract).toEqual(GROUP_COLORS.pink);
  });

  it('a type no schema names (a foreign tool\'s) still draws, in green', () => {
    expect(familyOf('starship')).toBe('world');
  });
});
