/**
 * Import validation + ChatGPT-fix-prompt (DESIGN_IMPORT.md "Validation spec").
 *
 * Validation is advisory (non-blocking); these assert the issues the UI surfaces
 * and that generateFixPrompt carries all six ValidationIssue fields.
 */

import { describe, it, expect } from 'vitest';
import { parsePayload } from '../../src/import/parse';
import { validatePayload, generateFixPrompt } from '../../src/import/validate';
import type { Element, ElementType } from '../../src/core/types';

const LOC = '068e5110-a410-7cbb-8000-5168e2a14b51';

function existingEl(o: { id: string; type: ElementType; name: string } & Partial<Element>): Element {
  return { local_updated_at: '2026-01-01T00:00:00.000Z', ...o } as Element;
}

describe('validatePayload', () => {
  it('flags a missing name', () => {
    const issues = validatePayload(parsePayload({ Character: [{ description: 'no name' }] }));
    expect(issues.some(i => i.field === 'name' && /missing/i.test(i.issue))).toBe(true);
  });

  it('flags an unknown field', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A', vibe: 'spooky' }] }));
    expect(issues.some(i => i.field === 'vibe' && /unknown field/i.test(i.issue))).toBe(true);
  });

  it('accepts server stamps (created_at/updated_at) — atlas exports carry them', () => {
    const issues = validatePayload(parsePayload({
      Character: [{ name: 'A', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z' }],
    }));
    expect(issues).toEqual([]);
  });

  it('accepts who wrote it (created_by, changed_by, changed_via): a linked world\'s export carries them', () => {
    const issues = validatePayload(parsePayload({
      Character: [{ name: 'A', created_by: null, changed_by: 'b1c2d3e4-0000-4000-8000-000000000001', changed_via: 'seat' }],
    }));
    expect(issues).toEqual([]);
  });

  it('accepts the tools that wrote it (doors, empty or not): a linked world\'s export carries them', () => {
    const issues = validatePayload(parsePayload({
      Character: [{ name: 'A', doors: { atlas: '2026-10-29T10:00:00Z' } }, { name: 'B', doors: null }],
    }));
    expect(issues).toEqual([]);
  });

  it('flags an unknown element-type bucket', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A' }], Widgets: [{ name: 'W' }] }));
    expect(issues.some(i => i.field === 'Widgets' && /unknown element type/i.test(i.issue))).toBe(true);
  });

  // The review printed a missing name in a list with its field twice, "Character[1].rivals[1].rivals" (1.125.3).
  it('a missing link names its path once: the field, and in a list its place', () => {
    const issues = validatePayload(parsePayload({
      Character: [{ name: 'Ada' }, { name: 'Bo', birthplace: 'Nowhere', rivals: ['Ada', 'Ghost'] }],
    }));
    const missing = issues.filter(i => /not found in the import/.test(i.issue)).map(i => i.path).sort();
    expect(missing).toEqual(['Character[1].birthplace', 'Character[1].rivals[1]']);
  });

  it('flags a single_link given an array (wrong cardinality)', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A', birthplace: ['x', 'y'] }] }));
    expect(issues.some(i => i.field === 'birthplace' && /wrong shape/i.test(i.issue))).toBe(true);
  });

  it('flags an unresolved relation name', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A', birthplace: 'Nowhere' }] }));
    expect(issues.some(i => i.field === 'birthplace' && /not found/i.test(i.issue))).toBe(true);
  });

  it('does NOT flag a relation that resolves to an existing element', () => {
    const existing = [existingEl({ id: LOC, type: 'location', name: 'Rivendell' })];
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A', birthplace: 'Rivendell' }] }), existing);
    expect(issues.some(i => i.field === 'birthplace')).toBe(false);
  });

  it('does NOT flag a relation that resolves within the import', () => {
    const issues = validatePayload(parsePayload({
      Character: [{ name: 'A', birthplace: 'Home' }],
      Location: [{ name: 'Home' }],
    }));
    expect(issues.some(i => i.field === 'birthplace')).toBe(false);
  });

  it('passes a clean full-world keep-ids payload with no issues', () => {
    const issues = validatePayload(parsePayload({
      World: { api_key: 'x', name: 'W' },
      Character: [{ id: '068e5012-d77c-799d-8000-95548fbae78d', name: 'The Kid', birthplace: LOC }],
      Location: [{ id: LOC, name: 'Nacogdoches' }],
    }));
    expect(issues).toEqual([]);
  });
});

describe('generateFixPrompt', () => {
  it('returns empty string for no issues', () => {
    expect(generateFixPrompt([])).toBe('');
  });

  it('renders a numbered, paste-back prompt carrying path/issue/expected/fix', () => {
    const issues = validatePayload(parsePayload({ Character: [{ description: 'x' }] }));
    const prompt = generateFixPrompt(issues);
    expect(prompt).toMatch(/^Please fix these OnlyWorlds validation issues/);
    expect(prompt).toMatch(/Issue:/);
    expect(prompt).toMatch(/Expected:/);
    expect(prompt).toMatch(/Fix:/);
    expect(prompt).toMatch(/Once fixed, provide the complete corrected JSON\.$/);
  });
});

describe('validatePayload — §8c envelope forward-compat (unknown fields, present/absent pair)', () => {
  const envelopeWith = (rec: Record<string, unknown>) => parsePayload({
    format: 'onlyworlds-world-export',
    world: { id: 'w1', name: 'W' },
    elements: { character: [rec] },
  });

  it('does NOT flag unknown element fields on an envelope import (future additive bump)', () => {
    const issues = validatePayload(envelopeWith({ name: 'A', future_field: 'from a newer keel' }));
    expect(issues.some(i => /unknown field/i.test(i.issue))).toBe(false);
  });

  it('STILL flags unknown fields on hand-pasted non-envelope JSON (the pair)', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A', future_field: 'x' }] }));
    expect(issues.some(i => i.field === 'future_field' && /unknown field/i.test(i.issue))).toBe(true);
  });

  it('still runs name and relation checks on envelope records (only the unknown-field class is suppressed)', () => {
    const issues = validatePayload(envelopeWith({ description: 'nameless' }));
    expect(issues.some(i => i.field === 'name')).toBe(true);
  });
});

describe('validatePayload — a text or number field holding the wrong kind of value', () => {
  // A story-press fixture: wrong types beside the link faults the review already said.
  const FIXTURE = {
    World: { name: 'Test' },
    Character: [
      { name: 'Vera', birth_date: 'the spring of 1899', birthplace: ['Yalta', 'Moscow'], friends: 'Dmitri', height: 'tall', physicality: { hair: 'fair' }, location: 'Nowhere' },
      { name: 'Dmitri', rivals: ['Vera', 'Ghost'] },
      { name: 'Dmitri' },
    ],
    Location: [{ name: 'Yalta' }],
    Place: [{ name: 'X' }],
  };

  it('says each one with the element and the field, before anything is added', () => {
    const issues = validatePayload(parsePayload(FIXTURE));
    const typed = (field: string) => issues.find(i => i.path === `Character[0].${field}` && /takes/.test(i.issue));
    expect(typed('birth_date')?.issue).toBe('"Vera": Birth date takes a whole number; here it holds "the spring of 1899"');
    expect(typed('height')?.issue).toBe('"Vera": Height takes a whole number; here it holds "tall"');
    expect(typed('physicality')?.issue).toBe('"Vera": Physicality takes text; here it holds a group of fields');
    // The link faults are said as before, once each.
    expect(issues.filter(i => i.field === 'birthplace' || i.field === 'friends')).toHaveLength(2);
  });

  it('takes what onlyworlds.com and Atlas write: a numeric string, a number, an unset field', () => {
    const issues = validatePayload(parsePayload({ Character: [
      { name: 'A', birth_date: '1899', height: 180, weight: '', physicality: 'tall and fair', mentality: null },
      { name: 'B', description: 12 },
    ] }));
    expect(issues.filter(i => /takes/.test(i.issue))).toEqual([]);
  });

  it('a whole-number field refuses a fraction; a list in a text field is said as a list', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A', height: 180.5, background: ['a', 'b'] }] }));
    expect(issues.find(i => i.field === 'height')?.issue).toBe('"A": Height takes a whole number; here it holds 180.5');
    expect(issues.find(i => i.field === 'background')?.issue).toBe('"A": Background takes text; here it holds a list');
  });

  it('true or false in a text field is said as a yes or no', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A', background: true }] }));
    expect(issues.find(i => i.field === 'background')?.issue).toBe('"A": Background takes text; here it holds true, a yes or no');
  });

  it('a nameless element is named by its type and place', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A' }, { height: 'tall' }] }));
    expect(issues.find(i => i.field === 'height')?.issue).toMatch(/^Character 2: Height takes a whole number/);
  });

  it('says it on an envelope import too (the unknown-field class is the only one an envelope suppresses)', () => {
    const issues = validatePayload(parsePayload({
      format: 'onlyworlds-world-export', world: { id: 'w1', name: 'W' },
      elements: { character: [{ name: 'A', physicality: { hair: 'fair' } }] },
    }));
    expect(issues.some(i => i.field === 'physicality' && /takes text/.test(i.issue))).toBe(true);
  });
});
