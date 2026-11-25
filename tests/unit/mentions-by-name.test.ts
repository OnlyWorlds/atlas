/**
 * The Featured badge and "is it still mentioned after an unlink" read a name
 * as the hints do: the SDK's nameFinder, folded case, a word edge in every
 * script. Before, each read an ASCII `\b` with case as written, so `Éowyn`
 * was never found and `kira` never `Kira`, while the hints found both.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mentionsByName } from '../../src/core/prose-autolink';
import { isElementFeatured } from '../../src/tabs/right/context-pane-preview';
import type { Element } from '../../src/core/types';

const el = (name: string, aliases: string[] = [], id = `0192a000-0000-7000-8000-${String(name.length).padStart(12, '0')}`): Element =>
  ({ id, type: 'character', name, atlas_aliases: aliases } as unknown as Element);
const story = (text: string): Element => ({ id: 'n1', type: 'narrative', name: 'N', story: text } as unknown as Element);

describe('mentionsByName', () => {
  it('finds a name whose edge is not an ASCII letter', () => {
    expect(mentionsByName(el('Éowyn'), 'Then Éowyn rode.')).toBe(true);
    expect(mentionsByName(el('Zoë'), 'Zoë left.')).toBe(true);
    expect(mentionsByName(el('C++ (old)'), 'It ran on C++ (old) once.')).toBe(true);
  });
  it('reads case folded, as the hints do', () => {
    expect(mentionsByName(el('Kira'), 'and kira slept')).toBe(true);
  });
  it('a name inside a longer word is no mention, in any script', () => {
    expect(mentionsByName(el('Ana'), 'Anaïs smiled.')).toBe(false);
    expect(mentionsByName(el('Bram'), 'Bramble grew.')).toBe(false);
  });
  it('an alias counts', () => {
    expect(mentionsByName(el('Hegemony Consul', ['the Consul']), 'and the Consul sat')).toBe(true);
  });
  it('a name under three code points is not looked for, as the hints do not look for it', () => {
    expect(mentionsByName(el('Al'), 'Al went home.')).toBe(false);
  });
});

describe('the Featured badge', () => {
  it('is lit by a name with an accent at its edge', () => {
    expect(isElementFeatured(el('Éowyn'), story('Then Éowyn rode.'))).toBe(true);
  });
  it('is lit by the name in another case', () => {
    expect(isElementFeatured(el('Kira'), story('kira slept.'))).toBe(true);
  });
  it('is not lit by a name inside a longer word', () => {
    expect(isElementFeatured(el('Ana'), story('Anaïs smiled.'))).toBe(false);
  });
});

describe('no name scanner of its own', () => {
  // The shape the three old scanners had: `new RegExp('\\b' + escaped + '\\b')`. The tour's category
  // words (`'\\b(' + …`) are the standard's type words in its own English copy, not a name.
  it('no source file builds an ASCII word-edge regex around a name', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
    });
    const hits = walk(join(__dirname, '..', '..', 'src')).filter(f => /new RegExp\(\s*['"`]\\\\b['"`]\s*\+/.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });
});
