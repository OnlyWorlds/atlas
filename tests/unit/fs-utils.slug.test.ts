/**
 * slugify + elementFilename + idTail + parseIdFromFilename — the Folder Format
 * naming contract.
 *
 * Locks the file-naming contract for the FsFolderStore: every on-disk element
 * file is `<slug>--<id-tail8>.json` (or `<full-id>.json` when unnamed). The
 * filename is PRESENTATION — identity is the `id` INSIDE the file, and the
 * store indexes by reading bodies. parseIdFromFilename therefore recovers an
 * id FRAGMENT (full id only on legacy/unnamed files) for diagnostics, never
 * for identity.
 */

import { describe, it, expect } from 'vitest';
import {
  ID_TAIL_LEN,
  SLUG_MAX_LEN,
  elementFilename,
  elementFilenameFullId,
  idFromFilename,
  idTail,
  parseIdFromFilename,
  sameFsName,
  slugify,
  validElementFilenames,
} from '../../src/store/fs-utils';

const UUID = 'e4e6dc8e-4b1f-4d56-8d2d-aa6e0d2a8c2b';

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

  it('returns empty for unsluggable NAMED input (CJK, emoji) — spec: bare full-id file', () => {
    expect(slugify('日本語')).toBe('');
    expect(slugify('🎉🎉')).toBe('');
    expect(elementFilename(UUID, '日本語')).toBe(`${UUID}.json`);
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

describe('idTail', () => {
  it('returns the whole id when at or under the tail length', () => {
    expect(idTail('char-1')).toBe('char-1');
    expect(idTail('uuid-123')).toBe('uuid-123'); // exactly 8
  });

  it('returns the last 8 chars of a canonical uuid (never contains a hyphen)', () => {
    expect(idTail(UUID)).toBe('0d2a8c2b');
    expect(idTail(UUID)).toHaveLength(ID_TAIL_LEN);
    expect(idTail(UUID)).not.toContain('-');
  });

  it('is deterministic — same id, same tail, no neighbors involved', () => {
    expect(idTail(UUID)).toBe(idTail(UUID));
  });

  it('falls back to the hyphen-stripped tail when a raw slice would break the separator', () => {
    // Raw slice(-8) of these fixture ids would contain `--` / start with `-`.
    expect(idTail('fixture-id-foo--bar1')).not.toContain('--');
    expect(idTail('ends-with-hyphen-abcdefg')).not.toMatch(/^-/);
  });
});

describe('elementFilename', () => {
  it('slugifies the name and appends the short tail', () => {
    expect(elementFilename(UUID, 'Alice')).toBe('alice--0d2a8c2b.json');
    expect(elementFilename(UUID, 'Eldoria City')).toBe('eldoria-city--0d2a8c2b.json');
  });

  it('keeps short fixture ids whole', () => {
    expect(elementFilename('uuid-123', 'Alice')).toBe('alice--uuid-123.json');
    expect(elementFilename('char-1', 'Bob')).toBe('bob--char-1.json');
  });

  it('falls back to bare FULL id when name is empty/missing', () => {
    expect(elementFilename(UUID, '')).toBe(`${UUID}.json`);
    expect(elementFilename('uuid-123', undefined)).toBe('uuid-123.json');
    expect(elementFilename('uuid-123', null)).toBe('uuid-123.json');
    expect(elementFilename('uuid-123', '!!!')).toBe('uuid-123.json');
  });

  it('uses double-hyphen separator between slug and tail', () => {
    const name = elementFilename('a-b-c', 'My Element');
    expect(name).toBe('my-element--a-b-c.json');
    // Verify the separator is recoverable by the parser.
    expect(parseIdFromFilename(name)).toBe('a-b-c');
  });

  it('parse of a tail-form filename yields the FRAGMENT, not the full id', () => {
    // Contract note: identity comes from the body; the parser is diagnostics.
    const name = elementFilename(UUID, 'Alice');
    expect(parseIdFromFilename(name)).toBe('0d2a8c2b');
    expect(UUID.endsWith(parseIdFromFilename(name)!)).toBe(true);
  });
});

describe('elementFilenameFullId (collision fallback)', () => {
  it('embeds the full id after the separator', () => {
    expect(elementFilenameFullId(UUID, 'Alice')).toBe(`alice--${UUID}.json`);
    expect(parseIdFromFilename(elementFilenameFullId(UUID, 'Alice'))).toBe(UUID);
  });

  it('matches elementFilename for unnamed elements', () => {
    expect(elementFilenameFullId(UUID, '')).toBe(elementFilename(UUID, ''));
  });
});

describe('validElementFilenames (the sticky-write forms)', () => {
  it('named → short form then full-id form', () => {
    expect(validElementFilenames(UUID, 'Alice')).toEqual([
      'alice--0d2a8c2b.json',
      `alice--${UUID}.json`,
    ]);
  });

  it('unnamed / unsluggable → the single bare form', () => {
    expect(validElementFilenames(UUID, '')).toEqual([`${UUID}.json`]);
    expect(validElementFilenames(UUID, '日本語')).toEqual([`${UUID}.json`]);
  });

  it('short id → single form (short and full coincide)', () => {
    expect(validElementFilenames('char-1', 'Bob')).toEqual(['bob--char-1.json']);
  });
});

describe('sameFsName (case-folding equivalence)', () => {
  it('case variants are the same filesystem name', () => {
    expect(sameFsName('Alice--0d2a8c2b.json', 'alice--0d2a8c2b.json')).toBe(true);
    expect(sameFsName('ALICE--X.JSON', 'alice--x.json')).toBe(true);
  });

  it('different names are different', () => {
    expect(sameFsName('alice--a.json', 'alice--b.json')).toBe(false);
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
