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

export interface CreatedAccountWorld {
  id: string;
  name: string;
  role: 'owner';
  public_read: boolean;
  /** The full ow_w_ WRITE key — shown exactly once. */
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
  if (err instanceof OwV2Error) {
    if (err.code === 'key_revoked') return 'This account token was revoked. Create a new one on onlyworlds.com.';
    if (err.status === 401) return 'Account token not recognized. Check it on onlyworlds.com, in Account settings under Account tokens.';
    if (err.code === 'rate_limited') return 'Too many attempts. Wait a moment and try again.';
  }
  // Anything else is worded, never read out (S369): the fallback used to be
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
    body?: unknown
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
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
   * reads honestly — Captain's named-keys condition, live 2026-07-13. Omitted
   * name keeps the old bare mint (server stores "").
   */
  async mintWorldKey(worldId: string, name?: string, scope: 'write' | 'read' = 'write'): Promise<MintedWorldKey> {
    const fields: Record<string, string> = {};
    if (name) fields.name = name;
    if (scope === 'read') fields.scope = 'read';
    const body = Object.keys(fields).length > 0 ? fields : undefined;
    const raw = await this.request('POST', `/account/worlds/${worldId}/keys`, body) as MintedWorldKey;
    if (!raw || typeof raw.key !== 'string' || !raw.key) {
      throw new Error('key mint response missing the full key');
    }
    return raw;
  }

  /**
   * Take back a key this account minted (`DELETE /account/worlds/{id}/keys/{key_id}`,
   * 204): an owner any of the world's keys, a member only their own.
   */
  async revokeWorldKey(worldId: string, keyId: string): Promise<void> {
    await this.request('DELETE', `/account/worlds/${worldId}/keys/${keyId}`);
  }

  /**
   * Accept a person's join link (keel #212, `POST /account/join`, body
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

  /**
   * Create a new api world. `pin` per the dance: omit first; on 422 param=pin
   * the CALLER retries with the registry PIN (this method stays dumb — the
   * dance is flow logic, not wire logic).
   */
  async createWorld(
    name: string,
    pin?: string,
    lines?: { source?: Record<string, unknown>; producer?: Record<string, unknown> },
  ): Promise<CreatedAccountWorld> {
    const body: Record<string, unknown> = { name };
    if (pin !== undefined) body.pin = pin;
    // The folder's provenance lines, kept by keel as the world's origin (Keel #571).
    if (lines?.source) body.source = lines.source;
    if (lines?.producer) body.producer = lines.producer;
    const raw = await this.request('POST', '/account/worlds', body) as CreatedAccountWorld;
    if (!raw || typeof raw.key !== 'string' || !raw.key || typeof raw.id !== 'string') {
      throw new Error('create-world response missing id or key');
    }
    return raw;
  }
}
