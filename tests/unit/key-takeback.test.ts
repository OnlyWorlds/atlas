/**
 * #814: Atlas takes back the keys it minted. These cover the pure guard
 * (`mintedKeyId` honours a record only while the key's tail still matches) and
 * `takeBackMintedKey`'s gating (browser worlds only, a recorded id, a token),
 * with the revoke injected so no network is touched. The exits that call it
 * (Unlink, Delete in this browser, Remove a cleared row, Fully forget, a key
 * replaced) are covered where they live.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { defaultRegistry } from '../../src/core/types';
import { patchSlice } from '../../src/core/state';
import { mintRecordOf, mintedKeyId, takeBackMintedKey } from '../../src/sync/key-takeback';
import { createApiLinkedWorld, mergeRegistry } from '../../src/registry/registry';
import type { WorldRegistryEntry } from '../../src/core/types';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ID = '11111111-2222-4333-8444-555555555555';
const KEY = 'ow_w_abcdef_7a9c3e21'; // tail '7a9c3e21'
const TAIL = '7a9c3e21';

function entry(over: Partial<NonNullable<WorldRegistryEntry['api']>> = {}, where: 'browser' | undefined = 'browser'): Pick<WorldRegistryEntry, 'api' | 'where'> {
  return { where, api: { world_id: 'srv-1', api_key: KEY, key_mint: { id: ID, tail: TAIL }, ...over } };
}

beforeEach(() => {
  patchSlice('registry', { ...defaultRegistry(), account_token: 'ow_a_token' });
});

describe('mintRecordOf', () => {
  it('records the id and the key tail for a UUID id', () => {
    expect(mintRecordOf(KEY, ID)).toEqual({ id: ID, tail: TAIL });
  });
  it('is undefined when the id is not a UUID', () => {
    expect(mintRecordOf(KEY, 'not-a-uuid')).toBeUndefined();
    expect(mintRecordOf(KEY, undefined)).toBeUndefined();
  });
});

describe('mintedKeyId', () => {
  it('answers the id when the key tail matches the record', () => {
    expect(mintedKeyId(entry())).toBe(ID);
  });
  it('is null when the key was swapped (tail no longer matches)', () => {
    expect(mintedKeyId(entry({ api_key: 'ow_w_abcdef_99999999' }))).toBeNull();
  });
  it('is null with no record (a pasted key)', () => {
    expect(mintedKeyId(entry({ key_mint: undefined }))).toBeNull();
  });
  it('is null for a non-UUID recorded id', () => {
    expect(mintedKeyId(entry({ key_mint: { id: 'nope', tail: TAIL } }))).toBeNull();
  });
  it('is null with no api block', () => {
    expect(mintedKeyId({})).toBeNull();
  });
});

describe('takeBackMintedKey', () => {
  it('revokes the recorded id on the recorded world for a browser world', async () => {
    const calls: Array<{ token: string; worldId: string; keyId: string }> = [];
    const ok = await takeBackMintedKey(entry(), (token, worldId, keyId) => { calls.push({ token, worldId, keyId }); return Promise.resolve(); });
    expect(ok).toBe(true);
    expect(calls).toEqual([{ token: 'ow_a_token', worldId: 'srv-1', keyId: ID }]);
  });

  it('sends nothing for a folder world (its key may be in a copy)', async () => {
    const calls: unknown[] = [];
    // A folder world has `where: undefined` (built directly: passing undefined to
    // the helper would hit its 'browser' default).
    const folder = { where: undefined, api: { world_id: 'srv-1', api_key: KEY, key_mint: { id: ID, tail: TAIL } } };
    const ok = await takeBackMintedKey(folder, (...a) => { calls.push(a); return Promise.resolve(); });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('sends nothing when the key is not the one Atlas minted', async () => {
    const calls: unknown[] = [];
    const ok = await takeBackMintedKey(entry({ api_key: 'ow_w_abcdef_99999999' }), (...a) => { calls.push(a); return Promise.resolve(); });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('sends nothing with no account token', async () => {
    patchSlice('registry', { ...defaultRegistry() });
    const calls: unknown[] = [];
    const ok = await takeBackMintedKey(entry(), (...a) => { calls.push(a); return Promise.resolve(); });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('returns false, not throwing, when the revoke is refused', async () => {
    const ok = await takeBackMintedKey(entry(), () => Promise.reject(new Error('boom')));
    expect(ok).toBe(false);
  });
});

describe('createApiLinkedWorld records the mint', () => {
  it('writes key_mint when the key Atlas minted is passed', () => {
    const { entry: e } = createApiLinkedWorld(defaultRegistry(), {
      name: 'W', apiWorldId: 'srv-1', apiKey: KEY, folderName: 'w', handleKey: 'h',
      keyMint: { id: ID, tail: TAIL },
    });
    expect(e.api?.key_mint).toEqual({ id: ID, tail: TAIL });
    expect(mintedKeyId({ api: e.api })).toBe(ID);
  });
  it('writes no record for a key opened from a folder (no mint passed)', () => {
    const { entry: e } = createApiLinkedWorld(defaultRegistry(), {
      name: 'W', apiWorldId: 'srv-1', apiKey: KEY, folderName: 'w', handleKey: 'h',
    });
    expect(e.api?.key_mint).toBeUndefined();
  });
  it('writes no record when the passed tail does not match the key (a stale mint)', () => {
    const { entry: e } = createApiLinkedWorld(defaultRegistry(), {
      name: 'W', apiWorldId: 'srv-1', apiKey: KEY, folderName: 'w', handleKey: 'h',
      keyMint: { id: ID, tail: 'deadbeef' },
    });
    expect(e.api?.key_mint).toBeUndefined();
  });
});

describe('the record travels with its key across tabs (N6)', () => {
  it('a sibling tab swapping the key carries key_mint whole with api_key', () => {
    const KEY2 = 'ow_w_zzzzzz_babababa';
    const base = createApiLinkedWorld(defaultRegistry(), {
      name: 'W', apiWorldId: 'srv-1', apiKey: KEY, folderName: 'w', handleKey: 'h', keyMint: { id: ID, tail: TAIL },
    }).next;
    // This tab is unchanged from base; the other tab (stored) swapped the key and its record.
    const mine = base;
    const swapped = { ...base.worlds[0], api: { ...base.worlds[0].api!, api_key: KEY2, key_mint: { id: ID, tail: 'babababa' } } };
    const stored = { ...base, worlds: [swapped] };
    const merged = mergeRegistry(base, mine, stored);
    const api = merged.worlds[0].api!;
    // The pair is consistent: the tail recorded still matches the key held.
    expect(api.api_key).toBe(KEY2);
    expect(api.key_mint).toEqual({ id: ID, tail: 'babababa' });
    expect(mintedKeyId({ api })).toBe(ID);
  });
});

describe('the take-back is wired at exactly the exits the contract names (T6)', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
  const read = (rel: string) => readFileSync(join(srcDir, rel), 'utf8');
  it('calls takeBackMintedKey from the five removal exits and nowhere else', () => {
    const sites = [
      'middle/settings-world.ts',       // L1 Unlink
      'setup/browser-world-delete.ts',  // L3 Delete in this browser
      'sidebar/worlds-sidebar.ts',      // L4 Remove a cleared row
      'setup/forget-browser.ts',        // L6 Fully forget
      'sync/world-key.ts',              // L5 a key replaced
    ];
    for (const s of sites) {
      expect(read(s), s).toMatch(/takeBackMintedKey\(/);
    }
    // The key-permanent delete (K: a folder world) must not take a key back.
    expect(read('setup/atlas-root-flow.ts')).not.toMatch(/takeBackMintedKey\(/);
  });
});
