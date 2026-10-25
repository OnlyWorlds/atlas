/**
 * A token Atlas minted is revoked when Atlas lets it go (S475, contract
 * `Forge/Notes/2026-10-25-s475-atlas-token-revoke-contract.md` and its gate):
 * the id goes with its own token only, the account fields merge as one group
 * across tabs, the revoke asks keel by the recorded id with the token as its
 * bearer and reads 404 as still live, and Forget everything revokes only
 * right before storage is cleared.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setAccountToken, mergeRegistry, isTokenId, mintedTokenId } from '../../src/registry/registry';
import { defaultRegistry, type WorldsRegistry } from '../../src/core/types';
import { revokeAtlasToken } from '../../src/sync/token-revoke';
import { patchSlice } from '../../src/core/state';
import { forgetEverything } from '../../src/setup/forget-browser';

const ID1 = '0f1e2d3c-4b5a-4968-8776-655443322110';
const ID2 = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const base = (): WorldsRegistry => defaultRegistry();

describe('setAccountToken keeps the id with its own token only', () => {
  it('keeps a UUID id beside the token it was minted with', () => {
    const r = setAccountToken(base(), 'ow_a_T1', 'ada', ID1);
    expect(r.account_token).toBe('ow_a_T1');
    expect(r.account_token_id).toBe(ID1);
  });
  it('a pasted token (no id) clears the id of the token before it', () => {
    const r = setAccountToken(setAccountToken(base(), 'ow_a_T1', 'ada', ID1), 'ow_a_P2', 'ada');
    expect(r.account_token).toBe('ow_a_P2');
    expect(r.account_token_id).toBeUndefined();
  });
  it('Forget clears both', () => {
    const r = setAccountToken(setAccountToken(base(), 'ow_a_T1', 'ada', ID1), undefined);
    expect(r.account_token).toBeUndefined();
    expect(r.account_token_id).toBeUndefined();
  });
  it('an id that is not a UUID is never kept (the gate\'s G9)', () => {
    expect(setAccountToken(base(), 'ow_a_T1', 'ada', '../worlds/W/keys/K').account_token_id).toBeUndefined();
    expect(setAccountToken(base(), 'ow_a_T1', 'ada', '').account_token_id).toBeUndefined();
    expect(isTokenId(ID1)).toBe(true);
  });
});

describe('an id counts only beside the token it was recorded with (the code gate\'s F2)', () => {
  it('a minted token reads its id', () => {
    expect(mintedTokenId(setAccountToken(base(), 'ow_a_TOKEN0001', 'ada', ID1))).toBe(ID1);
  });
  it('a 1.92 tab that wrote a new token and kept the old id: the id does not count', () => {
    const kept = setAccountToken(base(), 'ow_a_TOKEN0001', 'ada', ID1);
    // 1.92's setAccountToken spread the registry and touched only the token and name.
    const stale = { ...kept, account_token: 'ow_a_PASTED9999' };
    expect(mintedTokenId(stale)).toBeNull();
  });
  it('an id with no tail (hand-edited, or older) does not count', () => {
    expect(mintedTokenId({ ...base(), account_token: 'ow_a_TOKEN0001', account_token_id: ID1 })).toBeNull();
  });
});

describe('the account fields merge as one group across tabs (the gate\'s G3)', () => {
  it('a paste here while another tab kept a minted token: the paste goes whole, never beside the other id', () => {
    const b = setAccountToken(base(), 'ow_a_P1', 'ada');
    const stored = setAccountToken(base(), 'ow_a_T2', 'ada', ID2);
    const mine = setAccountToken(b, 'ow_a_P3', 'bo');
    const out = mergeRegistry(b, mine, stored);
    expect(out.account_token).toBe('ow_a_P3');
    expect(out.account_token_id).toBeUndefined();
    expect(out.account_username).toBe('bo');
  });
  it('a tab that changed none of them takes all three from storage', () => {
    const b = setAccountToken(base(), 'ow_a_P1', 'ada');
    const stored = setAccountToken(base(), 'ow_a_T2', 'bo', ID2);
    const out = mergeRegistry(b, { ...b, sync_cadence_ms: 5000 }, stored);
    expect([out.account_token, out.account_token_id, out.account_username]).toEqual(['ow_a_T2', ID2, 'bo']);
  });
  it('a Forget here wins over storage whole', () => {
    const b = setAccountToken(base(), 'ow_a_T1', 'ada', ID1);
    const out = mergeRegistry(b, setAccountToken(b, undefined), b);
    expect(out.account_token).toBeUndefined();
    expect(out.account_token_id).toBeUndefined();
  });
});

describe('revokeAtlasToken', () => {
  const answer = (status: number) => vi.fn(async () => new Response(null, { status }));

  it('asks keel by the recorded id, with the token as its bearer, and keepalive', async () => {
    const f = answer(204);
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: f, base: 'https://keel.test/api/v2' })).toBe('revoked');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://keel.test/api/v2/account/tokens/${ID1}`);
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer ow_a_T1');
    expect(init.keepalive).toBe(true);
  });
  it('401 is revoked (the token works no more); 404 is kept: the bearer works, the token is live (G1)', async () => {
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: answer(401), base: 'x' })).toBe('revoked');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: answer(404), base: 'x' })).toBe('kept');
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it('a refusal, no answer, or the time limit is kept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: answer(429), base: 'x' })).toBe('kept');
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: answer(500), base: 'x' })).toBe('kept');
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: vi.fn(async () => { throw new TypeError('offline'); }), base: 'x' })).toBe('kept');
    const hang = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: hang as unknown as typeof fetch, base: 'x', limitMs: 20 })).toBe('kept');
    warn.mockRestore();
  });
  it('a browser that refuses the keepalive request gets one more try without it (F5)', async () => {
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      if (init.keepalive) throw new TypeError('keepalive refused');
      return new Response(null, { status: 204 });
    });
    expect(await revokeAtlasToken('ow_a_T1', ID1, { fetch: f as unknown as typeof fetch, base: 'x' })).toBe('revoked');
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('sends nothing for an id that is not a UUID, and never writes the registry (G9, G11)', async () => {
    const f = answer(204);
    expect(await revokeAtlasToken('ow_a_T1', '../worlds/W/keys/K', { fetch: f, base: 'x' })).toBe('kept');
    expect(f).not.toHaveBeenCalled();
    const set = vi.spyOn(Storage.prototype, 'setItem');
    await revokeAtlasToken('ow_a_T1', ID1, { fetch: answer(204), base: 'x' });
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});

describe('Forget everything revokes right before storage is cleared (G2)', () => {
  const emptyRoot = async () => ({
    keys: async function* () { /* nothing */ },
    removeEntry: async () => {},
  }) as unknown as FileSystemDirectoryHandle;
  let order: string[];
  beforeEach(() => { order = []; });
  afterEach(() => { vi.restoreAllMocks(); });

  it('a token Atlas minted: revoked after the browser storage is gone, before localStorage.clear', async () => {
    patchSlice('registry', setAccountToken(base(), 'ow_a_T1', 'ada', ID1));
    vi.spyOn(Storage.prototype, 'clear').mockImplementation(function (this: Storage) { order.push(this === localStorage ? 'clear-local' : 'clear-session'); });
    const revoke = vi.fn(async (t: string, id: string) => { order.push(`revoke ${t} ${id}`); return 'revoked'; });
    await forgetEverything({ opfsRoot: emptyRoot, reload: () => order.push('reload'), revoke });
    expect(order).toEqual([`revoke ow_a_T1 ${ID1}`, 'clear-local', 'clear-session', 'reload']);
  });
  it('a pasted token is not revoked', async () => {
    patchSlice('registry', setAccountToken(base(), 'ow_a_P1', 'ada'));
    vi.spyOn(Storage.prototype, 'clear').mockImplementation(() => {});
    const revoke = vi.fn(async () => 'revoked');
    await forgetEverything({ opfsRoot: emptyRoot, reload: () => {}, revoke });
    expect(revoke).not.toHaveBeenCalled();
  });
  it('a forget that stops before clearing revokes nothing', async () => {
    patchSlice('registry', setAccountToken(base(), 'ow_a_T1', 'ada', ID1));
    const revoke = vi.fn(async () => 'revoked');
    const failing = async () => { throw new Error('opfs refused'); };
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(forgetEverything({ opfsRoot: failing as never, reload: () => {}, revoke })).rejects.toThrow();
    expect(revoke).not.toHaveBeenCalled();
  });
});
