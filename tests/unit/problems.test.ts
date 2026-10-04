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

  it('says changes are safe in the folder only when the caller says so (S369)', () => {
    const offline = new TypeError('Failed to fetch');
    expect(problemFor(offline, { doing: 'signing in' }).sentence).not.toMatch(/saved/);
    expect(problemFor(offline, { doing: 'uploading changes', savedLocally: true }).sentence).toContain('Your changes are saved in the folder');
    const busy = new OwV2Error(503, { code: 'server_busy', message: 'busy' }, '');
    expect(problemFor(busy, { doing: 'linking the world' }).sentence).not.toMatch(/saved/);
  });

  it('a refused folder pick is not the open world\'s folder, and gets no Allow access (S369)', () => {
    const denied = dom('NotAllowedError');
    const picked = problemFor(denied, { doing: 'choosing a folder', folder: 'picked' });
    expect(picked.sentence).toContain('did not let Atlas use that folder');
    expect(picked.sentence).not.toContain("this world's folder");
    expect(picked.fixes).not.toContain('allow-access');
    expect(problemFor(denied, { doing: 'opening this world' }).fixes).toContain('allow-access');
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
    expect(scrubForReport('GET https://x.test/api?a=b&pin=1')).toBe('GET https://x.test/…');
    expect(scrubForReport("name 'Aldric Vane' is too long")).toBe('name "…" is too long');
    expect(scrubForReport('name "Aldric Vane" is too long')).toBe('name "…" is too long');
    expect(scrubForReport('could not write aldric-vane--1a2b3c4d.json')).toBe('could not write <file>');
  });

  it('strips paths of every shape (S369: the 1.15 changelog promised it)', () => {
    for (const [input, out] of [
      ['could not open C:\\Users\\titus\\Worlds\\Aldric\\world.json now', 'could not open <path> now'],
      ['could not open \\\\nas\\share\\Aldric\\world.json', 'could not open <path>'],
      ['could not open /Users/titus/Worlds/Aldric/world.json', 'could not open <path>'],
      ['could not open /home/titus now', 'could not open <path> now'],
      ['could not open file:///C:/Users/titus/Aldric/world.json', 'could not open <path>'],
      ['wrote elements/character/notes.json', 'wrote <path>'],
      ['under worlds\\Aldric', 'under <path>'],
    ] as const) {
      expect(scrubForReport(input)).toBe(out);
      expect(scrubForReport(input)).not.toMatch(/titus|aldric/i);
    }
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
    expect(text).toContain('Error: Error');
    expect(text).toContain('Message: writeJsonAtomic: final file does not match intent for <file>');
    expect(text).toContain('Time: 2026-10-04T10:11:12Z');
    expect(text).not.toMatch(/aldric/i);
  });

  it('never carries a refusal\'s own words (they can name elements)', () => {
    const text = buildDetails(problemFor(new RekeyRefusedError('Aldric Vane is already uploaded; it keeps its id.')), ctx);
    expect(text).toContain('Error: RekeyRefusedError');
    expect(text).not.toContain('Aldric');
  });

  it('lists at most three sync failures, by type, operation, source, name, status and code only', () => {
    const f = (i: number) => ({ type: 'character', operation: 'update', error_name: 'InvalidStateError', source: 'disk', message: `bad aldric--${i}abc.json for ow_w_k${i}` });
    const server = { type: 'location', operation: 'create', error_name: 'OwV2Error', source: 'server', status: 422, code: 'invalid', param: 'x_secret_lair', message: 'Moon Base is not a valid location for Aldric Vane' };
    const text = buildFailureDetails([server, f(1), f(2), f(3)], ctx);
    expect(text).toContain('Failed: 4');
    expect(text).toContain('- location create: server, OwV2Error, 422, invalid, field (custom)');
    expect(text).toContain('- character update: disk, InvalidStateError');
    expect(text).toContain('and 1 more');
    expect(text).not.toMatch(/aldric|ow_w_|moon|secret/i);
  });
});

// ---------------------------------------------------------------------------
// The promise (S369): the details block never carries a world or element
// name, a path, a key or an email, whatever the error kind. Names below are
// planted UNQUOTED and in every place an error can carry them; only the bug
// kind prints a message at all, and its residue is scrubbed.
// ---------------------------------------------------------------------------
describe('details never leak (every kind)', () => {
  const ctx = { world: 'local' as const, now: new Date('2026-10-04T10:00:00Z'), browser: 'Chrome 141, Windows' };
  const LEAK = /aldric|vane|moon ?base|titus|ow_[wra]_|@example|C:\\|\/Users\//i;
  const planted = 'Aldric Vane and Moon Base at C:\\Users\\titus\\Moon Base\\aldric-vane--1a2b3c4d.json, key ow_w_secret, mail titus@example.com';
  const withName = (name: string) => { const e = new Error(planted); e.name = name; return e; };
  const ERRORS: unknown[] = [
    ...CASES.map(([, err]) => err),
    withName('InvalidStateError'), withName('NotAllowedError'), withName('NotFoundError'),
    withName('QuotaExceededError'), withName('SyntaxError'),
    new OwV2Error(422, { code: 'invalid', message: planted, param: 'x_aldric_secret' }, ''),
    new OwV2Error(500, null, planted),
    new OwV2Error(401, { code: 'invalid_credentials', message: planted }, ''),
    new TypeError(`Failed to fetch ${planted}`),
    new PlainError(planted),
    new Error(planted),
    planted,
  ];

  for (const [i, err] of ERRORS.entries()) {
    it(`error ${i} (${classifyError(err)})`, () => {
      const text = buildDetails(problemFor(err, { doing: 'saving this scene' }), ctx);
      expect(text).not.toMatch(LEAK);
    });
  }

  it('a sync failure list built from any of them', () => {
    const failures = ERRORS.map((err, i) => ({
      type: 'character', operation: 'update', message: String((err as Error)?.message ?? err),
      error_name: (err as Error)?.name, code: (err as { code?: string })?.code, param: (err as { param?: string })?.param ?? undefined,
      source: i % 2 ? 'server' : 'disk',
    }));
    for (let i = 0; i < failures.length; i += 3) {
      expect(buildFailureDetails(failures.slice(i, i + 3), ctx)).not.toMatch(LEAK);
    }
  });

  it('names the browser from client hints or the user agent', () => {
    expect(describeBrowser({ userAgentData: { brands: [{ brand: 'Not=A?Brand', version: '24' }, { brand: 'Chromium', version: '141' }, { brand: 'Google Chrome', version: '141' }], platform: 'Windows' } }))
      .toBe('Chrome 141, Windows');
    expect(describeBrowser({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0' }))
      .toBe('Firefox 131, Windows');
  });
});
