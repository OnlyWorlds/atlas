/**
 * A step that sends no `API-Pin` never names a PIN. An invite's preview and redeem, a person's join, the
 * account's list of worlds, a seat's check, the demo's download, a world file, and a download or a new key
 * read by a key that only reads send none (a prefixed key's reads go bare, and nothing goes beside a read
 * key: conv. 164, 193). Their refusal says OnlyWorlds did not allow the step, and that nothing changed.
 * A download into a folder is left out: a failure there can leave the half-made folder behind, so
 * "Nothing changed" would not be true of it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { problemFor } from '../../src/core/problems';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { resolveFixes } from '../../src/ui/problem-fixes';
import { accountErrorMessage } from '../../src/sync/account-client';

const OWN = {
  id: 'local-own', name: 'Owned', state: 'api-linked',
  api: { world_id: 'w-own', api_key: 'ow_w_' + 'o'.repeat(32) },
} as unknown as WorldRegistryEntry;

const forbidden = () => new OwV2Error(403, { code: 'forbidden', message: 'm', param: null }, '');
const untyped401 = () => Object.assign(new Error('API Error 401'), { status: 401, code: 'authentication_error', param: null });

beforeEach(() => {
  patchSlice('registry', { ...defaultRegistry(), worlds: [OWN] });
  patchSlice('active', { worldId: OWN.id } as never);
});

describe('a refusal of a step that sends no PIN', () => {
  it('says OnlyWorlds did not allow the step, and names no PIN or seat secret', () => {
    expect(problemFor(forbidden(), { doing: 'reading the invitation', inline: true, noPin: true }).sentence)
      .toBe('OnlyWorlds did not allow reading the invitation. Nothing changed.');
    expect(problemFor(untyped401(), { doing: 'downloading the shared world', noPin: true }).sentence)
      .toBe('OnlyWorlds did not allow downloading the shared world. Nothing changed.');
  });

  it('a step that sends one keeps its words', () => {
    expect(problemFor(forbidden(), { doing: 'saving', worldId: OWN.id }).sentence).toMatch(/World PIN/);
  });

  it('offers no Open settings: no PIN there is the step\'s', () => {
    expect(resolveFixes(['open-settings'], { worldId: OWN.id, noPin: true })).toEqual([]);
    expect(resolveFixes(['open-settings'], { worldId: OWN.id }).map(f => f.label)).toEqual(['Open settings']);
  });

  it('the account\'s list of worlds, by its account token alone', () => {
    expect(accountErrorMessage(forbidden(), { noPin: true })).toBe('OnlyWorlds did not allow talking to your OnlyWorlds account. Nothing changed.');
  });
});

/** The calls that word `doing` in `file`, as written. */
function callsAt(file: string, doing: string): string[] {
  const src = readFileSync(join(__dirname, '..', '..', 'src', file), 'utf8');
  const calls = [...src.matchAll(/\b(?:showProblem|problemFor|accountErrorMessage)\((?:[^()]|\([^()]*\))*\)/g)].map(m => m[0])
    .filter(c => c.includes(doing));
  expect(calls.length, `${file} ${doing}`).toBeGreaterThan(0);
  return calls;
}

describe('the census: each site whose step sends no PIN says so', () => {
  // [file, the doing words at the site, what it passes]. A read key's or a browser's download passes it
  // on that condition only.
  const SITES: Array<[file: string, doing: string, says: RegExp]> = [
    ['ui/person-join-modal.ts', "'reading the invitation'", /noPin: true/],
    ['ui/person-join-modal.ts', "'joining the world'", /noPin: true/],
    ['ui/join-world-modal.ts', "'reading the link to the world'", /noPin: true/],
    ['ui/join-world-modal.ts', "'joining the world'", /noPin: true/],
    ['ui/join-world-modal.ts', "'checking the seat on OnlyWorlds'", /noPin: true/],
    ['ui/join-world-modal.ts', "'downloading the world'", /noPin: where === 'browser'/],
    ['ui/view-world-modal.ts', "'downloading the shared world'", /noPin: where === 'browser'/],
    ['ui/link-world-modal.ts', "'downloading the world'", /noPin: where === 'browser' && readsOnlyByShape\(apiKey\)/],
    ['ui/open-world-file.ts', 'DEMO_WORDS.doing', /noPin: true/],
    ['ui/open-world-file.ts', 'words.doing', /noPin: true/],
    ['ui/bring-down-again-modal.ts', "'downloading the world'", /noPin: !sendsPin\('GET', '\/world', w\.api\?\.api_key \?\? ''\)/],
    ['ui/world-key-modal.ts', "'checking the new key'", /noPin: readsOnlyByShape\(raw\)/],
    ['sync/account-worlds.ts', 'accountErrorMessage(err, { noPin: true })', /noPin: true/],
  ];
  for (const [file, doing, says] of SITES) {
    it(`${file}, ${doing}`, () => {
      for (const call of callsAt(file, doing)) expect(call).toMatch(says);
    });
  }
});
