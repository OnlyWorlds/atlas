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
import { refersTo, findIncomingReferences, renderReferencedBy } from '../../src/middle/element-detail-refs';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

describe('humanizeFieldName', () => {
  it('capitalizes simple words', () => {
    expect(humanizeFieldName('name')).toBe('Name');
    expect(humanizeFieldName('description')).toBe('Description');
  });

  it('is sentence case: only the first word takes a capital (the Captain, h63 #8074; Seethe F-28)', () => {
    expect(humanizeFieldName('birth_date')).toBe('Birth date');
    expect(humanizeFieldName('primary_power')).toBe('Primary power');
  });

  it('uppercases known acronyms', () => {
    expect(humanizeFieldName('image_url')).toBe('Image URL');
    expect(humanizeFieldName('api_key')).toBe('API key');
    expect(humanizeFieldName('ui_state')).toBe('UI state');
    expect(humanizeFieldName('html_content')).toBe('HTML content');
    expect(humanizeFieldName('uuid')).toBe('UUID');
    expect(humanizeFieldName('sdk_version')).toBe('SDK version');
  });

  it('handles ACRONYMS additions from session 224', () => {
    // PIN and GPS were added — verify they still uppercase.
    expect(humanizeFieldName('pin_code')).toBe('PIN code');
    expect(humanizeFieldName('gps_coords')).toBe('GPS coords');
  });

  it('handles multi-word names with mixed acronyms', () => {
    expect(humanizeFieldName('image_url_thumbnail')).toBe('Image URL thumbnail');
    expect(humanizeFieldName('api_key_id')).toBe('API key ID');
  });

  it('handles already-capitalized input', () => {
    expect(humanizeFieldName('Name')).toBe('Name');
    // A word written in capitals stays as written (SDK 4.36, Kael h63 #8201): a stat block reads STR.
    expect(humanizeFieldName('IMAGE_URL')).toBe('IMAGE URL');
    expect(humanizeFieldName('x_STR')).toBe('STR');
    expect(humanizeFieldName('x_max_HP')).toBe('Max HP');
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

// ---- D9b taxonomy helpers -------------------------------------------------

import { suggestionsForField, reservedValueHint } from '../../src/middle/element-detail-fields';

function chr(id: string, extra: Record<string, unknown> = {}): Element {
  return { id, type: 'character', name: id, ...extra } as unknown as Element;
}

describe('suggestionsForField (D9b autocomplete — derive, never track)', () => {
  beforeEach(() => {
    patchSlice('active', null);
    patchSlice('data', { elements: [] });
  });

  it('returns null for non-taxonomy fields', () => {
    patchSlice('data', { elements: [chr('a', { supertype: 'hero' })] });
    expect(suggestionsForField(chr('x'), 'description')).toBeNull();
    expect(suggestionsForField(chr('x'), 'name')).toBeNull();
  });

  it('derives distinct same-type values, most-used first', () => {
    patchSlice('data', {
      elements: [
        chr('a', { supertype: 'villain' }),
        chr('b', { supertype: 'hero' }),
        chr('c', { supertype: 'hero' }),
        chr('d', { supertype: '  hero  ' }),           // trimmed + merged
        { id: 'l1', type: 'location', name: 'l1', supertype: 'city' } as unknown as Element, // other type ignored
      ],
    });
    expect(suggestionsForField(chr('x'), 'supertype')).toEqual(['hero', 'villain']);
  });

  it('returns null when the world has no values for the pair', () => {
    patchSlice('data', { elements: [chr('a'), chr('b', { supertype: '' })] });
    expect(suggestionsForField(chr('x'), 'subtype')).toBeNull();
  });

  it('pins the four writing-tier labels first for narrative supertype', () => {
    patchSlice('active', { worldId: 'w-taxo', meta: { name: 'W' }, opened: true } as never);
    patchSlice('data', {
      elements: [
        { id: 'n1', type: 'narrative', name: 'n1', supertype: 'Legend' } as unknown as Element,
      ],
    });
    const got = suggestionsForField({ id: 'n', type: 'narrative', name: 'n' } as Element, 'supertype');
    // Default labels Book/Chapter/Scene/Draft pinned in tier order, derived values after.
    expect(got?.slice(0, 4)).toEqual(['Book', 'Chapter', 'Scene', 'Draft']);
    expect(got).toContain('Legend');
  });
});

describe('reservedValueHint (D9b reserved-value awareness)', () => {
  beforeEach(() => {
    patchSlice('active', { worldId: 'w-taxo', meta: { name: 'W' }, opened: true } as never);
    patchSlice('data', { elements: [] });
  });

  it('flags writing-tier supertypes on narratives — case-SENSITIVE like tierFor', () => {
    const n = (supertype: string) =>
      ({ id: 'n', type: 'narrative', name: 'n', supertype }) as unknown as Element;
    expect(reservedValueHint(n('Book'), 'supertype')).toMatch(/writing tree/);
    expect(reservedValueHint(n('book'), 'supertype')).toBeNull(); // the tree would NOT match this
  });

  it('flags knowledge/page subtypes on narratives — case-insensitive like the predicates', () => {
    const n = (subtype: string) =>
      ({ id: 'n', type: 'narrative', name: 'n', subtype }) as unknown as Element;
    expect(reservedValueHint(n('knowledge'), 'subtype')).toMatch(/knowledge entry/);
    expect(reservedValueHint(n('Knowledge'), 'subtype')).toMatch(/knowledge entry/);
    expect(reservedValueHint(n('page'), 'subtype')).toMatch(/share page/);
  });

  it('flags circle subtype on collectives, nothing on other types', () => {
    const col = { id: 'c', type: 'collective', name: 'c', subtype: 'circle' } as unknown as Element;
    expect(reservedValueHint(col, 'subtype')).toMatch(/knowledge circle/);
    expect(reservedValueHint(chr('x', { subtype: 'circle' }), 'subtype')).toBeNull();
    expect(reservedValueHint(chr('x', { supertype: 'Book' }), 'supertype')).toBeNull();
  });
});

describe('REF_SECTION_SPLITS - Located here (S317)', () => {
  const mk = (id: string, type: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ id, type, name, ...extra }) as unknown as Element;

  it('pulls location-field sources into "Located here" above Referenced by, typed groups in order', () => {
    const planet = mk('loc1', 'location', 'Planet');
    const consul = mk('c1', 'character', 'Consul', { location: 'loc1' });
    const beast = mk('cr1', 'creature', 'Beast', { location: 'loc1' });
    const perf = mk('e1', 'event', 'Perf', { location: 'loc1' }); // context, not presence
    const dual = mk('c2', 'character', 'Dual', { location: 'loc1', birthplace: 'loc1' });
    patchSlice('data', { elements: [planet, consul, beast, perf, dual] });

    const wrap = renderReferencedBy(planet)!;
    expect(wrap).toBeTruthy();
    const sections = [...wrap.querySelectorAll('.atlas-detail-section')];
    const labels = sections.map(s => s.getAttribute('data-section'));
    expect(labels).toContain('Located here');
    expect(labels).toContain('Linked from');
    expect(labels.indexOf('Located here'), 'Located here renders ABOVE Referenced by')
      .toBeLessThan(labels.indexOf('Linked from'));

    const located = sections[labels.indexOf('Located here')]!;
    // Real things present; the event (context) is not.
    for (const name of ['Consul', 'Beast', 'Dual']) expect(located.textContent).toContain(name);
    expect(located.textContent).not.toContain('Perf');
    // Group order: characters lead, creatures follow (the split's sourceTypes order).
    const groupLabels = [...located.querySelectorAll('.atlas-field-label')].map(g => g.textContent);
    expect(groupLabels.indexOf('Characters')).toBeLessThan(groupLabels.indexOf('Creatures'));

    const refby = sections[labels.indexOf('Linked from')]!;
    expect(refby.textContent).toContain('Perf'); // event stays in the generic bucket
    expect(refby.textContent).toContain('Dual'); // kept for its OTHER field (birthplace)
    expect(refby.textContent).not.toContain('Consul'); // fully moved
    expect(refby.textContent).not.toContain('Beast');
  });

  it('a source referencing ONLY via location leaves Referenced by entirely (no empty bucket)', () => {
    const planet = mk('loc9', 'location', 'Lonely');
    const consul = mk('c9', 'character', 'OnlyOne', { location: 'loc9' });
    patchSlice('data', { elements: [planet, consul] });
    const wrap = renderReferencedBy(planet)!;
    const labels = [...wrap.querySelectorAll('.atlas-detail-section')].map(s => s.getAttribute('data-section'));
    expect(labels).toContain('Located here');
    expect(labels).not.toContain('Linked from');
  });

  it('non-location pages never grow the section', () => {
    const hero = mk('h1', 'character', 'Hero');
    const fan = mk('f1', 'character', 'Fan', { location: 'h1' }); // nonsense link, but generic scan sees it
    patchSlice('data', { elements: [hero, fan] });
    const wrap = renderReferencedBy(hero)!;
    const labels = [...wrap.querySelectorAll('.atlas-detail-section')].map(s => s.getAttribute('data-section'));
    expect(labels).not.toContain('Located here');
  });
});
