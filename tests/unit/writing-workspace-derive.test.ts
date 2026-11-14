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
    const md = 'Hello [Drizzle](ow://character/00000000-0000-0000-0061-62632d313233)';
    expect(extractProseLinks(md)).toEqual({ character: ['00000000-0000-0000-0061-62632d313233'] });
  });

  it('groups multiple types', () => {
    const md = `[A](ow://character/00000000-0000-0000-0000-000000632d31) walked into [B](ow://location/00000000-0000-0000-0000-0000006c2d31) and saw [C](ow://character/00000000-0000-0000-0000-000000632d32).`;
    const result = extractProseLinks(md);
    expect(result.character).toEqual(['00000000-0000-0000-0000-000000632d31', '00000000-0000-0000-0000-000000632d32']);
    expect(result.location).toEqual(['00000000-0000-0000-0000-0000006c2d31']);
  });

  it('dedupes repeated uuids of the same type', () => {
    const md = `[Hal](ow://character/00000000-0000-0000-0000-000000632d31) said hi. Later [Halloway](ow://character/00000000-0000-0000-0000-000000632d31) returned.`;
    expect(extractProseLinks(md)).toEqual({ character: ['00000000-0000-0000-0000-000000632d31'] });
  });

  // The address profile, as the SDK reads it (1.124.2): the type word is
  // lowercase only, the id is an id, read lowercase in either case of hex.
  it('a type word in capitals is plain text, not a link', () => {
    const md = `[X](ow://CHARACTER/00000000-0000-0000-0000-000000632d31) and ow://Character/00000000-0000-0000-0000-000000632d31`;
    expect(extractProseLinks(md)).toEqual({});
  });

  it('without the world, an id is given as written; with it, as the rule names it', () => {
    const md = `[X](ow://event/00000000-0000-0000-0000-000000632D31)`;
    expect(extractProseLinks(md)).toEqual({ event: ['00000000-0000-0000-0000-000000632D31'] });
    const world = linkTargetsIn([{ id: '00000000-0000-0000-0000-000000632d31', type: 'event' } as any]);
    expect(extractProseLinks(md, world)).toEqual({ event: ['00000000-0000-0000-0000-000000632d31'] });
  });

  it('an id that is not an id is no link', () => {
    expect(extractProseLinks(`[X](ow://event/abc-12345-67890-abcdef) ow://character/abc`)).toEqual({});
  });

  it('text run on after the id is prose: the address names the id', () => {
    const md = `see ow://character/00000000-0000-0000-0000-000000632d31x and ow://character/00000000-0000-0000-0000-000000632d32_x.`;
    expect(extractProseLinks(md)).toEqual({
      character: ['00000000-0000-0000-0000-000000632d31', '00000000-0000-0000-0000-000000632d32'],
    });
  });

  it('a moment and a lens do not change the element named', () => {
    const md = `[X](ow://character/00000000-0000-0000-0000-000000632d31@12?lens=00000000-0000-0000-0000-000000632d32).`;
    expect(extractProseLinks(md)).toEqual({ character: ['00000000-0000-0000-0000-000000632d31'] });
  });
});

describe('an upper-case address and the derive (1.124.2)', () => {
  const LOWER = '00000000-0000-0000-0000-000000632d31';
  it('a scene naming a lowercase element in capitals derives the relation', () => {
    const narr = makeNarrative();
    const exists = linkTargetsIn([{ id: LOWER, type: 'character' } as any]);
    expect(computeRelationPatch(narr, `[X](ow://character/${LOWER.toUpperCase()})`, exists)).toEqual({ characters: [LOWER] });
  });
  it('an element whose own id is held in capitals is named as written, never by the lowercase id', () => {
    const narr = makeNarrative();
    const exists = linkTargetsIn([{ id: LOWER.toUpperCase(), type: 'character' } as any]);
    expect(computeRelationPatch(narr, `[X](ow://character/${LOWER.toUpperCase()})`, exists)).toEqual({ characters: [LOWER.toUpperCase()] });
    expect(computeRelationPatch(narr, `[X](ow://character/${LOWER})`, exists)).toEqual({});
  });
});

// Every target exists: the behaviour these tests were written for.
const ANY = () => true;

describe('computeRelationPatch', () => {
  // A chip can outlive its element (a delete scrubs link fields
  // and leaves prose alone), and the derive used to write the dead id back.
  it('does not derive a link to an element that no longer exists', () => {
    const narr = makeNarrative({ characters: [] } as any);
    const md = `[Gone](ow://character/00000000-0000-0000-0000-646561642d31) and [Here](ow://character/00000000-0000-0000-0000-000000632d31)`;
    const exists = linkTargetsIn([{ id: '00000000-0000-0000-0000-000000632d31', type: 'character' } as any]);
    expect(computeRelationPatch(narr, md, exists)).toEqual({ characters: ['00000000-0000-0000-0000-000000632d31'] });
  });

  it('does not derive an id into the wrong field when the chip names the wrong type', () => {
    const narr = makeNarrative();
    const md = `[X](ow://location/00000000-0000-0000-0000-000000632d31)`;
    const exists = linkTargetsIn([{ id: '00000000-0000-0000-0000-000000632d31', type: 'character' } as any]);
    expect(computeRelationPatch(narr, md, exists)).toEqual({});
  });

  it('keeps an entry already in the field even when its target is gone (the scrub owns removal)', () => {
    const narr = makeNarrative({ characters: ['00000000-0000-0000-0000-646561642d31'] } as any);
    const md = `[Gone](ow://character/00000000-0000-0000-0000-646561642d31)`;
    expect(computeRelationPatch(narr, md, linkTargetsIn([]))).toEqual({});
  });

  it('returns empty patch when no prose links exist', () => {
    const narr = makeNarrative({ characters: ['00000000-0000-6578-6973-74696e672d31'] } as any);
    expect(computeRelationPatch(narr, 'Some prose without links.', ANY)).toEqual({});
  });

  it('adds prose-derived uuids to empty relation field', () => {
    const narr = makeNarrative();
    const md = `[Drizzle](ow://character/00000000-0000-0000-0000-000000632d31) and [Hal](ow://character/00000000-0000-0000-0000-000000632d32).`;
    expect(computeRelationPatch(narr, md, ANY)).toEqual({ characters: ['00000000-0000-0000-0000-000000632d31', '00000000-0000-0000-0000-000000632d32'] });
  });

  it('UNIONs prose-derived with existing manual entries (preserves manual)', () => {
    const narr = makeNarrative({ characters: ['00000000-0000-0000-6d61-6e75616c2d31', '00000000-0000-0000-6d61-6e75616c2d32'] } as any);
    const md = `[Manual1](ow://character/00000000-0000-0000-6d61-6e75616c2d31) [New](ow://character/00000000-0000-0000-0000-006e65772d31)`;
    expect(computeRelationPatch(narr, md, ANY)).toEqual({ characters: ['00000000-0000-0000-6d61-6e75616c2d31', '00000000-0000-0000-6d61-6e75616c2d32', '00000000-0000-0000-0000-006e65772d31'] });
  });

  it('returns no-op when prose adds nothing new', () => {
    const narr = makeNarrative({ characters: ['00000000-0000-0000-0000-000000632d31'] } as any);
    const md = `[X](ow://character/00000000-0000-0000-0000-000000632d31)`;
    expect(computeRelationPatch(narr, md, ANY)).toEqual({});
  });

  it('groups multiple element types into their respective fields', () => {
    const narr = makeNarrative();
    const md = `[A](ow://character/00000000-0000-0000-0000-000000632d31) walked into [B](ow://location/00000000-0000-0000-0000-0000006c2d31).`;
    const patch = computeRelationPatch(narr, md, ANY);
    expect(patch).toEqual({
      characters: ['00000000-0000-0000-0000-000000632d31'],
      locations: ['00000000-0000-0000-0000-0000006c2d31'],
    });
  });

  it('ignores element types that have no Narrative relation field (e.g. pin)', () => {
    const narr = makeNarrative();
    const md = `[A](ow://pin/00000000-0000-0000-0000-000000702d31)`;
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
