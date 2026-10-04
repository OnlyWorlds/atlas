/**
 * The problem classifier and the report scrubber (S368, lane X).
 * Every sentence is the user's: never the raw error text, never an em-dash.
 */
import { describe, it, expect } from 'vitest';
import {
  PlainError, buildDetails, buildFailureDetails, classifyError, describeBrowser, problemFor,
  problemWasShown, markProblemShown, scrubForReport, type ProblemKind,
} from '../../src/core/problems';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { CorruptFileError } from '../../src/store/fs-utils';
import { ELockHeld } from '../../src/store/folder-store-fs';
import { RekeyRefusedError } from '../../src/store/rekey';
import { RekeyPendingError } from '../../src/store/folder-store';
import { DuplicatePinError, isDuplicatePinError } from '../../src/core/pin-uniqueness';
import { DownloadCancelledError } from '../../src/sync/initial-download';

const RAW = 'An operation that depends on state cached in an interface object was made';
const dom = (name: string) => new DOMException(RAW, name);

const CASES: [string, unknown, ProblemKind][] = [
  ['InvalidStateError', dom('InvalidStateError'), 'disk-busy'],
  ['NoModificationAllowedError', dom('NoModificationAllowedError'), 'disk-busy'],
  ['NotReadableError', dom('NotReadableError'), 'disk-busy'],
  ['InvalidModificationError', dom('InvalidModificationError'), 'disk-busy'],
  ['NotAllowedError', dom('NotAllowedError'), 'disk-permission'],
  ['SecurityError', dom('SecurityError'), 'disk-permission'],
  ['NotFoundError', dom('NotFoundError'), 'disk-missing'],
  ['QuotaExceededError', dom('QuotaExceededError'), 'disk-full'],
  ['AbortError', dom('AbortError'), 'cancelled'],
  ['another DOMException', dom('DataError'), 'bug'],
  ['CorruptFileError', new CorruptFileError('world.json', new SyntaxError('Unexpected token < in JSON at position 0')), 'disk-damaged'],
  ['ELockHeld', new ELockHeld({ tab_id: '1a2b3c4d-1111-2222-3333-444455556666', last_heartbeat: '2026-10-04T10:00:00Z' } as never), 'tab-lock'],
  ['401', new OwV2Error(401, { code: 'invalid_credentials', message: 'Invalid PIN for key ow_w_secret123' }, ''), 'auth'],
  ['403 revoked', new OwV2Error(403, { code: 'key_revoked', message: 'revoked' }, ''), 'auth'],
  ['429', new OwV2Error(429, { code: 'rate_limited', message: 'slow down' }, ''), 'server-busy'],
  ['503', new OwV2Error(503, { code: 'server_busy', message: 'busy' }, ''), 'server-busy'],
  ['500', new OwV2Error(500, null, '<!DOCTYPE html><html>boom</html>'), 'server'],
  ['422', new OwV2Error(422, { code: 'invalid', message: "name 'Aldric Vane' is too long", param: 'name' }, ''), 'server-refused'],
  ['legacy API Error 502', new Error('API Error 502: bad gateway'), 'server'],
  ['offline', new TypeError('Failed to fetch'), 'offline'],
  ['PlainError', new PlainError('That map has no image yet.'), 'refused'],
  ['RekeyRefusedError', new RekeyRefusedError('Nothing here needs a new id.'), 'refused'],
  ['RekeyPendingError', new RekeyPendingError(), 'refused'],
  ['DuplicatePinError', new DuplicatePinError('p1'), 'refused'],
  ['DownloadCancelledError', new DownloadCancelledError(), 'refused'],
  ['MergeRefusedError by name', Object.assign(new Error('Route 2 needs a PIN first.'), { name: 'MergeRefusedError' }), 'refused'],
  ['plain bug', new Error('writeJsonAtomic: final file does not match intent for aldric-vane--1a2b3c4d.json'), 'bug'],
  ['a thrown string', 'oops', 'bug'],
];

describe('classifyError', () => {
  for (const [label, err, kind] of CASES) {
    it(`${label} is ${kind}`, () => expect(classifyError(err)).toBe(kind));
  }
});

describe('problemFor', () => {
  for (const [label, err, kind] of CASES) {
    if (kind === 'refused' || kind === 'cancelled') continue;
    it(`${label}: the sentence holds neither the raw text nor an em-dash`, () => {
      const p = problemFor(err, { doing: 'saving this scene' });
      expect(p.kind).toBe(kind);
      const raw = err instanceof Error ? err.message : String(err);
      expect(p.sentence).not.toContain(raw);
      expect(p.sentence).not.toContain('—');
      expect(p.sentence).not.toMatch(/\bAPI\b|engine|registry|\bstore\b/i);
      expect(p.sentence.length).toBeGreaterThan(20);
    });
  }

  it('says what Atlas was doing', () => {
    expect(problemFor(dom('NoModificationAllowedError'), { doing: 'saving this scene' }).sentence)
      .toContain('could not finish saving this scene');
  });

  it('names a damaged file and the fix, not the parser text', () => {
    const p = problemFor(new CorruptFileError('world.json', new SyntaxError('Unexpected token <')));
    expect(p.sentence).toContain('world.json');
    expect(p.sentence).toContain('fix or remove the file');
    expect(p.sentence).not.toContain('Unexpected token');
    expect(p.fixes).toContain('reload-from-disk');
  });

  it('passes a PlainError through untouched, and its subclasses keep their names', () => {
    const err = new RekeyRefusedError('The tour world keeps its ids.');
    expect(err).toBeInstanceOf(PlainError);
    expect(err).toBeInstanceOf(RekeyRefusedError);
    expect(err.name).toBe('RekeyRefusedError');
    expect(problemFor(err).sentence).toBe('The tour world keeps its ids.');
    expect(isDuplicatePinError(new DuplicatePinError('x'))).toBe(true);
  });

  it('offers the right buttons', () => {
    expect(problemFor(dom('NotAllowedError')).fixes).toEqual(['allow-access']);
    expect(problemFor(dom('InvalidStateError')).fixes).toEqual(['retry']);
    expect(problemFor(new Error('x')).fixes).toContain('send-feedback');
    expect(problemFor(dom('AbortError')).quiet).toBe(true);
  });

  it('remembers an error it already showed', () => {
    const err = new Error('x');
    expect(problemWasShown(err)).toBe(false);
    markProblemShown(err);
    expect(problemWasShown(err)).toBe(true);
    expect(problemWasShown('a string')).toBe(false);
  });
});

describe('scrubForReport', () => {
  it('strips ids, keys, numbers, emails, queries, names and element files', () => {
    expect(scrubForReport('element 1a2b3c4d-1111-2222-3333-444455556666 failed')).toBe('element <id> failed');
    expect(scrubForReport('key ow_w_abc123 refused')).toBe('key <key> refused');
    expect(scrubForReport('pin 1234567890 bad')).toBe('pin <number> bad');
    expect(scrubForReport('mail titus@example.com now')).toBe('mail <email> now');
    expect(scrubForReport('GET https://x.test/api?a=b&pin=1')).toBe('GET https://x.test/api?<query>');
    expect(scrubForReport("name 'Aldric Vane' is too long")).toBe('name "…" is too long');
    expect(scrubForReport('name "Aldric Vane" is too long')).toBe('name "…" is too long');
    expect(scrubForReport('could not write aldric-vane--1a2b3c4d.json')).toBe('could not write <file>');
  });

  it('caps at 600 characters', () => {
    const out = scrubForReport('x '.repeat(1000));
    expect(out.length).toBe(600);
  });
});

describe('buildDetails', () => {
  const ctx = { world: 'linked' as const, syncPaused: false, now: new Date('2026-10-04T10:11:12.345Z'), browser: 'Chrome 141, Windows' };

  it('carries version, browser, world mode, doing, kind, scrubbed error and UTC time', () => {
    const err = new Error("writeJsonAtomic: final file does not match intent for aldric-vane--1a2b3c4d.json 'Aldric'");
    const text = buildDetails(problemFor(err, { doing: 'saving this scene' }), ctx);
    expect(text).toMatch(/^Atlas \d+\.\d+\.\d+/);
    expect(text).toContain('Browser: Chrome 141, Windows');
    expect(text).toContain('World: linked, sync on');
    expect(text).toContain('While: saving this scene');
    expect(text).toContain('Kind: bug');
    expect(text).toContain('Error: Error: writeJsonAtomic: final file does not match intent for <file> "…"');
    expect(text).toContain('Time: 2026-10-04T10:11:12Z');
    expect(text).not.toMatch(/aldric/i);
  });

  it('never carries a refusal\'s own words (they can name elements)', () => {
    const text = buildDetails(problemFor(new RekeyRefusedError('Aldric Vane is already uploaded; it keeps its id.')), ctx);
    expect(text).toContain('Error: RekeyRefusedError');
    expect(text).not.toContain('Aldric');
  });

  it('lists at most three sync failures, scrubbed', () => {
    const f = (i: number) => ({ type: 'character', operation: 'update', error_name: 'InvalidStateError', message: `bad aldric--${i}abc.json for ow_w_k${i}` });
    const text = buildFailureDetails([f(1), f(2), f(3), f(4)], ctx);
    expect(text).toContain('Failed: 4');
    expect(text).toContain('- character update: InvalidStateError: bad <file> for <key>');
    expect(text).toContain('and 1 more');
    expect(text).not.toMatch(/aldric|ow_w_/i);
  });

  it('names the browser from client hints or the user agent', () => {
    expect(describeBrowser({ userAgentData: { brands: [{ brand: 'Not=A?Brand', version: '24' }, { brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141' }], platform: 'Windows' } }))
      .toBe('Chrome 141, Windows');
    expect(describeBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0' }))
      .toBe('Firefox 131, Windows');
  });
});
