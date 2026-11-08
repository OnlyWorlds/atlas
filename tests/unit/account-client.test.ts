/**
 * AccountClient — thin fetch client for the keel v2 ACCOUNT endpoints.
 *
 * Driven against the stateful account MSW (statefulAccountHandlers) through the
 * shared mswServer. Covers the four calls plus the two auth codes and the
 * PIN-dance 422 — the wire contract the account-mode flow logic sits on top of.
 */

import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulAccountHandlers, type StatefulAccountOptions } from '../msw-account-handlers';
import {
  AccountClient,
  accountErrorMessage,
  isAccountAuthError,
} from '../../src/sync/account-client';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import type { AccountWorldRow } from '../../src/core/types';

const TOKEN = 'ow_a_valid_token';
const PROFILE = {
  id: 'acct-1',
  username: 'titus',
  email: 'titus@example.com',
  date_joined: '2026-01-01T00:00:00Z',
};
const WORLDS: AccountWorldRow[] = [
  { id: 'srv-owned', name: 'Owned World', role: 'owner', public_read: false, keys: [] },
  { id: 'srv-collab', name: 'Collab World', role: 'collaborator', public_read: true, keys: [{ last4: 'ab12', scope: 'READ', revoked: false }] },
];

/** Register handlers for this test and return their capture state. */
function mount(opts: Partial<StatefulAccountOptions> = {}) {
  const { handlers, state } = statefulAccountHandlers({
    token: TOKEN,
    profile: PROFILE,
    worlds: WORLDS,
    ...opts,
  });
  mswServer.use(...handlers);
  return state;
}

describe('AccountClient.getProfile', () => {
  it('returns the profile on a valid token', async () => {
    mount();
    const profile = await new AccountClient(TOKEN).getProfile();
    expect(profile.username).toBe('titus');
    expect(profile.email).toBe('titus@example.com');
  });

  it('surfaces 401 invalid_credentials as an auth error', async () => {
    mount();
    const client = new AccountClient('ow_a_wrong');
    let caught: unknown;
    await client.getProfile().catch(err => { caught = err; });
    expect(caught).toBeInstanceOf(OwV2Error);
    expect((caught as OwV2Error).status).toBe(401);
    expect((caught as OwV2Error).code).toBe('invalid_credentials');
    expect(isAccountAuthError(caught)).toBe(true);
  });

  it('surfaces 401 key_revoked as an auth error with distinct messaging', async () => {
    mount({ revoked: true });
    let revokedErr: unknown;
    await new AccountClient(TOKEN).getProfile().catch(err => { revokedErr = err; });
    expect(revokedErr).toBeInstanceOf(OwV2Error);
    expect((revokedErr as OwV2Error).code).toBe('key_revoked');
    expect(isAccountAuthError(revokedErr)).toBe(true);

    // The revoked message must differ from the plain invalid-token message so
    // the UI can steer the user to "mint a new one" vs "check the token".
    mswServer.resetHandlers();
    mount();
    let invalidErr: unknown;
    await new AccountClient('ow_a_wrong').getProfile().catch(err => { invalidErr = err; });
    expect(accountErrorMessage(revokedErr)).not.toBe(accountErrorMessage(invalidErr));
    expect(accountErrorMessage(revokedErr)).toMatch(/revoked/i);
  });
});

describe('AccountClient.listWorlds', () => {
  it('unwraps the {data:[...]} envelope into a bare row array', async () => {
    mount();
    const rows = await new AccountClient(TOKEN).listWorlds();
    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.id)).toEqual(['srv-owned', 'srv-collab']);
    expect(rows[0].role).toBe('owner');
  });
});

describe('AccountClient.mintWorldKey', () => {
  it('returns the full WRITE key for an owned world', async () => {
    const state = mount();
    const minted = await new AccountClient(TOKEN).mintWorldKey('srv-owned');
    expect(minted.key).toMatch(/^ow_w_/);
    expect(minted.scope).toBe('WRITE');
    expect(state.minted).toHaveLength(1);
    expect(state.minted[0].worldId).toBe('srv-owned');
  });

  it('asks keel to keep every key it mints, so a sign-out leaves the worlds here working', async () => {
    const state = mount();
    await new AccountClient(TOKEN).mintWorldKey('srv-owned');
    await new AccountClient(TOKEN).mintWorldKey('srv-owned', 'atlas · windows', 'read');
    expect(state.minted.map(m => m.keep)).toEqual([true, true]);
  });

  it('404s (not an auth error) when the account is not in the world', async () => {
    mount();
    let caught: unknown;
    await new AccountClient(TOKEN).mintWorldKey('srv-elsewhere').catch(err => { caught = err; });
    expect(caught).toBeInstanceOf(OwV2Error);
    expect((caught as OwV2Error).status).toBe(404);
    expect((caught as OwV2Error).code).toBe('not_found');
    expect(isAccountAuthError(caught)).toBe(false);
  });

  it('a member mints their own key; a write key without an account PIN is 409 pin_required (keel D72 R9)', async () => {
    const state = mount();
    let caught: unknown;
    await new AccountClient(TOKEN).mintWorldKey('srv-collab').catch(err => { caught = err; });
    expect((caught as OwV2Error).status).toBe(409);
    expect((caught as OwV2Error).code).toBe('pin_required');
    expect(isAccountAuthError(caught)).toBe(false);
    const read = await new AccountClient(TOKEN).mintWorldKey('srv-collab', 'atlas · test', 'read');
    expect(read.key).toMatch(/^ow_r_/);
    expect(read.scope).toBe('READ');
    expect(state.minted).toEqual([expect.objectContaining({ worldId: 'srv-collab', name: 'atlas · test', scope: 'READ' })]);
  });

  it('sends the key name and gets it echoed; omitting it keeps the bare mint (live 2026-07-13)', async () => {
    const state = mount();
    const named = await new AccountClient(TOKEN).mintWorldKey('srv-owned', 'atlas · windows');
    expect(named.name).toBe('atlas · windows');
    expect(state.minted[0].name).toBe('atlas · windows');
    const bare = await new AccountClient(TOKEN).mintWorldKey('srv-owned');
    expect(bare.name).toBe('');
    expect(state.minted[1].name).toBe('');
  });

  it('a name past 255 chars is a loud 422 param=name', async () => {
    mount();
    let caught: unknown;
    await new AccountClient(TOKEN).mintWorldKey('srv-owned', 'x'.repeat(256)).catch(err => { caught = err; });
    expect(caught).toBeInstanceOf(OwV2Error);
    expect((caught as OwV2Error).status).toBe(422);
    expect((caught as OwV2Error).param).toBe('name');
  });
});

/**
 * A mint whose answer is lost, against keel's rules for world keys (since 2026-11-08):
 * a mint is never replayed, its row keeps a hash of the
 * Idempotency-Key, GET .../keys/made?key= names the first row made under it
 * (a revoked one too, `revoked` true) or one 404, and a keel before it answers
 * that GET 405 (its path was the revoke's).
 */
describe('AccountClient.mintWorldKey, a lost answer', () => {
  const BASE = 'https://www.onlyworlds.com/api/v2';
  const W = 'srv-owned';

  function fakeKeel(opts: { lose?: 'network' | '502' | 'no-key'; refuse?: boolean; madeRoute?: boolean } = {}) {
    const rows: Array<{ id: string; madeBy: string | null; live: boolean }> = [];
    const calls: string[] = [];
    let n = 0;
    mswServer.use(
      http.post(`${BASE}/account/worlds/${W}/keys`, ({ request }) => {
        calls.push('POST keys');
        if (opts.refuse) return HttpResponse.json({ error: { code: 'pin_required', message: 'x' } }, { status: 409 });
        const row = { id: `k${++n}`, madeBy: request.headers.get('Idempotency-Key'), live: true };
        rows.push(row);
        if (opts.lose === 'network') return HttpResponse.error();
        if (opts.lose === '502') return HttpResponse.json({ error: { code: 'bad_gateway' } }, { status: 502 });
        if (opts.lose === 'no-key') return HttpResponse.json({ id: row.id }, { status: 201 });
        return HttpResponse.json({ id: row.id, last4: 'abcd', name: '', revoked: false, key: `ow_w_secret_${row.id}` }, { status: 201 });
      }),
      http.get(`${BASE}/account/worlds/${W}/keys/made`, ({ request }) => {
        calls.push('GET made');
        if (opts.madeRoute === false) return HttpResponse.json({ detail: 'Method not allowed' }, { status: 405 });
        const key = new URL(request.url).searchParams.get('key');
        const row = rows.find(r => key && r.madeBy === key);
        if (!row) return HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 });
        return HttpResponse.json({ id: row.id, last4: 'abcd', name: '', scope: 'write', revoked: !row.live, kept: true });
      }),
      http.delete(`${BASE}/account/worlds/${W}/keys/:id`, ({ params }) => {
        calls.push(`DELETE ${String(params.id)}`);
        const row = rows.find(r => r.id === params.id);
        if (!row) return HttpResponse.json({ error: { code: 'not_found', message: 'x' } }, { status: 404 });
        row.live = false;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return { rows, calls, live: () => rows.filter(r => r.live).map(r => r.id) };
  }

  it('goes under an Idempotency-Key and asks nothing more when the answer is in', async () => {
    const k = fakeKeel();
    const minted = await new AccountClient(TOKEN).mintWorldKey(W, 'atlas · test');
    expect(minted.key).toBe('ow_w_secret_k1');
    expect(k.rows[0].madeBy).toMatch(/^[0-9a-f-]{36}$/);
    expect(k.calls).toEqual(['POST keys']);
  });

  for (const lose of ['network', '502', 'no-key'] as const) {
    it(`whose answer is lost (${lose}) takes back the key that call made, by the id keel names`, async () => {
      const k = fakeKeel({ lose });
      await expect(new AccountClient(TOKEN).mintWorldKey(W)).rejects.toBeTruthy();
      expect(k.calls).toEqual(['POST keys', 'GET made', 'DELETE k1']);
      expect(k.live()).toEqual([]);
    });
  }

  it('refused (4xx) made nothing: no lookup', async () => {
    const k = fakeKeel({ refuse: true });
    await expect(new AccountClient(TOKEN).mintWorldKey(W)).rejects.toBeInstanceOf(OwV2Error);
    expect(k.calls).toEqual(['POST keys']);
  });

  it('on a keel before the lookup (405) is no worse than before: nothing taken back, the error goes on', async () => {
    const k = fakeKeel({ lose: '502', madeRoute: false });
    await expect(new AccountClient(TOKEN).mintWorldKey(W)).rejects.toMatchObject({ status: 502 });
    expect(k.calls).toEqual(['POST keys', 'GET made']);
    expect(k.live()).toEqual(['k1']);
  });
});

// The world create moved to the SDK's createAccountWorld (1.83.1): its dance
// is held by createApiWorld's tests in tests/integration/account-worlds.test.ts.
