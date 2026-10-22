/**
 * The elements sidebar's filter strip in words (S369): the strip is 22 type
 * glyphs and no words, so a line under the search row says what it selects.
 */
import { describe, it, expect } from 'vitest';
import { filterSummary } from '../../src/sidebar/elements-sidebar';
import type { ElementType } from '../../src/core/types';

const set = (...t: ElementType[]) => new Set<ElementType>(t);

describe('filterSummary', () => {
  it('says "All types" with no filter, ignoring the default-hidden pins and markers', () => {
    expect(filterSummary(set(), set())).toBe('All types');
    expect(filterSummary(set(), set('pin', 'marker'))).toBe('All types');
  });

  it('names the types the user hid', () => {
    expect(filterSummary(set(), set('pin', 'marker', 'map'))).toBe('All types except maps');
  });

  it('names the selected types in strip order, sentence case', () => {
    expect(filterSummary(set('character'), set())).toBe('Showing characters');
    expect(filterSummary(set('location', 'character'), set())).toBe('Showing characters and locations');
    expect(filterSummary(set('event', 'location', 'character'), set())).toBe('Showing characters, locations and events');
  });

  it('shortens a long selection', () => {
    const s = filterSummary(set('character', 'creature', 'species', 'family', 'collective', 'institution'), set());
    expect(s).toBe('Showing characters, creatures, species and 3 more');
  });

  it('says who made it and the room hidden after a dot (#350)', () => {
    expect(filterSummary(set(), set(), 'agents')).toBe('All types · made by agents');
    expect(filterSummary(set('narrative'), set(), 'people', true)).toBe('Showing narratives · made by people · the room hidden');
    expect(filterSummary(set(), set(), null, true)).toBe('All types · the room hidden');
  });

  it('has no em-dash', () => {
    expect(filterSummary(set('character', 'location'), set('map'))).not.toContain('\u2014');
  });
});
