/**
 * Sharing API client — SHARING_CONTRACT.md v0.2 §4.
 *
 * Thin typed fetch wrapper over the sharing endpoints (publish / public GET /
 * republish / revoke / list / slug-check). Deliberately NOT the OW SDK: the
 * sharing endpoints are a separate surface with their own error contract
 * (machine codes in `{"error":{"code"}}` bodies — see SharingErrorCode).
 *
 * FAKES-FIRST: this client is built and test-locked against
 * `tests/msw-sharing-handlers.ts`, which encodes the v0.2 contract (slug
 * rules, quota, tombstone semantics, slug immutability) — the same
 * fakes-mirror-real discipline as the worldapi fakes (convention #20). When
 * Anchor's backend lands, integration is pointing `SHARING_BASE_URL` at the
 * real base path and running the suite.
 *
 * Auth: worldapi headers (`API-Key` + `API-Pin`); the world association
 * derives from the key server-side. The public GET sends no auth.
 */

/**
 * Base URL for the sharing API. §8.1 of the contract leaves the path to
 * Anchor — this is the single place it changes.
 */
export const SHARING_BASE_URL = 'https://www.onlyworlds.com/api/sharing';

/** Public viewer origin — where published slugs resolve (contract §7). */
export const SHARE_VIEWER_ORIGIN = 'https://show.onlyworlds.com';

export function publicUrlFor(slug: string): string {
  return `${SHARE_VIEWER_ORIGIN}/${slug}`;
}

// ---------------------------------------------------------------------------
// Slug rules (contract §2): [a-z0-9-], 4–40 chars, no leading/trailing '-'.
// Validated client-side for instant UX; the server re-validates.
// ---------------------------------------------------------------------------

export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{2,38}[a-z0-9])?$/;

export function isValidSlug(slug: string): boolean {
  return slug.length >= 4 && slug.length <= 40 && SLUG_RE.test(slug);
}

/** Suggest a slug from a page name: lowercase, hyphens, trimmed to the rules. */
export function suggestSlug(name: string): string {
  const s = name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return s.length >= 4 ? s : s.padEnd(4, '0');
}

// ---------------------------------------------------------------------------
// Errors — the contract §4 machine-code enum, plus client-side categories.
// ---------------------------------------------------------------------------

export type SharingErrorCode =
  | 'slug_taken' | 'slug_invalid' | 'quota_exceeded' | 'payload_too_large'
  | 'revoked' | 'not_found' | 'rate_limited' | 'admin_locked'
  | 'auth_failed' | 'network' | 'unknown';

export class SharingApiError extends Error {
  constructor(
    public code: SharingErrorCode,
    public status: number,
    detail?: string,
  ) {
    super(detail || code);
    this.name = 'SharingApiError';
  }
}

/** Human-facing message per code (toast copy). */
export function sharingErrorMessage(err: SharingApiError): string {
  switch (err.code) {
    case 'slug_taken': return 'That URL is already taken — pick another slug.';
    case 'slug_invalid': return 'Slug must be 4–40 chars: a–z, 0–9, hyphens (not at the edges).';
    case 'quota_exceeded': return 'Page limit reached — revoke an old page to publish a new one.';
    case 'payload_too_large': return 'This page is too large to publish (256KB limit).';
    case 'revoked': return 'This page has been revoked.';
    case 'not_found': return 'Page not found on the server.';
    case 'rate_limited': return 'Too many publishes — wait a bit and try again.';
    case 'admin_locked': return 'This slug has been locked by an administrator.';
    case 'auth_failed': return 'Authentication failed — check the world\'s API key and PIN in settings.';
    case 'network': return 'Could not reach the sharing server.';
    default: return 'Publishing failed — try again.';
  }
}

// ---------------------------------------------------------------------------
// Wire shapes.
// ---------------------------------------------------------------------------

export interface PublishBody {
  slug: string;
  title: string;
  intent: string;
  payload: unknown;
}

export interface PublishResult {
  id: string;
  slug: string;
  url: string;
}

/** The public GET envelope (contract §5.2). */
export interface PublicPageEnvelope {
  slug: string;
  published_at: string;
  updated_at: string;
  payload: unknown;
}

/** A row from the authenticated list endpoint (atlas's management view). */
export interface SharedPageRow {
  id: string;
  slug: string;
  title: string;
  intent: string;
  revoked: boolean;
  view_count: number;
  published_at: string;
  updated_at: string;
}

export interface SharingClientOptions {
  baseUrl?: string;
  apiKey: string;
  pin: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
}

// ---------------------------------------------------------------------------
// The client.
// ---------------------------------------------------------------------------

export class SharingClient {
  private baseUrl: string;
  private apiKey: string;
  private pin: string;
  private fetchFn: typeof fetch;

  constructor(opts: SharingClientOptions) {
    this.baseUrl = (opts.baseUrl ?? SHARING_BASE_URL).replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.pin = opts.pin;
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  }

  /** POST /pages/ — publish (or revive an own tombstoned slug). */
  async publish(body: PublishBody): Promise<PublishResult> {
    return this.request<PublishResult>('POST', '/pages/', { auth: true, body });
  }

  /** GET /pages/<slug>/ — the public fetch (no auth). 410 → SharingApiError('revoked'). */
  async getPublic(slug: string): Promise<PublicPageEnvelope> {
    return this.request<PublicPageEnvelope>('GET', `/pages/${encodeURIComponent(slug)}/`, { auth: false });
  }

  /** PATCH /pages/<id>/ — republish. Slug is IMMUTABLE (contract §2) — never sent. */
  async republish(
    id: string,
    changes: { title?: string; intent?: string; payload?: unknown },
  ): Promise<SharedPageRow> {
    return this.request<SharedPageRow>('PATCH', `/pages/${encodeURIComponent(id)}/`, { auth: true, body: changes });
  }

  /** DELETE /pages/<id>/ — revoke (tombstone). Idempotent. */
  async revoke(id: string): Promise<void> {
    await this.request<void>('DELETE', `/pages/${encodeURIComponent(id)}/`, { auth: true, allowEmpty: true });
  }

  /** GET /pages/?world=<id> — own pages incl. revoked. */
  async listForWorld(worldId: string): Promise<SharedPageRow[]> {
    return this.request<SharedPageRow[]>('GET', `/pages/?world=${encodeURIComponent(worldId)}`, { auth: true });
  }

  /** GET /slug-check/?slug= — pre-publish availability. */
  async slugCheck(slug: string): Promise<boolean> {
    const r = await this.request<{ available: boolean }>(
      'GET', `/slug-check/?slug=${encodeURIComponent(slug)}`, { auth: true });
    return r.available === true;
  }

  // ---- plumbing -------------------------------------------------------------

  private async request<T>(
    method: string,
    path: string,
    opts: { auth: boolean; body?: unknown; allowEmpty?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (opts.auth) {
      headers['API-Key'] = this.apiKey;
      headers['API-Pin'] = this.pin;
    }
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
    } catch (err) {
      throw new SharingApiError('network', 0, err instanceof Error ? err.message : 'fetch failed');
    }

    if (res.ok) {
      if (opts.allowEmpty || res.status === 204) return undefined as T;
      return await res.json() as T;
    }

    // Error path: prefer the contract's machine code; fall back by status.
    let code: SharingErrorCode = 'unknown';
    let detail: string | undefined;
    try {
      const body = await res.json() as { error?: { code?: string; detail?: string } };
      const raw = body?.error?.code;
      detail = body?.error?.detail;
      if (raw && isKnownCode(raw)) code = raw;
    } catch { /* non-JSON error body */ }
    if (code === 'unknown') {
      if (res.status === 401 || res.status === 403) code = 'auth_failed';
      else if (res.status === 404) code = 'not_found';
      else if (res.status === 410) code = 'revoked';
      else if (res.status === 429) code = 'rate_limited';
    }
    throw new SharingApiError(code, res.status, detail);
  }
}

const KNOWN_CODES: ReadonlySet<string> = new Set([
  'slug_taken', 'slug_invalid', 'quota_exceeded', 'payload_too_large',
  'revoked', 'not_found', 'rate_limited', 'admin_locked',
]);

function isKnownCode(raw: string): raw is SharingErrorCode {
  return KNOWN_CODES.has(raw);
}
