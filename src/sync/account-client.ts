/**
 * AccountClient — thin fetch client for the keel v2 ACCOUNT endpoints.
 *
 * Account routes authenticate with `Authorization: Bearer ow_a_...` (the
 * account token from the portal Tokens UI) — a different wall from the
 * world-key `API-Key`/`API-Pin` headers the element CRUD adapter sends.
 * The two credential families share no headers by design: the account token
 * is a key-minting authority; sync itself always runs on world keys.
 *
 * Wire contract pinned from keel source 2026-07-13 (accounts/api.py,
 * accounts/auth.py; design doc: Notes/2026-07-13-account-mode-design.md):
 *
 *   GET  /account                      → {id, username, email, date_joined}
 *   GET  /account/worlds               → {data: [AccountWorldRow]}
 *   POST /account/worlds               → 201 row + full ow_w_ key (once).
 *        Body {name, pin?} — the PIN dance: account without a pin REQUIRES
 *        pin (becomes the account pin); account with a pin REJECTS it
 *        (422 param=pin either way — callers retry per the dance).
 *   POST /account/worlds/{id}/keys     → 201 {..., key} (full key once).
 *        Empty body = WRITE scope default; {scope: 'read'} mints a READ key.
 *        The owner mints owner keys; a member mints keys bound to their
 *        membership (D72 R9, keel accounts/api.py `mint_world_key`), and a
 *        member's WRITE key needs an account PIN (409 pin_required). Anyone
 *        else → 404.
 *        Optional {name} (≤255 chars, else 422 param=name) — echoed in the
 *        mint response, GET .../keys rows, and the portal keys table. LIVE
 *        on prod 2026-07-13 (Skeld OPS-3). Unknown body fields are silently
 *        IGNORED (spec §2 — corrected: this route never 422'd unknowns).
 *
 * Errors ride the same §9 envelope as v2 element routes and surface as
 * OwV2Error (invalid token → 401 invalid_credentials; revoked token → 401
 * key_revoked — distinct codes, distinct user messages).
 */

import { OwApiError } from '@onlyworlds/sdk';
import { OwV2Error, DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import type { AccountWorldRow } from '../core/types';
import { problemFor } from '../core/problems';

export type { AccountWorldRow };

export interface AccountProfile {
  id: string;
  username: string;
  email: string;
  date_joined: string | null;
}

export interface MintedWorldKey {
  id: string;
  last4: string;
  scope: 'READ' | 'WRITE';
  /** The key's display name ("atlas · windows") as echoed by the server; "" when unnamed. */
  name?: string;
  /** The full ow_w_/ow_r_ key — shown exactly once, never retrievable again. */
  key: string;
}

/** True when the error means "this account token is bad" (vs transient/other). */
export function isAccountAuthError(err: unknown): boolean {
  return err instanceof OwV2Error
    && err.status === 401
    && (err.code === 'invalid_credentials' || err.code === 'key_revoked');
}

/** User-facing message for a failed account call, code-aware. */
export function accountErrorMessage(err: unknown): string {
  // Atlas's own account calls throw OwV2Error; an SDK call (the world create
  // since 1.83.1) throws the SDK's OwApiError, read the same way.
  if (err instanceof OwV2Error || err instanceof OwApiError) {
    if (err.code === 'key_revoked') return 'This account token was revoked. Create a new one on onlyworlds.com.';
    if (err.status === 401) return 'Account token not recognized. Check it on onlyworlds.com, in Account settings under Account tokens.';
    if (err.code === 'rate_limited') return 'Too many attempts. Wait a moment and try again.';
  }
  // Anything else is worded, never read out: the fallback used to be
  // the server's or the browser's own text.
  return problemFor(err, { inline: true, doing: 'talking to your OnlyWorlds account' }).sentence;
}

export class AccountClient {
  private readonly base: string;
  private readonly token: string;

  constructor(token: string, baseUrl?: string) {
    this.base = (baseUrl ?? devV2Base() ?? DEFAULT_V2_BASE).replace(/\/$/, '');
    this.token = token.trim();
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    extra?: { headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...extra?.headers,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: extra?.signal,
    });
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!response.ok) {
      let envelope: { type?: string; code?: string; message?: string; param?: string | null } | null = null;
      try {
        const parsed = JSON.parse(text) as { error?: typeof envelope };
        envelope = parsed?.error ?? null;
      } catch { /* non-JSON error body */ }
      throw new OwV2Error(response.status, envelope, text.slice(0, 300));
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`account response was not JSON (${method} ${path}): ${text.slice(0, 120)}`);
    }
  }

  /** The cheap "who am I" validation call. */
  async getProfile(): Promise<AccountProfile> {
    const raw = await this.request('GET', '/account') as AccountProfile;
    if (!raw || typeof raw.username !== 'string') {
      throw new Error('account profile response missing username');
    }
    return raw;
  }

  /** Every world on the account — owned first, then collaborations. */
  async listWorlds(): Promise<AccountWorldRow[]> {
    const raw = await this.request('GET', '/account/worlds') as { data?: AccountWorldRow[] };
    if (!raw || !Array.isArray(raw.data)) {
      throw new Error('account worlds response missing data array');
    }
    return raw.data;
  }

  /**
   * Mint this account's own key for a world it owns or is a member of (WRITE
   * unless `scope` is 'read'). The response's `key` is shown once — the caller
   * must persist it (world.json api block) before dropping it.
   * `name` labels the key in the portal ("atlas · windows") so the keys table
   * reads honestly — Titus's named-keys condition, live 2026-07-13. Omitted
   * name keeps the old bare mint (server stores "").
   * Every key Atlas mints is kept on this device (`keep: true`): keel's sweep
   * of a revoked token's keys passes it by, so Sign out lets go of the account
   * and the worlds here keep syncing with their own keys.
   *
   * A mint whose answer is lost on the way back (no answer, a 5xx, a body
   * without the key) may have made a key nobody here holds: the mint goes
   * under an Idempotency-Key, and keel's `GET .../keys/made?key=` names the
   * row that call made (keel since 2026-11-08: a hash on the row, never the secret), so
   * that key is taken back by its id before the error goes on. A 4xx made
   * nothing. Only this call's own key is ever asked for; a reload while the
   * mint is in flight is not covered (no ask outlives the page).
   */
  async mintWorldKey(worldId: string, name?: string, scope: 'write' | 'read' = 'write'): Promise<MintedWorldKey> {
    const body: Record<string, string | boolean> = { keep: true };
    if (name) body.name = name;
    if (scope === 'read') body.scope = 'read';
    const idempotencyKey = crypto.randomUUID();
    let raw: MintedWorldKey;
    try {
      raw = await this.request('POST', `/account/worlds/${worldId}/keys`, body, { headers: { 'Idempotency-Key': idempotencyKey } }) as MintedWorldKey;
    } catch (err) {
      if (!(err instanceof OwV2Error && err.status >= 400 && err.status < 500)) {
        await this.takeBackLostMint(worldId, idempotencyKey);
      }
      throw err;
    }
    if (!raw || typeof raw.key !== 'string' || !raw.key) {
      await this.takeBackLostMint(worldId, idempotencyKey);
      throw new Error('key mint response missing the full key');
    }
    return raw;
  }

  /**
   * The key a lost mint made, asked by its Idempotency-Key and taken back by
   * the id keel names. Quiet and bounded (8 s each): a keel that cannot say
   * (offline, 404 none made, 405 from a keel before that lookup) leaves it as it was.
   */
  private async takeBackLostMint(worldId: string, idempotencyKey: string): Promise<void> {
    try {
      const row = await this.request('GET', `/account/worlds/${worldId}/keys/made?key=${encodeURIComponent(idempotencyKey)}`, undefined,
        { signal: AbortSignal.timeout(8000) }) as { id?: string; revoked?: boolean } | undefined;
      if (!row?.id || row.revoked === true) return;
      await this.request('DELETE', `/account/worlds/${worldId}/keys/${encodeURIComponent(row.id)}`, undefined,
        { signal: AbortSignal.timeout(8000) });
    } catch {
      // The key stays listed on the account's keys page, where it can be removed.
    }
  }

  /**
   * Take back a key this account minted (`DELETE /account/worlds/{id}/keys/{key_id}`,
   * 204): an owner any of the world's keys, a member only their own.
   */
  async revokeWorldKey(worldId: string, keyId: string): Promise<void> {
    await this.request('DELETE', `/account/worlds/${worldId}/keys/${keyId}`);
  }

  /**
   * Accept a person's join link (`POST /account/join`, body
   * `{code}`): the account becomes a member with the link's role. 404 for any
   * code that will not open (or one made for an agent), 409 already_member.
   */
  async joinWithLink(code: string): Promise<{ world_id: string; world_name: string; role: string }> {
    const raw = await this.request('POST', '/account/join', { code }) as { world_id?: unknown; world_name?: unknown; role?: unknown };
    if (!raw || typeof raw.world_id !== 'string' || !raw.world_id) {
      throw new Error('join response missing the world');
    }
    return {
      world_id: raw.world_id,
      world_name: typeof raw.world_name === 'string' ? raw.world_name : '',
      role: typeof raw.role === 'string' ? raw.role : 'contributor',
    };
  }
  // The world create moved to the SDK's createAccountWorld (1.83.1, `make-online.ts`).
}
