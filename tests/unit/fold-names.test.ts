/**
 * The folds' names and tooltips (1.124.25, parted in 1.124.26). A fold's
 * accessible name says what it folds, with no verb: its aria-expanded says the
 * state, so a screen reader hears it once. Its tooltip keeps the verb for the
 * mouse ("Show ...", "Hide ..."). A zone kind's fold names the list (the eye
 * beside it hides the zones on the map). While a search holds a fold open, a
 * press does nothing and the tooltip says why. A map with no name is "the
 * unnamed map", the one form every control says a missing name in.
 */
import { describe, it, expect } from 'vitest';
import { mapFoldName, mapFoldTitle } from '../../src/tabs/right/map-index-tab';
import { foldName, foldTitle } from '../../src/tabs/right/map-zone-panel';
import { theUnnamed } from '../../src/core/type-words';
import { removeFieldName } from '../../src/middle/element-detail-fields';

describe('the Maps fold', () => {
  it('is named by the maps it folds, with no verb, the count with its plural', () => {
    expect(mapFoldName(3, 'Sikelia')).toBe('The 3 maps under Sikelia');
    expect(mapFoldName(1, 'Realm')).toBe('The map under Realm');
  });

  it('keeps the verb in its tooltip, by state', () => {
    expect(mapFoldTitle(3, 'Sikelia', true)).toBe('Show the 3 maps under Sikelia');
    expect(mapFoldTitle(3, 'Sikelia', false)).toBe('Hide the 3 maps under Sikelia');
    expect(mapFoldTitle(1, 'Realm', false)).toBe('Hide the map under Realm');
  });

  it('says a map with no name, or only spaces, as the unnamed map', () => {
    expect(mapFoldName(2, undefined)).toBe('The 2 maps under the unnamed map');
    expect(mapFoldName(1, '   ')).toBe('The map under the unnamed map');
    expect(mapFoldName(1, '  Realm ')).toBe('The map under Realm');
    expect(mapFoldTitle(2, undefined, true)).toBe('Show the 2 maps under the unnamed map');
    expect(mapFoldTitle(2, '', false)).toBe('Hide the 2 maps under the unnamed map');
    expect(mapFoldTitle(1, '   ', true)).toBe('Show the map under the unnamed map');
  });

  it('during a search keeps its plain name, and the tooltip says the search shows them', () => {
    expect(mapFoldName(2, 'Sikelia')).toBe('The 2 maps under Sikelia');
    expect(mapFoldTitle(2, 'Sikelia', false, true)).toBe('The search shows the 2 maps under Sikelia');
    expect(mapFoldTitle(1, 'Realm', false, true)).toBe('The search shows the map under Realm');
  });
});

describe('a zone kind\'s fold', () => {
  const border = { supertype: 'Border', subtype: '' };
  it('is named by the list it folds, with no verb, one or the count', () => {
    expect(foldName(border, 2)).toBe('The list of the 2 Border zones');
    expect(foldName(border, 1)).toBe('The list of one Border zone');
  });

  it('keeps the verb in its tooltip, by state', () => {
    expect(foldTitle(border, 2, false)).toBe('Show the list of the 2 Border zones');
    expect(foldTitle(border, 2, true)).toBe('Hide the list of the 2 Border zones');
    expect(foldTitle(border, 1, false)).toBe('Show the list of one Border zone');
  });

  it('says a kind-less kind as zones with no kind, a role still naming them', () => {
    expect(foldName({ supertype: '', subtype: '' }, 2)).toBe('The list of the 2 zones with no kind');
    expect(foldTitle({ supertype: '', subtype: '' }, 1, true)).toBe('Hide the list of one zone with no kind');
    expect(foldName({ supertype: '', subtype: '', role: 'vassal' }, 2)).toBe('The list of the 2 vassal zones with no kind');
    expect(foldTitle({ supertype: 'Line', subtype: 'River', role: 'major river' }, 2, false)).toBe('Show the list of the 2 Line · River · major river zones');
  });

  it('during a search keeps its plain name, and the tooltip says the search shows the list', () => {
    expect(foldTitle(border, 2, true, true)).toBe('The search shows the list of the 2 Border zones');
    expect(foldTitle(border, 1, true, true)).toBe('The search shows the list of one Border zone');
  });
});

describe('a missing name, said one way', () => {
  it('is the unnamed <type word>, mid-sentence', () => {
    expect(theUnnamed('map')).toBe('the unnamed map');
    expect(theUnnamed('event')).toBe('the unnamed event');
    expect(theUnnamed('zone')).toBe('the unnamed zone');
  });

  it('a field\'s remove has one wording for every kind of field', () => {
    expect(removeFieldName('x_mood')).toBe('Remove the field Mood');
    expect(removeFieldName('x_tally')).toBe('Remove the field Tally');
    expect(removeFieldName('x_')).toBe('Remove the unnamed field');
  });
});
