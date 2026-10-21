/**
 * Custom-fields editor layer (D9) — the pure logic under the element-detail
 * "Custom fields" section:
 *
 *   - customFieldMetasFor: which keys render (machinery excluded, null =
 *     deleted tombstone hidden, '' = live-but-empty shown), widget inference;
 *   - normalizeCustomFieldName: typed name → stored key (x_ auto-prefix,
 *     explicit x_/shadow_ respected, atlas_ preserved so rejection fires,
 *     unicode kept, length capped);
 *   - customFieldNameProblem: schema-collision / machinery / duplicate
 *     rejection, null-tombstone revival allowed;
 *   - humanizeFieldName: prefix stripping for all three namespaces;
 *   - customFieldNameSuggestions: derive-from-world datalist (x_ only,
 *     populated only, frequency-sorted);
 *   - payload disclosure: x_ fields are pickable (NOT card-skipped) while
 *     atlas_ machinery stays skipped — the off-until-ticked gate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  customFieldMetasFor,
  normalizeCustomFieldName,
  customFieldNameProblem,
  profileFieldEntriesFor,
} from '../../src/middle/element-detail-custom-fields';
import { humanizeFieldName } from '../../src/middle/element-detail-fields';
import { customFieldNameSuggestions } from '../../src/core/taxonomy';
import { isCustomEditableField, isPopulatedCustomValue } from '../../src/core/constants';
import { isCardSkipField, populatedFieldNames } from '../../src/core/share-payload';
import { patchSlice, getState } from '../../src/core/state';
import type { Element } from '../../src/core/types';

function makeCharacter(extra: Record<string, unknown> = {}): Element {
  return {
    id: '00000000-0000-4000-8000-0000000000aa',
    type: 'character',
    name: 'Hero',
    local_updated_at: '2026-07-12T10:00:00.000Z',
    ...extra,
  } as Element;
}

describe('customFieldMetasFor', () => {
  it('renders x_/shadow_ fields, hides machinery and null tombstones, keeps empty strings', () => {
    const el = makeCharacter({
      x_mood: 'grim',
      shadow_note: 'hidden',
      x_deleted: null,          // tombstone — hidden
      x_fresh: '',              // live-but-empty — shown
      atlas_aliases: ['Al'],    // machinery — hidden here (renders in Base)
      atlas_page_blocks: [],    // machinery — hidden
      description: 'normal',    // schema field — not custom
    });
    const names = customFieldMetasFor(el).map(m => m.name);
    expect(names).toEqual(['x_mood', 'shadow_note', 'x_fresh']);
  });

  it('infers widgets from value type', () => {
    const el = makeCharacter({
      x_count: 42,
      x_short: 'hi',
      x_long: 'a'.repeat(150),
    });
    const byName = new Map(customFieldMetasFor(el).map(m => [m.name, m.widget]));
    expect(byName.get('x_count')).toBe('number');
    expect(byName.get('x_short')).toBe('text-short');
    expect(byName.get('x_long')).toBe('text-long');
  });
});

describe('normalizeCustomFieldName', () => {
  it('auto-prefixes x_ and slugs the name', () => {
    expect(normalizeCustomFieldName('mood')).toBe('x_mood');
    expect(normalizeCustomFieldName('Population Count')).toBe('x_population_count');
    expect(normalizeCustomFieldName('  spaced  out  ')).toBe('x_spaced_out');
  });

  it('respects explicit x_ and shadow_ prefixes without doubling', () => {
    expect(normalizeCustomFieldName('x_mood')).toBe('x_mood');
    expect(normalizeCustomFieldName('shadow_pop')).toBe('shadow_pop');
  });

  it('keeps atlas_ prefix intact so the reserved rejection fires downstream', () => {
    expect(normalizeCustomFieldName('atlas_evil')).toBe('atlas_evil');
  });

  it('keeps unicode letters (keel accepts them — probed 2026-07-12)', () => {
    expect(normalizeCustomFieldName('émotion')).toBe('x_émotion');
    expect(normalizeCustomFieldName('気分')).toBe('x_気分');
  });

  it('caps length and returns empty for all-punctuation input', () => {
    expect(normalizeCustomFieldName('a'.repeat(200)).length).toBeLessThanOrEqual(62);
    expect(normalizeCustomFieldName('!!! ???')).toBe('');
  });
});

describe('customFieldNameProblem', () => {
  it('rejects empty, atlas_ namespace, schema collisions, and duplicates', () => {
    const el = makeCharacter({ x_mood: 'grim' });
    expect(customFieldNameProblem(el, '')).toMatch(/enter a field name/i);
    expect(customFieldNameProblem(el, 'atlas_evil')).toMatch(/keeps atlas_ names/i);
    // 'height' is a character schema field → the built-in wins
    expect(customFieldNameProblem(el, 'x_height')).toMatch(/built-in/i);
    expect(customFieldNameProblem(el, 'x_mood')).toMatch(/already exists/i);
  });

  it('allows fresh names and revival of null-tombstoned fields', () => {
    const el = makeCharacter({ x_gone: null });
    expect(customFieldNameProblem(el, 'x_brand_new')).toBeNull();
    expect(customFieldNameProblem(el, 'x_gone')).toBeNull();
  });
});

describe('humanizeFieldName prefix stripping', () => {
  it('strips all three extension namespaces', () => {
    expect(humanizeFieldName('x_mood')).toBe('Mood');
    expect(humanizeFieldName('shadow_secret_note')).toBe('Secret note');
    expect(humanizeFieldName('atlas_aliases')).toBe('Aliases');
    expect(humanizeFieldName('x_population_count')).toBe('Population count');
  });
});

describe('customFieldNameSuggestions (derive-from-world datalist)', () => {
  beforeEach(() => {
    patchSlice('data', { ...getState().data, elements: [] });
  });

  it('collects bare x_ names, populated only, frequency-sorted; ignores shadow_/machinery/null', () => {
    patchSlice('data', {
      ...getState().data,
      elements: [
        makeCharacter({ id: 'a1', x_mood: 'grim', x_rank: 1 }),
        makeCharacter({ id: 'a2', x_mood: 'calm' }),
        makeCharacter({ id: 'a3', x_mood: null, x_rank: 2, shadow_note: 'x', atlas_aliases: ['q'], x_empty: '' }),
      ] as Element[],
    });
    expect(customFieldNameSuggestions()).toEqual(['mood', 'rank']);
  });
});

describe('payload disclosure gate (D9-3, locked by construction)', () => {
  it('x_/shadow_ fields are pickable; atlas_ machinery stays card-skipped', () => {
    expect(isCardSkipField('x_mood')).toBe(false);
    expect(isCardSkipField('shadow_note')).toBe(false);
    expect(isCardSkipField('atlas_page_blocks')).toBe(true);
    expect(isCardSkipField('atlas_color')).toBe(true);
    expect(isCardSkipField('image_media_id')).toBe(true);
  });

  it('populatedFieldNames offers custom fields but never machinery or tombstones', () => {
    const el = makeCharacter({
      description: 'd',
      x_mood: 'grim',
      x_gone: null,
      atlas_page_refs: ['r1'],
    });
    const names = populatedFieldNames(el);
    expect(names).toContain('description');
    expect(names).toContain('x_mood');
    expect(names).not.toContain('x_gone');
    expect(names).not.toContain('atlas_page_refs');
  });
});

describe('constants predicates', () => {
  it('isCustomEditableField: namespaces minus machinery', () => {
    expect(isCustomEditableField('x_mood')).toBe(true);
    expect(isCustomEditableField('shadow_note')).toBe(true);
    expect(isCustomEditableField('atlas_custom_rank')).toBe(true);
    expect(isCustomEditableField('atlas_aliases')).toBe(false);
    expect(isCustomEditableField('atlas_shape')).toBe(false);
    expect(isCustomEditableField('description')).toBe(false);
  });

  it('isPopulatedCustomValue: content vs empty vs tombstone', () => {
    expect(isPopulatedCustomValue('grim')).toBe(true);
    expect(isPopulatedCustomValue(0)).toBe(true);
    expect(isPopulatedCustomValue(false)).toBe(true);
    expect(isPopulatedCustomValue(['a'])).toBe(true);
    expect(isPopulatedCustomValue('')).toBe(false);
    expect(isPopulatedCustomValue('  ')).toBe(false);
    expect(isPopulatedCustomValue([])).toBe(false);
    expect(isPopulatedCustomValue(null)).toBe(false);
    expect(isPopulatedCustomValue(undefined)).toBe(false);
  });
});

describe('a published profile key is never a custom field (x_identity_, Skeld h58 #8890)', () => {
  const KEY = '019a1f3c-2b4e-7d10-8c3a-6f2e9b0d4a71';

  it('typed as "Identity key", the name is refused', () => {
    const key = normalizeCustomFieldName('Identity key');
    expect(key).toBe('x_identity_key');
    expect(customFieldNameProblem(makeCharacter(), key)).toMatch(/kept for a shared field/i);
    expect(customFieldNameProblem(makeCharacter(), 'x_identity')).toBeNull();
  });

  it('the work packet\'s keys are kept too (x_packet_, keel PR 148)', () => {
    for (const name of ['x_packet_elements', 'x_packet_source', 'x_packet_producer']) {
      expect(customFieldNameProblem(makeCharacter(), name)).toMatch(/x_packet_/);
    }
    expect(customFieldNameProblem(makeCharacter(), 'x_packet')).toBeNull();
  });

  it('a carried key is no editable row, shows read-only, and is never suggested', () => {
    const el = makeCharacter({ x_identity_key: KEY, x_mood: 'grim' });
    expect(customFieldMetasFor(el).map(m => m.name)).toEqual(['x_mood']);
    expect(profileFieldEntriesFor(el)).toEqual([{ name: 'x_identity_key', value: KEY }]);
    patchSlice('data', { ...getState().data, elements: [el, makeCharacter({ id: 'b2', x_identity_key: KEY })] as Element[] });
    expect(customFieldNameSuggestions()).toEqual(['mood']);
  });
});
