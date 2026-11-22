/**
 * A seat world sends its seat secret as `API-Pin`, never the World PIN (R1), so no line about a seat's
 * refusal, PIN wall or missing credential says "World PIN" (1.125.3, round 2). Each line names the World
 * PIN for an account world, the seat secret for a seat, and, where the code cannot know the world, both:
 * "the World PIN or seat secret" (1.125.5). The credential has one spelling, "seat secret", and the PIN
 * wall on a seat counts its seat secrets.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { problemFor } from '../../src/core/problems';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { rateWaitLine } from '../../src/sync/rate-wait';
import { SharingApiError, sharingErrorMessage } from '../../src/sync/sharing-client';
import { missingCredentialWords } from '../../src/middle/share-room';
import { keyCheckError } from '../../src/setup/key-check-errors';
import { linkPinRefusal } from '../../src/setup/atlas-root-flow';
import { seatRefusalPill } from '../../src/sync/world-key-lines';
import { addRefusal, pinRefusedLine } from '../../src/sync/element-files';
import { OwApiError } from '@onlyworlds/sdk';
import { resolveFixes } from '../../src/ui/problem-fixes';

const SEAT = {
  id: 'local-seat', name: 'Seated', state: 'api-linked',
  api: { world_id: 'w-seat', api_key: 'ow_w_' + 's'.repeat(32), seat: { role: 'contributor' }, seat_secret: 'ow_s_' + 'a'.repeat(24) },
} as unknown as WorldRegistryEntry;
const OWN = {
  id: 'local-own', name: 'Owned', state: 'api-linked',
  api: { world_id: 'w-own', api_key: 'ow_w_' + 'o'.repeat(32) },
} as unknown as WorldRegistryEntry;

const pinRefused = () => new OwV2Error(401, { code: 'invalid_credentials', message: 'Incorrect PIN.', param: 'API-Pin' }, '');
const keyOrPin = () => Object.assign(new Error('API Error 401'), { status: 401, code: 'authentication_error', param: null });
const wall = () => new OwV2Error(429, { code: 'rate_limited', message: 'm', param: 'API-Pin' }, '', '600');

beforeEach(() => {
  patchSlice('registry', { ...defaultRegistry(), worlds: [SEAT, OWN] });
  patchSlice('active', null as never);
});

describe('a problem\'s sentence (problems.ts)', () => {
  it('a refused secret on a seat world says the seat secret, never the World PIN', () => {
    const s = problemFor(pinRefused(), { doing: 'saving', worldId: SEAT.id }).sentence;
    expect(s).toBe('OnlyWorlds did not accept this seat secret, so Atlas could not finish saving.');
    expect(problemFor(pinRefused(), { doing: 'saving', worldId: OWN.id }).sentence).toMatch(/^OnlyWorlds did not accept this World PIN\. /);
    expect(problemFor(pinRefused(), { doing: 'saving' }).sentence).toBe('OnlyWorlds did not accept the World PIN or seat secret. Atlas could not finish saving. Check it in Settings, under OnlyWorlds.');
  });

  it('a refusal of the key or the credential on a seat world names the seat secret', () => {
    const s = problemFor(keyOrPin(), { doing: 'saving', worldId: SEAT.id }).sentence;
    expect(s).toBe("OnlyWorlds did not accept this world's key or its seat secret, so Atlas could not finish saving.");
    expect(problemFor(keyOrPin(), { doing: 'saving', worldId: OWN.id }).sentence)
      .toBe("OnlyWorlds did not accept this world's key or the World PIN, so Atlas could not finish saving. Check the World PIN in Settings, under OnlyWorlds.");
    expect(problemFor(keyOrPin(), { doing: 'saving' }).sentence)
      .toBe("OnlyWorlds did not accept this world's key, or its World PIN or seat secret, so Atlas could not finish saving. Check them in Settings, under OnlyWorlds.");
  });

  it('the PIN wall on a seat world counts its seat secrets and says the wait alone', () => {
    const s = problemFor(wall(), { doing: 'saving', worldId: SEAT.id }).sentence;
    expect(s).toBe("OnlyWorlds refused too many different seat secrets for this world's key, so it takes none for a while, and Atlas could not finish saving. Try again in 10 minutes.");
    expect(problemFor(wall(), { doing: 'saving', worldId: OWN.id }).sentence)
      .toBe("OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while, and Atlas could not finish saving. Check the World PIN in Settings; try again in 10 minutes.");
    expect(problemFor(wall(), { doing: 'saving' }).sentence)
      .toBe("OnlyWorlds refused too many different World PINs or seat secrets for this world's key, so it takes none for a while, and Atlas could not finish saving. Check the World PIN or seat secret in Settings; try again in 10 minutes.");
  });

  // The open world is not always the step's: a join, a link or a new world runs beside it.
  it('a seat\'s step while an account world is open names the seat secret', () => {
    patchSlice('active', { worldId: OWN.id } as never);
    expect(problemFor(pinRefused(), { doing: 'downloading the world', who: 'seat' }).sentence)
      .toBe('OnlyWorlds did not accept this seat secret, so Atlas could not finish downloading the world.');
    expect(problemFor(wall(), { doing: 'linking this world', who: 'seat' }).sentence).not.toMatch(/World PIN/);
  });

  it('an account\'s step while a seat world is open names the World PIN', () => {
    patchSlice('active', { worldId: SEAT.id } as never);
    expect(problemFor(pinRefused(), { doing: 'creating the world online', who: 'account' }).sentence)
      .toMatch(/^OnlyWorlds did not accept this World PIN\. /);
  });

  it('with neither said, the line names both, whatever world is open', () => {
    patchSlice('active', { worldId: SEAT.id } as never);
    expect(problemFor(pinRefused(), { doing: 'saving' }).sentence).toBe('OnlyWorlds did not accept the World PIN or seat secret. Atlas could not finish saving. Check it in Settings, under OnlyWorlds.');
    patchSlice('active', { worldId: OWN.id } as never);
    expect(problemFor(pinRefused(), { doing: 'saving' }).sentence).toMatch(/^OnlyWorlds did not accept the World PIN or seat secret\. /);
  });
});

describe('a problem\'s fix (problem-fixes.ts)', () => {
  it('a seat\'s problem offers no Open settings: its secret is not kept there', () => {
    expect(resolveFixes(['open-settings'], { worldId: SEAT.id })).toEqual([]);
    expect(resolveFixes(['open-settings'], { worldId: OWN.id, who: 'seat' })).toEqual([]);
    expect(resolveFixes(['open-settings'], { worldId: OWN.id }).map(f => f.label)).toEqual(['Open settings']);
  });
});

describe('the sync\'s PIN wall (rate-wait.ts)', () => {
  it('a seat\'s wall counts its seat secrets and says the wait, never the World PIN', () => {
    expect(rateWaitLine(true, 60_000, 'in this browser', 'seat')).toBe("OnlyWorlds refused too many different seat secrets for this world's key, so it takes none for a while. Your changes are saved in this browser, and Atlas tries again in 60 seconds.");
    expect(rateWaitLine(true, 60_000, 'in this browser', 'account')).toBe("OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while. Check the World PIN in Settings; Atlas tries again in 60 seconds.");
    expect(rateWaitLine(true, 60_000, 'in this browser')).toBe("OnlyWorlds refused too many different World PINs or seat secrets for this world's key, so it takes none for a while. Check the World PIN or seat secret in Settings; Atlas tries again in 60 seconds.");
  });
});

describe('a file\'s add and remove (element-files.ts)', () => {
  it('a seat\'s refused secret and wall never say World PIN', () => {
    expect(pinRefusedLine('seat')).toBe('OnlyWorlds did not accept this seat secret.');
    const pin = new OwApiError(401, 'invalid_credentials', 'Incorrect PIN.', null, {}, null, 'API-Pin', null);
    const wallErr = new OwApiError(429, 'rate_limited', 'm', null, {}, null, 'API-Pin', 600);
    expect(addRefusal(pin, { size: 1 }, 'seat')).toBe('OnlyWorlds did not accept this seat secret.');
    expect(addRefusal(wallErr, { size: 1 }, 'seat')).toBe("OnlyWorlds refused too many different seat secrets for this world's key, so it takes none for a while. Nothing was added. Try again in 10 minutes.");
    expect(addRefusal(wallErr, { size: 1 }, 'account')).toBe("OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while. Nothing was added. Check the World PIN in Settings; try again in 10 minutes.");
    expect(addRefusal(wallErr, { size: 1 }, 'unknown')).toBe("OnlyWorlds refused too many different World PINs or seat secrets for this world's key, so it takes none for a while. Nothing was added. Check the World PIN or seat secret in Settings; try again in 10 minutes.");
    expect(addRefusal(pin, { size: 1 }, 'unknown')).toBe('OnlyWorlds did not accept the World PIN or seat secret. Check it in Settings, under OnlyWorlds.');
  });
});

describe('a page\'s publish (sharing-client.ts, share-room.ts)', () => {
  it('a seat\'s refusal and wall name its secret or the wait, never the World PIN', () => {
    expect(sharingErrorMessage(new SharingApiError('auth_failed', 401), 'seat')).toBe('OnlyWorlds did not accept the key or its seat secret.');
    const wallErr = new SharingApiError('rate_limited', 429, undefined, 'API-Pin');
    expect(sharingErrorMessage(wallErr, 'seat')).toBe("OnlyWorlds refused too many different seat secrets for this world's key, so it takes none for a while. Nothing changed. Try again later.");
    expect(sharingErrorMessage(new SharingApiError('auth_failed', 401), 'account')).toBe('OnlyWorlds did not accept the key or the World PIN. Check the World PIN in Settings, under OnlyWorlds.');
  });

  it('not known whose, a page\'s refusal and wall name both', () => {
    expect(sharingErrorMessage(new SharingApiError('auth_failed', 401))).toBe('OnlyWorlds did not accept the key, or its World PIN or seat secret. Check them in Settings, under OnlyWorlds.');
    const wallErr = new SharingApiError('rate_limited', 429, undefined, 'API-Pin');
    expect(sharingErrorMessage(wallErr)).toBe("OnlyWorlds refused too many different World PINs or seat secrets for this world's key, so it takes none for a while. Nothing changed. Check the World PIN or seat secret in Settings, then try again later.");
  });

  it('a world with no sharing client lacks its seat secret, or the World PIN, or (no world) either', () => {
    expect(missingCredentialWords(SEAT.id)).toBe('seat secret');
    expect(missingCredentialWords(OWN.id)).toBe('World PIN');
    expect(missingCredentialWords(null)).toBe('World PIN or seat secret');
  });
});

describe('a link\'s key check (key-check-errors.ts, atlas-root-flow.ts)', () => {
  it('a seat secret typed in the field is refused as a seat secret', () => {
    expect((keyCheckError(pinRefused(), { seat: true }) as Error).message).toBe('OnlyWorlds did not accept this seat secret. Check it, then try again.');
  });
  it('an empty field asks for either of its two names', () => {
    expect(linkPinRefusal('ow_w_' + 'x'.repeat(32), '', false)?.message).toBe('Enter your World PIN or seat secret first.');
  });
});

describe('the pill of a seat\'s stopped engine (sync-engine.ts)', () => {
  it('says the seat secret, short, with no stop', () => {
    expect(seatRefusalPill('pin')).toBe('OnlyWorlds did not accept this seat secret');
  });
});
