/**
 * Tests for the prose-link → relation-field auto-derive (convention #50).
 */

import { describe, it, expect } from 'vitest';
import type { Element } from '../../src/core/types';
import {
  extractProseLinks,
  computeRelationPatch, linkTargetsIn,
  NARRATIVE_RELATION_FIELDS,
} from '../../src/middle/writing-workspace-derive';

function makeNarrative(overrides: Partial<Element> = {}): Element {
  return {
    id: 'narr-1',
    type: 'narrative',
    name: 'Test scene',
    ...overrides,
  } as Element;
}

describe('extractProseLinks', () => {
  it('returns empty object on empty markdown', () => {
    expect(extractProseLinks('')).toEqual({});
  });

  it('parses a single character link', () => {
    const md = 'Hello [Drizzle](ow://character/abc-123)';
    expect(extractProseLinks(md)).toEqual({ character: ['abc-123'] });
  });

  it('groups multiple types', () => {
    const md = `[A](ow://character/c-1) walked into [B](ow://location/l-1) and saw [C](ow://character/c-2).`;
    const result = extractProseLinks(md);
    expect(result.character).toEqual(['c-1', 'c-2']);
    expect(result.location).toEqual(['l-1']);
  });

  it('dedupes repeated uuids of the same type', () => {
    const md = `[Hal](ow://character/c-1) said hi. Later [Halloway](ow://character/c-1) returned.`;
    expect(extractProseLinks(md)).toEqual({ character: ['c-1'] });
  });

  it('is case-insensitive on element type', () => {
    const md = `[X](ow://CHARACTER/c-1)`;
    expect(extractProseLinks(md)).toEqual({ character: ['c-1'] });
  });

  it('handles UUIDs with hyphens correctly', () => {
    const md = `[X](ow://event/abc-12345-67890-abcdef)`;
    expect(extractProseLinks(md)).toEqual({ event: ['abc-12345-67890-abcdef'] });
  });
});

// Every target exists: the behaviour these tests were written for.
const ANY = () => true;

describe('computeRelationPatch', () => {
  // S364 lane A2: a chip can outlive its element (a delete scrubs link fields
  // and leaves prose alone), and the derive used to write the dead id back.
  it('does not derive a link to an element that no longer exists', () => {
    const narr = makeNarrative({ characters: [] } as any);
    const md = `[Gone](ow://character/dead-1) and [Here](ow://character/c-1)`;
    const exists = linkTargetsIn([{ id: 'c-1', type: 'character' } as any]);
    expect(computeRelationPatch(narr, md, exists)).toEqual({ characters: ['c-1'] });
  });

  it('does not derive an id into the wrong field when the chip names the wrong type', () => {
    const narr = makeNarrative();
    const md = `[X](ow://location/c-1)`;
    const exists = linkTargetsIn([{ id: 'c-1', type: 'character' } as any]);
    expect(computeRelationPatch(narr, md, exists)).toEqual({});
  });

  it('keeps an entry already in the field even when its target is gone (the scrub owns removal)', () => {
    const narr = makeNarrative({ characters: ['dead-1'] } as any);
    const md = `[Gone](ow://character/dead-1)`;
    expect(computeRelationPatch(narr, md, linkTargetsIn([]))).toEqual({});
  });

  it('returns empty patch when no prose links exist', () => {
    const narr = makeNarrative({ characters: ['existing-1'] } as any);
    expect(computeRelationPatch(narr, 'Some prose without links.', ANY)).toEqual({});
  });

  it('adds prose-derived uuids to empty relation field', () => {
    const narr = makeNarrative();
    const md = `[Drizzle](ow://character/c-1) and [Hal](ow://character/c-2).`;
    expect(computeRelationPatch(narr, md, ANY)).toEqual({ characters: ['c-1', 'c-2'] });
  });

  it('UNIONs prose-derived with existing manual entries (preserves manual)', () => {
    const narr = makeNarrative({ characters: ['manual-1', 'manual-2'] } as any);
    const md = `[Manual1](ow://character/manual-1) [New](ow://character/new-1)`;
    expect(computeRelationPatch(narr, md, ANY)).toEqual({ characters: ['manual-1', 'manual-2', 'new-1'] });
  });

  it('returns no-op when prose adds nothing new', () => {
    const narr = makeNarrative({ characters: ['c-1'] } as any);
    const md = `[X](ow://character/c-1)`;
    expect(computeRelationPatch(narr, md, ANY)).toEqual({});
  });

  it('groups multiple element types into their respective fields', () => {
    const narr = makeNarrative();
    const md = `[A](ow://character/c-1) walked into [B](ow://location/l-1).`;
    const patch = computeRelationPatch(narr, md, ANY);
    expect(patch).toEqual({
      characters: ['c-1'],
      locations: ['l-1'],
    });
  });

  it('ignores element types that have no Narrative relation field (e.g. pin)', () => {
    const narr = makeNarrative();
    const md = `[A](ow://pin/p-1)`;
    expect(computeRelationPatch(narr, md, ANY)).toEqual({});
  });
});

describe('NARRATIVE_RELATION_FIELDS', () => {
  it('maps every content element type to a multi-link field', () => {
    const expectedTypes = [
      'character', 'location', 'event', 'object', 'species', 'creature',
      'institution', 'trait', 'collective', 'zone', 'ability', 'phenomenon',
      'language', 'family', 'relation', 'title', 'construct', 'law',
    ];
    for (const t of expectedTypes) {
      expect((NARRATIVE_RELATION_FIELDS as Record<string, string | null>)[t]).toBeTruthy();
    }
  });

  it('returns null for types that have no Narrative relation field', () => {
    expect(NARRATIVE_RELATION_FIELDS.narrative).toBeNull();
    expect(NARRATIVE_RELATION_FIELDS.map).toBeNull();
    expect(NARRATIVE_RELATION_FIELDS.pin).toBeNull();
    expect(NARRATIVE_RELATION_FIELDS.marker).toBeNull();
  });
});
