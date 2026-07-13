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
 *        Empty body = WRITE scope default. Owner-only; non-owner → 404.
 *        ⚠ No {name} field exists yet (asked of Skeld 2026-07-13) — do not
 *        send one, unknown body fields 422.
 *
 * Errors ride the same §9 envelope as v2 element routes and surface as
 * OwV2Error (invalid token → 401 invalid_credentials; revoked token → 401
 * key_revoked — distinct codes, distinct user messages).
 */

import { OwV2Error, DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import type { AccountWorldRow } from '../core/types';

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
    if (err.code === 'key_revoked') return 'This account token was revoked. Mint a new one on onlyworlds.com.';
    if (err.status === 401) return 'Account token not recognized. Check it on onlyworlds.com → Settings → Account tokens.';
    if (err.code === 'rate_limited') return 'Too many attempts. Wait a moment and try again.';
    return err.message.replace(/^API Error \d+: /, '');
  }
  return err instanceof Error ? err.message : String(err);
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
   * Mint a WRITE key for an owned world. The response's `key` is shown once —
   * the caller must persist it (world.json api block) before dropping it.
   */
  async mintWorldKey(worldId: string): Promise<MintedWorldKey> {
    const raw = await this.request('POST', `/account/worlds/${worldId}/keys`) as MintedWorldKey;
    if (!raw || typeof raw.key !== 'string' || !raw.key) {
      throw new Error('key mint response missing the full key');
    }
    return raw;
  }

  /**
   * Create a new api world. `pin` per the dance: omit first; on 422 param=pin
   * the CALLER retries with the registry PIN (this method stays dumb — the
   * dance is flow logic, not wire logic).
   */
  async createWorld(name: string, pin?: string): Promise<CreatedAccountWorld> {
    const body: Record<string, unknown> = { name };
    if (pin !== undefined) body.pin = pin;
    const raw = await this.request('POST', '/account/worlds', body) as CreatedAccountWorld;
    if (!raw || typeof raw.key !== 'string' || !raw.key || typeof raw.id !== 'string') {
      throw new Error('create-world response missing id or key');
    }
    return raw;
  }
}
