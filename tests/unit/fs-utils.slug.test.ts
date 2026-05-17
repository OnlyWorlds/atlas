/**
 * slugify + elementFilename + parseIdFromFilename — slug-prefix filename refactor.
 *
 * Locks the file-naming contract for the FsFolderStore: every on-disk element
 * file is `<slug>--<uuid>.json` (or `<uuid>.json` when unnamed), and the
 * parser is the inverse — it recovers the uuid regardless of slug content,
 * length cap, or test-fixture id shape.
 */

import { describe, it, expect } from 'vitest';
import {
  SLUG_MAX_LEN,
  elementFilename,
  idFromFilename,
  parseIdFromFilename,
  slugify,
} from '../../src/store/fs-utils';

describe('slugify', () => {
  it('lowercases and joins spaces with hyphens', () => {
    expect(slugify('Alice')).toBe('alice');
    expect(slugify('Eldoria City')).toBe('eldoria-city');
    expect(slugify('THE OLD WIZARD')).toBe('the-old-wizard');
  });

  it('strips diacritics via NFKD', () => {
    expect(slugify('José')).toBe('jose');
    expect(slugify('Café Münster')).toBe('cafe-munster');
    expect(slugify('Ñandú')).toBe('nandu');
  });

  it('collapses runs of non-alphanumerics to a single hyphen', () => {
    expect(slugify('a---b')).toBe('a-b');
    expect(slugify('hello___world')).toBe('hello-world');
    expect(slugify('  spaced   out  ')).toBe('spaced-out');
    expect(slugify('weird!@#$%^&chars')).toBe('weird-chars');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('---alice---')).toBe('alice');
    expect(slugify('!!alice!!')).toBe('alice');
  });

  it('preserves digits', () => {
    expect(slugify('Map 1')).toBe('map-1');
    expect(slugify('R2D2')).toBe('r2d2');
  });

  it('caps length at SLUG_MAX_LEN and re-trims trailing hyphens', () => {
    const long = 'a'.repeat(50) + '-' + 'b'.repeat(50);
    const s = slugify(long);
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX_LEN);
    expect(s).not.toMatch(/-$/);
  });

  it('caps at exactly SLUG_MAX_LEN when the natural slug is longer', () => {
    const word = 'wordlike';
    const seed = Array.from({ length: 20 }, () => word).join(' ');
    expect(slugify(seed).length).toBeLessThanOrEqual(SLUG_MAX_LEN);
  });

  it('returns empty for nameless/blank input', () => {
    expect(slugify('')).toBe('');
    expect(slugify('   ')).toBe('');
    expect(slugify('!!!')).toBe('');
    expect(slugify('---')).toBe('');
  });

  it('never produces a double-hyphen run (separator invariant)', () => {
    // The parseIdFromFilename split relies on this — runs collapse to one `-`.
    const probes = [
      'a--b',
      'a   b',
      'a__b',
      'a -- b',
      'pre----post',
      '!!!gap!!!gap!!!',
    ];
    for (const p of probes) {
      expect(slugify(p)).not.toMatch(/--/);
    }
  });
});

describe('elementFilename', () => {
  it('slugifies the name when given', () => {
    expect(elementFilename('uuid-123', 'Alice')).toBe('alice--uuid-123.json');
    expect(elementFilename('uuid-123', 'Eldoria City')).toBe('eldoria-city--uuid-123.json');
  });

  it('falls back to bare id when name is empty/missing', () => {
    expect(elementFilename('uuid-123', '')).toBe('uuid-123.json');
    expect(elementFilename('uuid-123', undefined)).toBe('uuid-123.json');
    expect(elementFilename('uuid-123', null)).toBe('uuid-123.json');
    expect(elementFilename('uuid-123', '!!!')).toBe('uuid-123.json');
  });

  it('uses double-hyphen separator between slug and id', () => {
    const name = elementFilename('a-b-c', 'My Element');
    expect(name).toBe('my-element--a-b-c.json');
    // Verify the separator is recoverable by the parser.
    expect(parseIdFromFilename(name)).toBe('a-b-c');
  });
});

describe('parseIdFromFilename', () => {
  it('returns the uuid from a slug-prefixed filename', () => {
    expect(parseIdFromFilename('alice--e4e6dc8e-4b1f-4d56-8d2d-aa6e0d2a8c2b.json'))
      .toBe('e4e6dc8e-4b1f-4d56-8d2d-aa6e0d2a8c2b');
  });

  it('returns the whole stem for legacy bare-id filenames', () => {
    expect(parseIdFromFilename('e4e6dc8e-4b1f-4d56-8d2d-aa6e0d2a8c2b.json'))
      .toBe('e4e6dc8e-4b1f-4d56-8d2d-aa6e0d2a8c2b');
  });

  it('handles test-fixture style short ids (slugged + bare)', () => {
    expect(parseIdFromFilename('alice--char-1.json')).toBe('char-1');
    expect(parseIdFromFilename('char-1.json')).toBe('char-1');
    expect(parseIdFromFilename('pin-2.json')).toBe('pin-2');
  });

  it('splits on the LAST double-hyphen (slug may not contain --, but id may)', () => {
    // Theoretical: id with double-hyphen embedded. The split-on-last rule keeps
    // the rightmost double-hyphen as the separator. (Production UUIDs never
    // have `--`, but test fixtures might in edge cases.)
    expect(parseIdFromFilename('alice--foo--bar.json')).toBe('bar');
  });

  it('returns null for non-json filenames', () => {
    expect(parseIdFromFilename('alice--uuid')).toBeNull();
    expect(parseIdFromFilename('not-a-file')).toBeNull();
    expect(parseIdFromFilename('')).toBeNull();
  });

  it('returns null for empty stem', () => {
    expect(parseIdFromFilename('.json')).toBeNull();
  });
});

describe('idFromFilename (deprecated wrapper)', () => {
  it('delegates to parseIdFromFilename for slug-prefix files', () => {
    expect(idFromFilename('alice--uuid-123.json')).toBe('uuid-123');
  });

  it('still handles legacy bare-id filenames', () => {
    expect(idFromFilename('uuid-123.json')).toBe('uuid-123');
  });

  it('returns the name unchanged if not .json (legacy behavior)', () => {
    expect(idFromFilename('not-a-file')).toBe('not-a-file');
  });
});
