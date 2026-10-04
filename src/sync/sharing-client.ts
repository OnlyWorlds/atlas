/**
 * Sharing API client — SHARING_CONTRACT.md v0.3 §4 (as-built).
 *
 * Thin typed fetch wrapper over the sharing endpoints (publish / public GET /
 * republish / revoke / list / slug-check). Deliberately NOT the OW SDK: the
 * sharing endpoints are a separate surface with their own error contract
 * (machine codes in `{"error":{"code"}}` bodies — see SharingErrorCode).
 *
 * Built fakes-first and test-locked against `tests/msw-sharing-handlers.ts`
 * (convention #20); the fakes were synced to Anchor's AS-BUILT `ow/sharing/`
 * Django slice (2026-06-07): slug-addressed mutations, locked error enum,
 * quota 20, enveloped 401. Residual fake assumptions are tagged VERIFY-LIVE.
 *
 * Auth: worldapi headers (`API-Key` + `API-Pin`); the world association
 * derives from the key server-side. The public GET sends no auth.
 */

/**
 * Base URL for the sharing API — CONFIRMED as-built (Anchor's `ow/sharing/`
 * app, 2026-06-07). Must stay pinned to the www host: CF purge-by-URL keys on
 * `https://www.onlyworlds.com/api/sharing/pages/<slug>/`, so a non-www fetch
 * would miss the purged cache entry.
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
  | 'title_too_long' | 'intent_invalid'
  | 'revoked' | 'not_found' | 'rate_limited' | 'admin_locked'
  | 'forbidden' | 'unauthorized'
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
    case 'slug_taken': return 'That URL is already taken. Pick another slug.';
    case 'slug_invalid': {
      // The server's detail beats the generic rule recital (e.g. a RESERVED
      // slug passes the format rules — "must be 4–40 chars" would gaslight).
      const detail = err.message && err.message !== 'slug_invalid' ? err.message : ''; // raw-error-ok: the sharing server's slug detail is written for users (a reserved word)
      return detail
        ? `Slug rejected: ${detail}`
        : 'Slug must be 4–40 chars: a–z, 0–9, hyphens (not at the edges). Some words are reserved.';
    }
    case 'quota_exceeded': return 'Page limit reached. Revoke an old page to publish a new one.';
    case 'payload_too_large': return 'This page is too large to publish (256KB limit).';
    case 'revoked': return 'This page has been revoked.';
    case 'not_found': return 'Page not found on the server.';
    case 'rate_limited': return 'Too many publishes. Wait a bit and try again.';
    case 'admin_locked': return 'This slug has been locked by an administrator.';
    case 'title_too_long': return 'Page name is too long to publish (200 characters max).';
    case 'intent_invalid': return 'Page intent isn\'t valid. Pick show, reference, or publish.';
    // As-built: 403 forbidden fires only for demo-world writes (cross-account
    // mutations are existence-hidden 404s).
    case 'forbidden': return 'This world doesn\'t allow publishing.';
    case 'unauthorized':
    case 'auth_failed': return 'Authentication failed. Check the world\'s API key and PIN in settings.';
    case 'network': return 'Could not reach the sharing server.';
    default: return 'Publishing failed. Try again.';
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

  /**
   * PATCH /pages/<slug>/ — republish. Mutations are SLUG-addressed (Anchor,
   * as-built: django-ninja path-converter limits collapse GET/PATCH/DELETE
   * onto one slug path with per-method dispatch; the slug is immutable +
   * unique, so it's a stable address). Slug itself is IMMUTABLE (contract §2)
   * — never sent in the body.
   */
  async republish(
    slug: string,
    changes: { title?: string; intent?: string; payload?: unknown },
  ): Promise<SharedPageRow> {
    return this.request<SharedPageRow>('PATCH', `/pages/${encodeURIComponent(slug)}/`, { auth: true, body: changes });
  }

  /** DELETE /pages/<slug>/ — revoke (tombstone). Slug-addressed. Idempotent. */
  async revoke(slug: string): Promise<void> {
    await this.request<void>('DELETE', `/pages/${encodeURIComponent(slug)}/`, { auth: true, allowEmpty: true });
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
      throw new SharingApiError('network', 0, err instanceof Error ? err.message : 'fetch failed'); // raw-error-ok: worded by its code ('network'), never shown
    }

    if (res.ok) {
      if (opts.allowEmpty || res.status === 204) return undefined as T;
      // Tolerate empty 200 bodies (the PATCH response shape isn't pinned by
      // the contract — VERIFY-LIVE; callers treat the row as optional).
      try { return await res.json() as T; } catch { return undefined as T; }
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

/** The locked server enum (Anchor, as-built) + envelope-carried 401/403 codes. */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  'slug_taken', 'slug_invalid', 'quota_exceeded', 'payload_too_large',
  'title_too_long', 'intent_invalid',
  'revoked', 'not_found', 'rate_limited', 'admin_locked',
  'forbidden', 'unauthorized',
]);

function isKnownCode(raw: string): raw is SharingErrorCode {
  return KNOWN_CODES.has(raw);
}
