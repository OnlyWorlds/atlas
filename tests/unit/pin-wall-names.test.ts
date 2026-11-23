/**
 * keel's PIN wall (a 429 whose `param` is the PIN header) counts different wrong values of `API-Pin` on
 * one world key. For an account world those are World PINs, for a seat its seat secrets, and where Atlas
 * cannot tell, either. Every place the wall's sentence is built says which, and no sentence a person
 * reads says "PINs" alone. A seat's lost credential is its seat secret, by that name.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { OwApiError } from '@onlyworlds/sdk';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { problemFor } from '../../src/core/problems';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { pinAskWaitLine, pinCheckWaitLine, rateWaitLine } from '../../src/sync/rate-wait';
import { addRefusal } from '../../src/sync/element-files';
import { SharingApiError, sharingErrorMessage } from '../../src/sync/sharing-client';
import { SEAT_SECRET_MISSING_LINE } from '../../src/core/seat';

const ACCOUNT_WALL = "OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while";
const EITHER_WALL = "OnlyWorlds refused too many different World PINs or seat secrets for this world's key, so it takes none for a while";

const OWN = {
  id: 'local-own', name: 'Owned', state: 'api-linked',
  api: { world_id: 'w-own', api_key: 'ow_w_' + 'o'.repeat(32) },
} as unknown as WorldRegistryEntry;

beforeEach(() => {
  patchSlice('registry', { ...defaultRegistry(), worlds: [OWN] });
  patchSlice('active', null as never);
});

describe('the PIN wall names what it counts', () => {
  const wall = () => new OwV2Error(429, { code: 'rate_limited', message: 'm', param: 'API-Pin' }, '', '600');

  it('a problem\'s sentence (problems.ts)', () => {
    expect(problemFor(wall(), { doing: 'saving', worldId: OWN.id }).sentence)
      .toBe(`${ACCOUNT_WALL}, and Atlas could not finish saving. Check the World PIN in Settings; try again in 10 minutes.`);
    expect(problemFor(wall(), { doing: 'saving' }).sentence)
      .toBe(`${EITHER_WALL}, and Atlas could not finish saving. Check the World PIN or seat secret in Settings; try again in 10 minutes.`);
  });

  it('the sync\'s wait (rate-wait.ts)', () => {
    expect(rateWaitLine(true, 60_000, 'in this browser', 'account'))
      .toBe(`${ACCOUNT_WALL}. Check the World PIN in Settings; Atlas tries again in 60 seconds.`);
    expect(rateWaitLine(true, 60_000, 'in this browser'))
      .toBe(`${EITHER_WALL}. Check the World PIN or seat secret in Settings; Atlas tries again in 60 seconds.`);
  });

  // Settings' PIN check and the World PIN dialog ask about the account's World PIN only.
  it('the World PIN\'s own checks inside the wall (rate-wait.ts)', () => {
    expect(pinCheckWaitLine(true, 60_000))
      .toBe(`${ACCOUNT_WALL}. This World PIN is not checked by OnlyWorlds yet; OnlyWorlds takes World PINs again in 60 seconds.`);
    expect(pinAskWaitLine(true, 60_000)).toBe(`${ACCOUNT_WALL}. Try again in 60 seconds.`);
  });

  it('a file\'s add (element-files.ts)', () => {
    const wallErr = new OwApiError(429, 'rate_limited', 'm', null, {}, null, 'API-Pin', 600);
    expect(addRefusal(wallErr, { size: 1 }, 'account'))
      .toBe(`${ACCOUNT_WALL}. Nothing was added. Check the World PIN in Settings; try again in 10 minutes.`);
    expect(addRefusal(wallErr, { size: 1 }, 'unknown'))
      .toBe(`${EITHER_WALL}. Nothing was added. Check the World PIN or seat secret in Settings; try again in 10 minutes.`);
  });

  it('a page\'s publish (sharing-client.ts)', () => {
    const wallErr = new SharingApiError('rate_limited', 429, undefined, 'API-Pin');
    expect(sharingErrorMessage(wallErr, 'account'))
      .toBe(`${ACCOUNT_WALL}. Nothing changed. Check the World PIN in Settings, then try again later.`);
    expect(sharingErrorMessage(wallErr))
      .toBe(`${EITHER_WALL}. Nothing changed. Check the World PIN or seat secret in Settings, then try again later.`);
  });
});

describe('a seat\'s lost credential is its seat secret', () => {
  it('the line of a seat world with no secret here (seat.ts)', () => {
    expect(SEAT_SECRET_MISSING_LINE).toBe('This world was opened on a seat, and this browser no longer has its seat secret, so it cannot sync.');
  });
});

const SRC = join(__dirname, '..', '..', 'src');

/** Every string literal in src, comments, console lines and the changelog left out, with where it is. */
function literals(): Array<{ at: string; lit: string }> {
  const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
  });
  const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
  const out: Array<{ at: string; lit: string }> = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file).split(sep).join('/');
    if (rel === 'changelog/changelog.data.ts') continue;
    readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(\/\/|\/\*|\*)/.test(line) || /console\./.test(line)) return;
      for (const lit of line.match(STRINGS) ?? []) out.push({ at: `${rel}:${i + 1}`, lit });
    });
  }
  return out;
}

/** A sentence that says "PINs" with no "World" before it, or a seat's credential as a bare secret. */
const OLD_WORDS = /different PINs|(?<!World )\bPINs\b|\bits secret,|\bthe secret of\b/;

describe('the census of the words', () => {
  it('no sentence a person reads says "different PINs", "PINs" alone, or a seat\'s bare secret', () => {
    expect(literals().filter(({ lit }) => OLD_WORDS.test(lit)).map(h => `${h.at} ${h.lit}`)).toEqual([]);
  });

  it('the instrument sees the old words and lets the new ones be', () => {
    expect(OLD_WORDS.test("'OnlyWorlds refused too many different PINs for this world.'")).toBe(true);
    expect(OLD_WORDS.test('`OnlyWorlds takes PINs again in ${when}.`')).toBe(true);
    expect(OLD_WORDS.test("'this browser no longer has its secret, so it cannot sync.'")).toBe(true);
    expect(OLD_WORDS.test('`the secret of each world opened on a seat`')).toBe(true);
    expect(OLD_WORDS.test(`'${ACCOUNT_WALL}.'`)).toBe(false);
    expect(OLD_WORDS.test(`'${EITHER_WALL}.'`)).toBe(false);
    expect(OLD_WORDS.test("'this browser no longer has its seat secret, so it cannot sync.'")).toBe(false);
  });
});
