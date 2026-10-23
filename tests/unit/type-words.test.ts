/**
 * The names profile in Atlas (schema-dist dist.48, profiles/names.md; contract
 * Forge/Notes/2026-10-22-s455-names-profile-atlas-contract.md).
 *
 * - The profile's 23 cases (names.fixture.json, copied whole) through
 *   `typeName`, the one module every printed type name asks.
 * - N5: a world with no map prints exactly what Atlas printed before.
 * - N1: no other source file reads ELEMENT_LABELS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import namesFixture from '../fixtures/names.fixture.json';
import { typeName, typeNameStart, aTypeName, hasOwnWord, supertypeWord } from '../../src/core/type-words';
import { ELEMENT_LABELS } from '../../src/core/constants';
import { patchSlice, getState } from '../../src/core/state';

const SLUGS = Object.keys(ELEMENT_LABELS) as (keyof typeof ELEMENT_LABELS)[];

describe("the names profile's cases (dist.48)", () => {
  for (const c of namesFixture.cases) {
    it(`${c.name}`, () => {
      const world = { x_names: c.map };
      const supertype = (c as { supertype?: string }).supertype ?? null;
      const many = c.many === true;
      const labels = ELEMENT_LABELS[c.type as keyof typeof ELEMENT_LABELS];
      const standard = labels ? (many ? labels.plural : labels.singular) : c.type;
      expect(typeName(c.type, { world, supertype, many })).toBe(c.word ?? standard);
      // A case's own word exists exactly when the reader found one (its `one` form at least).
      if (c.word !== null) expect(hasOwnWord(c.type, { world, supertype })).toBe(true);
    });
  }
});

describe('a world without a map prints what Atlas printed before (N5)', () => {
  for (const world of [null, {}, { x_names: 'Employee' }, { x_names: { version: 2, types: { character: { one: 'Employee' } } } }]) {
    it(`${JSON.stringify(world)}`, () => {
      for (const t of SLUGS) {
        const { singular, plural } = ELEMENT_LABELS[t];
        expect(typeName(t, { world })).toBe(singular);
        expect(typeName(t, { world, many: true })).toBe(plural);
        expect(typeNameStart(t, { world })).toBe(singular.charAt(0).toUpperCase() + singular.slice(1));
        expect(typeNameStart(t, { world, many: true })).toBe(plural.charAt(0).toUpperCase() + plural.slice(1));
      }
    });
  }
});

describe("a world's word", () => {
  const world = { x_names: { version: 1, types: { character: { one: 'employee', many: 'employees' } }, supertypes: { character: { Agent: { one: 'AI agent' } } } } };

  it('is printed as written, never re-cased, at a line start too', () => {
    expect(typeNameStart('character', { world })).toBe('employee');
    expect(typeNameStart('character', { world, supertype: ' agent ' })).toBe('AI agent');
    expect(typeName('character', { world, supertype: 'Agent', many: true })).toBe('AI agent');
  });

  it('takes its article from the word it prints', () => {
    expect(aTypeName('character', { world })).toBe('an employee');
    expect(aTypeName('character', { world: null })).toBe('a character');
    expect(aTypeName('event', { world: null, start: true })).toBe('An event');
    expect(aTypeName('character', { world, supertype: 'Agent', start: true })).toBe('An AI agent');
  });

  it("names a supertype only when the world has a word for that supertype (Seethe h20 #11028)", () => {
    expect(supertypeWord('character', 'Agent', { world })).toBe('AI agent');
    expect(supertypeWord('character', 'Hero', { world })).toBeNull(); // the type's word, not the supertype's
    expect(supertypeWord('character', 'Agent', { world: null })).toBeNull();
    expect(supertypeWord('character', '', { world })).toBeNull();
    expect(supertypeWord('character', undefined, { world })).toBeNull();
  });

  it("comes from the open world's meta when no world is given", () => {
    const before = getState().active;
    try {
      patchSlice('active', { worldId: 'w-names', meta: { id: 'w-names', name: 'Work', ...world } as never, opened: true });
      expect(typeName('character', { many: true })).toBe('employees');
      expect(typeName('location')).toBe('location');
      patchSlice('active', null);
      expect(typeName('character', { many: true })).toBe('characters');
    } finally {
      patchSlice('active', before);
    }
  });
});

describe('one source (N1)', () => {
  it('no source file but constants.ts and type-words.ts reads ELEMENT_LABELS', () => {
    const root = join(__dirname, '../../src');
    // The share renderer imports no app state (tools/show holds a copy of it),
    // and a published page's payload carries no map: it prints the standard's words.
    const allowed = new Set(['core/constants.ts', 'core/type-words.ts', 'middle/share-page-render.ts']);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!p.endsWith('.ts')) continue;
        const rel = relative(root, p).replace(/\\/g, '/');
        if (allowed.has(rel)) continue;
        const text = readFileSync(p, 'utf8');
        if (/\bELEMENT_LABELS\b/.test(text)) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
