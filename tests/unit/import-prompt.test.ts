/**
 * The convert-my-notes prompt: the field whitelist is GENERATED from
 * the SDK FIELD_SCHEMA at runtime, so the prompt is schema-true by
 * construction. These tests lock the digest's grammar and coverage — if the
 * schema grows a type or renames a field, the prompt follows automatically
 * and these stay green; if the generator breaks, they catch it.
 */

import { describe, it, expect } from 'vitest';
import { buildSchemaDigest, buildConvertNotesPrompt } from '../../src/middle/import-room';
import { ALL_ELEMENT_TYPES } from '../../src/core/types';

describe('buildSchemaDigest — the generated field whitelist', () => {
  const digest = buildSchemaDigest();
  const lines = digest.split('\n');

  it('covers every element type, one line each, PascalCase keys', () => {
    expect(lines.length).toBe(ALL_ELEMENT_TYPES.length);
    for (const t of ALL_ELEMENT_TYPES) {
      const cap = t.charAt(0).toUpperCase() + t.slice(1);
      expect(lines.some(l => l.startsWith(`${cap}: `))).toBe(true);
    }
  });

  it('marks numbers, single links, and multi links with the documented grammar', () => {
    const character = lines.find(l => l.startsWith('Character: '))!;
    expect(character).toContain('#birth_date');            // number
    expect(character).toContain('location>Location');       // single link
    expect(character).toContain('species>>Species');        // multi link
    expect(character).toContain('description');             // bare text
  });

  it('never leaks atlas-internal fields or the name field', () => {
    expect(digest).not.toContain('atlas_');
    expect(digest).not.toMatch(/: name[,\n]/);
  });

  it('spatial types carry their bare schema link names (pin>Map, not map_id)', () => {
    const pin = lines.find(l => l.startsWith('Pin: '))!;
    expect(pin).toContain('map>Map');
    expect(pin).not.toContain('map_id');
  });
});

describe('buildConvertNotesPrompt', () => {
  it('embeds the digest and the core rules', () => {
    const p = buildConvertNotesPrompt();
    expect(p).toContain('The field list per type:');
    expect(p).toContain(buildSchemaDigest());
    expect(p).toContain('sparse is valid');
    expect(p).toContain('Return only the JSON');
    expect(p).toContain('x_');
  });
});
