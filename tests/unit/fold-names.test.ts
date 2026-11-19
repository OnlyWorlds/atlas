/**
 * The folds' names (1.124.25): the Maps tree's fold and a zone kind's fold say
 * what a press does, by state. A zone kind's fold names the list (the eye
 * beside it hides the zones on the map). While a search holds a fold open, a
 * press does nothing and the name says what is true. A map or kind with no
 * name or kind is said in the app's own words.
 */
import { describe, it, expect } from 'vitest';
import { mapFoldName } from '../../src/tabs/right/map-index-tab';
import { foldName } from '../../src/tabs/right/map-zone-panel';

describe('the Maps fold', () => {
  it('says Show or Hide by state, the count with its plural', () => {
    expect(mapFoldName(3, 'Sikelia', true)).toBe('Show the 3 maps under Sikelia');
    expect(mapFoldName(3, 'Sikelia', false)).toBe('Hide the 3 maps under Sikelia');
    expect(mapFoldName(1, 'Realm', false)).toBe('Hide the map under Realm');
  });

  it('names a map with no name, or only spaces, as the unnamed map', () => {
    expect(mapFoldName(2, undefined, true)).toBe('Show the 2 maps under (unnamed map)');
    expect(mapFoldName(2, '', false)).toBe('Hide the 2 maps under (unnamed map)');
    expect(mapFoldName(1, '   ', true)).toBe('Show the map under (unnamed map)');
    expect(mapFoldName(1, '  Realm ', true)).toBe('Show the map under Realm');
  });

  it('during a search says the search shows them, never Hide', () => {
    expect(mapFoldName(2, 'Sikelia', false, true)).toBe('The search shows the 2 maps under Sikelia');
    expect(mapFoldName(1, 'Realm', false, true)).toBe('The search shows the map under Realm');
  });
});

describe('a zone kind\'s fold', () => {
  const border = { supertype: 'Border', subtype: '' };
  it('names the list, by state, one or the count', () => {
    expect(foldName(border, 2, false)).toBe('Show the list of the 2 Border zones');
    expect(foldName(border, 2, true)).toBe('Hide the list of the 2 Border zones');
    expect(foldName(border, 1, false)).toBe('Show the list of one Border zone');
  });

  it('says a kind-less kind as zones with no kind, a role still naming them', () => {
    expect(foldName({ supertype: '', subtype: '' }, 2, false)).toBe('Show the list of the 2 zones with no kind');
    expect(foldName({ supertype: '', subtype: '' }, 1, true)).toBe('Hide the list of one zone with no kind');
    expect(foldName({ supertype: '', subtype: '', role: 'vassal' }, 2, false)).toBe('Show the list of the 2 vassal zones with no kind');
    expect(foldName({ supertype: 'Line', subtype: 'River', role: 'major river' }, 2, false)).toBe('Show the list of the 2 Line · River · major river zones');
  });

  it('during a search says the search shows the list', () => {
    expect(foldName(border, 2, true, true)).toBe('The search shows the list of the 2 Border zones');
    expect(foldName(border, 1, true, true)).toBe('The search shows the list of one Border zone');
  });
});
