/**
 * Pure helpers from element-detail-fields.ts + element-detail-refs.ts.
 *
 * humanizeFieldName: acronym-aware label conversion. ACRONYMS set is
 * documented in DESIGN.md convention #6 — keep this test in sync if the set
 * changes.
 *
 * refersTo / findIncomingReferences: SDK-shape-agnostic reverse-link scan
 * (convention #5). Critical for the "Referenced By" section — a regression
 * here would silently break backlinks across all element types.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { humanizeFieldName, formatValue } from '../../src/middle/element-detail-fields';
import { refersTo, findIncomingReferences } from '../../src/middle/element-detail-refs';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

describe('humanizeFieldName', () => {
  it('capitalizes simple words', () => {
    expect(humanizeFieldName('name')).toBe('Name');
    expect(humanizeFieldName('description')).toBe('Description');
  });

  it('uppercases known acronyms', () => {
    expect(humanizeFieldName('image_url')).toBe('Image URL');
    expect(humanizeFieldName('api_key')).toBe('API Key');
    expect(humanizeFieldName('ui_state')).toBe('UI State');
    expect(humanizeFieldName('html_content')).toBe('HTML Content');
    expect(humanizeFieldName('uuid')).toBe('UUID');
    expect(humanizeFieldName('sdk_version')).toBe('SDK Version');
  });

  it('handles ACRONYMS additions from session 224', () => {
    // PIN and GPS were added — verify they still uppercase.
    expect(humanizeFieldName('pin_code')).toBe('PIN Code');
    expect(humanizeFieldName('gps_coords')).toBe('GPS Coords');
  });

  it('handles multi-word names with mixed acronyms', () => {
    expect(humanizeFieldName('image_url_thumbnail')).toBe('Image URL Thumbnail');
    expect(humanizeFieldName('api_key_id')).toBe('API Key ID');
  });

  it('handles already-capitalized input', () => {
    expect(humanizeFieldName('Name')).toBe('Name');
    expect(humanizeFieldName('IMAGE_URL')).toBe('Image URL');
  });

  it('handles single character / edge cases', () => {
    expect(humanizeFieldName('')).toBe('');
    expect(humanizeFieldName('a')).toBe('A');
    expect(humanizeFieldName('id')).toBe('ID');
  });
});

describe('formatValue', () => {
  it('returns empty string for null/undefined/empty', () => {
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
    expect(formatValue('')).toBe('');
  });

  it('stringifies non-empty primitives', () => {
    expect(formatValue('hello')).toBe('hello');
    expect(formatValue(42)).toBe('42');
    expect(formatValue(0)).toBe('0');
    expect(formatValue(true)).toBe('true');
    expect(formatValue(false)).toBe('false');
  });

  it('handles arrays and objects by stringifying', () => {
    // Not specifically designed for these but verify it doesn't crash.
    expect(formatValue([1, 2])).toBe('1,2');
    expect(formatValue({ a: 1 })).toBe('[object Object]');
  });
});

describe('refersTo', () => {
  it('returns false when no field references the target id', () => {
    const el = { id: 'a', type: 'character', name: 'Alice' } as Element;
    expect(refersTo(el, 'target-id')).toBe(false);
  });

  it('detects scalar string id references', () => {
    const el = { id: 'a', type: 'character', name: 'Alice', birthplace: 'target-id' } as unknown as Element;
    expect(refersTo(el, 'target-id')).toBe(true);
  });

  it('detects array-of-strings references (multi-link)', () => {
    const el = {
      id: 'a',
      type: 'character',
      name: 'Alice',
      friends: ['x', 'target-id', 'y'],
    } as unknown as Element;
    expect(refersTo(el, 'target-id')).toBe(true);
  });

  it('detects array-of-objects with id (SDK nested shape)', () => {
    const el = {
      id: 'a',
      type: 'character',
      name: 'Alice',
      friends: [{ id: 'x' }, { id: 'target-id' }],
    } as unknown as Element;
    expect(refersTo(el, 'target-id')).toBe(true);
  });

  it('detects object-with-id reference (single-link nested shape)', () => {
    const el = {
      id: 'a',
      type: 'character',
      name: 'Alice',
      birthplace: { id: 'target-id', name: 'Shire' },
    } as unknown as Element;
    expect(refersTo(el, 'target-id')).toBe(true);
  });

  it('ignores metadata fields (id, name, description, type, timestamps)', () => {
    // None of these should be scanned even though the id field literally
    // contains the target string.
    const el = {
      id: 'target-id',
      type: 'character',
      name: 'target-id',
      description: 'target-id',
      local_updated_at: 'target-id',
      server_updated_at: 'target-id',
    } as unknown as Element;
    expect(refersTo(el, 'target-id')).toBe(false);
  });

  it('returns false on close-but-not-equal strings', () => {
    const el = {
      id: 'a',
      type: 'character',
      name: 'Alice',
      birthplace: 'target-i',
    } as unknown as Element;
    expect(refersTo(el, 'target-id')).toBe(false);
  });

  it('detects a page\'s element-card binding via the atlas_page_refs mirror ("Featured in")', () => {
    // The refs mirror (DESIGN_SHARING #75) is a flat string array on the page
    // element, so the generic all-fields walk picks it up with zero
    // page-specific code — a card-bound element shows its pages under
    // "Featured in". Locked here so a future META_KEYS/scan change can't
    // silently kill the section.
    const page = {
      id: 'p1',
      type: 'narrative',
      name: 'barovia primer',
      subtype: 'page',
      atlas_page_blocks: [
        { id: 'b1', kind: 'element-card', elementId: 'target-id', variant: 'compact', fields: [] },
      ],
      atlas_page_refs: ['target-id'],
    } as unknown as Element;
    expect(refersTo(page, 'target-id')).toBe(true);
  });
});

describe('findIncomingReferences', () => {
  beforeEach(() => {
    // Reset state.data.elements to a known fixture.
    patchSlice('data', { elements: [] });
  });

  it('returns empty when no elements reference the target', () => {
    patchSlice('data', {
      elements: [
        { id: 'target', type: 'location', name: 'Shire' } as Element,
        { id: 'a', type: 'character', name: 'Alice' } as Element,
      ],
    });
    expect(findIncomingReferences('target')).toEqual([]);
  });

  it('excludes the target element itself even when self-referential', () => {
    patchSlice('data', {
      elements: [
        // Self-referential element should NOT appear in its own backlinks.
        { id: 'target', type: 'character', name: 'Loop', friends: ['target'] } as unknown as Element,
      ],
    });
    expect(findIncomingReferences('target')).toEqual([]);
  });

  it('finds elements that scalar-reference the target', () => {
    patchSlice('data', {
      elements: [
        { id: 'target', type: 'location', name: 'Shire' } as Element,
        { id: 'a', type: 'character', name: 'Frodo', birthplace: 'target' } as unknown as Element,
        { id: 'b', type: 'character', name: 'Sam' } as Element,
      ],
    });
    const hits = findIncomingReferences('target');
    expect(hits.map(e => e.id)).toEqual(['a']);
  });

  it('finds elements with multi-link references', () => {
    patchSlice('data', {
      elements: [
        { id: 'target', type: 'character', name: 'Bob' } as Element,
        { id: 'a', type: 'character', name: 'Alice', friends: ['target', 'other'] } as unknown as Element,
        { id: 'b', type: 'character', name: 'Carol', friends: ['target'] } as unknown as Element,
      ],
    });
    const hits = findIncomingReferences('target');
    expect(hits.map(e => e.id).sort()).toEqual(['a', 'b']);
  });

  it('aggregates references across multiple element types', () => {
    patchSlice('data', {
      elements: [
        { id: 'target', type: 'location', name: 'Shire' } as Element,
        { id: 'c1', type: 'character', name: 'Frodo', birthplace: 'target' } as unknown as Element,
        { id: 'p1', type: 'pin', name: '', element_id: 'target', map_id: 'm1' } as unknown as Element,
        { id: 'i1', type: 'institution', name: 'Council', locations: ['target'] } as unknown as Element,
      ],
    });
    const hits = findIncomingReferences('target');
    expect(hits.map(e => e.id).sort()).toEqual(['c1', 'i1', 'p1']);
  });
});
