/**
 * Pure helpers from element-detail-fields.ts + element-detail-refs.ts.
 *
 * humanizeFieldName: acronym-aware label conversion. ACRONYMS set is
 * documented in DESIGN.md convention #6 — keep this test in sync if the set
 * changes.
 *
 * refersTo / findIncomingReferences: the reverse links through the graph
 * reader and Atlas's named links (conv. 185). Critical for the "Referenced by"
 * section: a regression here would silently break backlinks across all types.
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

  it('is sentence case: only the first word takes a capital (Titus, 2026-10-20; Seethe F-28)', () => {
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

  it('handles ACRONYMS additions', () => {
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
    // A word written in capitals stays as written (SDK 4.36, Kael 2026-10-20): a stat block reads STR.
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

// The reverse links behind Referenced by, Linked from and Home's loose threads (conv. 185): the graph
// reader's links (the standard's typed link fields and the declared x_ links) and Atlas's own, named in
// core/world-links.ts (map space as Atlas keeps it, a page's bound elements); an id in any other key,
// or a link to the wrong type, is no reference.
const R = (n: number) => `0698bbbb-0000-7000-8000-${String(n).padStart(12, '0')}`;
const T = R(1);
const mkR = (id: string, type: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type, name: `${type} ${id.slice(-2)}`, ...extra }) as unknown as Element;

describe('refersTo', () => {
  const place = mkR(T, 'location');
  const person = mkR(T, 'character');

  it('returns false when no field references the target id', () => {
    const el = mkR(R(2), 'character');
    expect(refersTo(el, T, [el, place])).toBe(false);
  });

  it('detects a typed single link and a multi link', () => {
    const born = mkR(R(2), 'character', { birthplace: T });
    expect(refersTo(born, T, [born, place])).toBe(true);
    const friend = mkR(R(3), 'character', { friends: [R(9), T] });
    expect(refersTo(friend, T, [friend, person])).toBe(true);
  });

  it('a link to the wrong type is no reference (a birthplace naming a Character)', () => {
    const el = mkR(R(2), 'character', { birthplace: T });
    expect(refersTo(el, T, [el, person])).toBe(false);
  });

  it('an id kept in another key is no reference: a dismissed suggestion, an undeclared x_ key, a text field', () => {
    const el = mkR(R(2), 'narrative', { atlas_dismissed_suggestions: [T], x_survey_ref: T, description: T, supertype: T });
    expect(refersTo(el, T, [el, place])).toBe(false);
  });

  it('the {id} object form is not a link the standard writes', () => {
    const el = mkR(R(2), 'character', { friends: [{ id: T }], birthplace: { id: T } });
    expect(refersTo(el, T, [el, person])).toBe(false);
  });

  it('detects a page\'s element-card binding via the atlas_page_refs mirror ("Featured in")', () => {
    // The refs mirror (DESIGN_SHARING #75) is one of Atlas's named links (core/world-links.ts).
    const page = mkR(R(2), 'narrative', {
      subtype: 'page',
      atlas_page_blocks: [{ id: 'b1', kind: 'element-card', elementId: T, variant: 'compact', fields: [] }],
      atlas_page_refs: [T],
    });
    expect(refersTo(page, T, [page, place])).toBe(true);
  });

  it('map space as Atlas keeps it: a pin names its element and its map, a marker its map and zone, in either spelling', () => {
    const map = mkR(R(5), 'map');
    const zone = mkR(R(6), 'zone');
    const pin = mkR(R(2), 'pin', { element_id: T, map_id: R(5), x: 1, y: 1 });
    const world = [pin, place, map, zone];
    expect(refersTo(pin, T, world)).toBe(true);
    expect(refersTo(pin, R(5), world)).toBe(true);
    // An empty zone_id reads the bare spelling (the 1.117.0 gate's N8).
    const marker = mkR(R(3), 'marker', { map: R(5), zone_id: '', zone: R(6), x: 1, y: 1 });
    expect(refersTo(marker, R(6), [marker, map, zone])).toBe(true);
    expect(refersTo(marker, R(5), [marker, map, zone])).toBe(true);
  });
});

describe('findIncomingReferences', () => {
  beforeEach(() => {
    patchSlice('data', { elements: [] });
  });

  it('returns empty when no elements reference the target', () => {
    patchSlice('data', { elements: [mkR(T, 'location'), mkR(R(2), 'character')] });
    expect(findIncomingReferences(T)).toEqual([]);
  });

  it('excludes the target element itself even when self-referential', () => {
    patchSlice('data', { elements: [mkR(T, 'character', { friends: [T] })] });
    expect(findIncomingReferences(T)).toEqual([]);
  });

  it('finds elements that link to the target, in the world\'s order', () => {
    patchSlice('data', {
      elements: [
        mkR(T, 'location'),
        mkR(R(2), 'character', { birthplace: T }),
        mkR(R(3), 'character'),
        mkR(R(4), 'character', { location: T }),
      ],
    });
    expect(findIncomingReferences(T).map(e => e.id)).toEqual([R(2), R(4)]);
  });

  it('aggregates across types: typed links, a pin, a page; never a dismissed suggestion', () => {
    patchSlice('data', {
      elements: [
        mkR(T, 'location'),
        mkR(R(2), 'character', { birthplace: T }),
        mkR(R(3), 'pin', { element_id: T, map_id: R(7), x: 1, y: 1 }),
        mkR(R(4), 'family', { estates: [T] }),
        mkR(R(5), 'narrative', { subtype: 'page', atlas_page_refs: [T] }),
        mkR(R(6), 'narrative', { atlas_dismissed_suggestions: [T] }),
        mkR(R(7), 'map'),
      ],
    });
    expect(findIncomingReferences(T).map(e => e.id).sort()).toEqual([R(2), R(3), R(4), R(5)].sort());
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

describe('REF_SECTION_SPLITS - Located here', () => {
  const mk = (id: string, type: string, name: string, extra: Record<string, unknown> = {}) =>
    ({ id, type, name, ...extra }) as unknown as Element;

  it('pulls location-field sources into "Located here" above Referenced by, typed groups in order', () => {
    const planet = mk('loc1', 'location', 'Planet');
    const consul = mk('c1', 'character', 'Consul', { location: 'loc1' });
    const beast = mk('cr1', 'creature', 'Beast', { location: 'loc1' });
    const perf = mk('e1', 'event', 'Perf', { locations: ['loc1'] }); // context, not presence (an Event's link is locations)
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
    const fan = mk('f1', 'character', 'Fan', { location: 'h1' }); // a location naming a Character: no link at all (conv. 185)
    patchSlice('data', { elements: [hero, fan] });
    expect(renderReferencedBy(hero)).toBeNull();
  });
});
