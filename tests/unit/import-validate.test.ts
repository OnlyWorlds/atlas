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

  it('flags an unknown element-type bucket', () => {
    const issues = validatePayload(parsePayload({ Character: [{ name: 'A' }], Widgets: [{ name: 'W' }] }));
    expect(issues.some(i => i.field === 'Widgets' && /unknown element type/i.test(i.issue))).toBe(true);
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
