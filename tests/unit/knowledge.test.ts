/**
 * Knowledge model scans (DESIGN_KNOWLEDGE.md).
 *
 * Covers classification, held-by reading, about-subject gathering (excluding the
 * collectives held-by field), circle membership, and the computed known-view:
 *   - direct holding (narrator / collective-as-holder — two channels only)
 *   - inherited holding (a character via membership in a holding circle)
 *   - non-agents never hold knowledge
 *   - elementsKnownAboutBy = union of about-subjects across held entries
 */

import { describe, it, expect } from 'vitest';
import {
  KNOWLEDGE_SUBTYPE,
  isKnowledgeNarrative,
  listKnowledgeEntries,
  heldByOf,
  heldByCount,
  aboutIdsOf,
  aboutFieldFor,
  isKnowerType,
  circleMembers,
  characterKnowsEntry,
  knowledgeHeldBy,
  elementsKnownAboutBy,
  listKnowers,
  knowersOfElement,
  lensKnownSet,
} from '../../src/core/knowledge';
import type { Element } from '../../src/core/types';

function el(p: Record<string, unknown> & { id: string; type: string }): Element {
  return p as unknown as Element;
}

// A small world:
//   characters: Ireena (c1), Strahd (c2), Ismark (c3)
//   collective: The Party (col1) = [c1, c3]
//   institution: Hall of Records (i1) — NOT a knower (institutions hold via a Circle)
//   location: Barovia (loc1)
//   knowledge k1: narrator Strahd, about [loc1]
//   knowledge k2: held by The Party, about [c2, loc1]   (collectives field = holder, not about)
//   knowledge k3: no holders, about [loc1]
//   story narrative n1 (subtype 'book') — NOT knowledge
const c1 = el({ id: 'c1', type: 'character', name: 'Ireena' });
const c2 = el({ id: 'c2', type: 'character', name: 'Strahd' });
const c3 = el({ id: 'c3', type: 'character', name: 'Ismark' });
const col1 = el({ id: 'col1', type: 'collective', name: 'The Party', characters: ['c1', 'c3'] });
const i1 = el({ id: 'i1', type: 'institution', name: 'Hall of Records' });
const loc1 = el({ id: 'loc1', type: 'location', name: 'Barovia' });
const k1 = el({ id: 'k1', type: 'narrative', name: 'Strahd is a vampire', subtype: KNOWLEDGE_SUBTYPE, narrator: 'c2', locations: ['loc1'] });
const k2 = el({ id: 'k2', type: 'narrative', name: 'The village is cursed', subtype: 'Knowledge', collectives: ['col1'], characters: ['c2'], locations: ['loc1'] });
const k3 = el({ id: 'k3', type: 'narrative', name: 'The old records', subtype: KNOWLEDGE_SUBTYPE, locations: ['loc1'] });
const n1 = el({ id: 'n1', type: 'narrative', name: 'Book One', subtype: 'book', characters: ['c1'] });
const world: Element[] = [c1, c2, c3, col1, i1, loc1, k1, k2, k3, n1];

describe('classification', () => {
  it('flags knowledge-subtype narratives (case-insensitive), not others', () => {
    expect(isKnowledgeNarrative(k1)).toBe(true);
    expect(isKnowledgeNarrative(k2)).toBe(true); // 'Knowledge' capitalised
    expect(isKnowledgeNarrative(n1)).toBe(false); // a book
    expect(isKnowledgeNarrative(loc1)).toBe(false); // not a narrative
    expect(isKnowledgeNarrative(undefined)).toBe(false);
  });

  it('lists only knowledge entries', () => {
    expect(listKnowledgeEntries(world).map(e => e.id).sort()).toEqual(['k1', 'k2', 'k3']);
  });
});

describe('held-by reading', () => {
  it('reads narrator + collectives (no conservator channel)', () => {
    expect(heldByOf(k1)).toEqual({ narrator: 'c2', collectives: [] });
    expect(heldByOf(k2)).toEqual({ narrator: null, collectives: ['col1'] });
    expect(heldByOf(k3)).toEqual({ narrator: null, collectives: [] });
  });

  it('counts holder links', () => {
    expect(heldByCount(k1)).toBe(1);
    expect(heldByCount(k2)).toBe(1);
    expect(heldByCount(k3)).toBe(0); // a knowledge entry with no holders yet
  });
});

describe('about-subjects', () => {
  it('gathers about ids but EXCLUDES the collectives held-by field', () => {
    expect(aboutIdsOf(k2).sort()).toEqual(['c2', 'loc1']); // col1 (holder) not included
    expect(aboutIdsOf(k1)).toEqual(['loc1']);
  });
});

describe('circle membership', () => {
  it('returns a collective\'s member characters', () => {
    expect(circleMembers('col1', world).sort()).toEqual(['c1', 'c3']);
    expect(circleMembers('c1', world)).toEqual([]); // not a collective
    expect(circleMembers('nope', world)).toEqual([]);
  });
});

describe('characterKnowsEntry', () => {
  it('true via direct narrator', () => {
    expect(characterKnowsEntry('c2', k1, world)).toBe(true);
  });
  it('true via circle membership (inherited)', () => {
    expect(characterKnowsEntry('c1', k2, world)).toBe(true); // Ireena in The Party
    expect(characterKnowsEntry('c3', k2, world)).toBe(true); // Ismark in The Party
  });
  it('false when neither narrator nor a member', () => {
    expect(characterKnowsEntry('c2', k2, world)).toBe(false); // Strahd not in The Party
    expect(characterKnowsEntry('c1', k1, world)).toBe(false); // Ireena not the narrator
  });
});

describe('knowledgeHeldBy (dispatch on knower type)', () => {
  it('character: direct + inherited', () => {
    expect(knowledgeHeldBy('c2', world).map(e => e.id)).toEqual(['k1']); // Strahd: narrator of k1
    expect(knowledgeHeldBy('c1', world).map(e => e.id)).toEqual(['k2']); // Ireena: party member
  });
  it('collective: direct holder', () => {
    expect(knowledgeHeldBy('col1', world).map(e => e.id)).toEqual(['k2']);
  });
  it('non-knower / unknown → nothing', () => {
    expect(knowledgeHeldBy('i1', world)).toEqual([]);   // institutions hold via a Circle, not directly
    expect(knowledgeHeldBy('loc1', world)).toEqual([]); // a location holds nothing
    expect(knowledgeHeldBy('nope', world)).toEqual([]);
  });
});

describe('isKnowerType', () => {
  it('only characters and Circles are knowers', () => {
    expect(isKnowerType('character')).toBe(true);
    expect(isKnowerType('collective')).toBe(true);
    expect(isKnowerType('institution')).toBe(false); // holds via a Circle, not directly
    expect(isKnowerType('location')).toBe(false);
    expect(isKnowerType('object')).toBe(false);
  });
});

describe('elementsKnownAboutBy (the known-view subject set)', () => {
  it('unions about-subjects across all entries the knower holds', () => {
    // Ireena holds k2 → about [c2, loc1]
    expect(elementsKnownAboutBy('c1', world).sort()).toEqual(['c2', 'loc1']);
    // Strahd holds k1 → about [loc1]
    expect(elementsKnownAboutBy('c2', world)).toEqual(['loc1']);
    // The Party (collective) holds k2 → about [c2, loc1]
    expect(elementsKnownAboutBy('col1', world).sort()).toEqual(['c2', 'loc1']);
  });
});

describe('aboutFieldFor', () => {
  it('maps subject types to their Involves field', () => {
    expect(aboutFieldFor('character')).toBe('characters');
    expect(aboutFieldFor('location')).toBe('locations');
    expect(aboutFieldFor('phenomenon')).toBe('phenomena');
  });
  it('rejects collectives (held-by channel) and non-subject types', () => {
    expect(aboutFieldFor('collective')).toBeNull();
    expect(aboutFieldFor('narrative')).toBeNull();
    expect(aboutFieldFor('map')).toBeNull();
    expect(aboutFieldFor('pin')).toBeNull();
  });
});

describe('listKnowers (the Knowers tab)', () => {
  it('lists direct holders only — circle members are not expanded', () => {
    // Direct holders: Strahd (narrator of k1) + The Party (holds k2).
    // Ireena/Ismark know k2 via membership but are NOT listed as knowers.
    expect(listKnowers(world).map(e => e.id).sort()).toEqual(['c2', 'col1']);
  });
  it('includes empty subtype-circle collectives (proactive circles)', () => {
    const emptyCircle = el({ id: 'col2', type: 'collective', name: 'Inner Circle', subtype: 'circle' });
    const plainCollective = el({ id: 'col3', type: 'collective', name: 'Mob' }); // no subtype, holds nothing
    const ids = listKnowers([...world, emptyCircle, plainCollective]).map(e => e.id);
    expect(ids).toContain('col2');
    expect(ids).not.toContain('col3');
  });
  it('sorts collectives before characters', () => {
    const ids = listKnowers(world).map(e => e.id);
    expect(ids.indexOf('col1')).toBeLessThan(ids.indexOf('c2'));
  });
});

describe('lensKnownSet (the known-view lens)', () => {
  it('contains the knower + held entries + their subjects, nothing else', () => {
    // Ireena holds k2 (party membership) → about [c2, loc1].
    expect([...lensKnownSet('c1', world)].sort()).toEqual(['c1', 'c2', 'k2', 'loc1']);
  });
  it('a circle lens covers its directly-held entries + subjects', () => {
    expect([...lensKnownSet('col1', world)].sort()).toEqual(['c2', 'col1', 'k2', 'loc1']);
  });
  it('non-knower → only themself (the rest of the world dims)', () => {
    expect([...lensKnownSet('loc1', world)]).toEqual(['loc1']);
  });
});

describe('knowersOfElement (element-detail "Known by")', () => {
  it('returns the direct holders of entries ABOUT the element', () => {
    // loc1 is a subject of k1 (narrator Strahd), k2 (held by The Party), k3 (no holders).
    expect(knowersOfElement('loc1', world).map(e => e.id).sort()).toEqual(['c2', 'col1']);
  });
  it('does not expand circle members', () => {
    const ids = knowersOfElement('loc1', world).map(e => e.id);
    expect(ids).not.toContain('c1');
    expect(ids).not.toContain('c3');
  });
  it('empty for elements no knowledge is about', () => {
    expect(knowersOfElement('i1', world)).toEqual([]);
    // c1 (Ireena) is a member, not a subject — nothing is about her.
    expect(knowersOfElement('c1', world)).toEqual([]);
  });
});
