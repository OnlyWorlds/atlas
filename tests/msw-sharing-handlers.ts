/**
 * Stateful MSW handlers for the SHARING API — encodes SHARING_CONTRACT.md
 * v0.3 §4, synced to Anchor's AS-BUILT slice (her 2026-06-07 message: the
 * `ow/sharing/` Django app, 83 tests). Fakes-first (convention #20): the
 * client + S4 publish flow are test-locked against these rules, so
 * integration is "point SHARING_BASE_URL at the deployed path".
 *
 * Encoded contract rules (v0.3 as-built, ALL VERIFIED — Anchor's 2026-06-12
 * confirmation closed every VERIFY-LIVE item):
 *   - slug FORMAT: [a-z0-9-], 4–40, no leading/trailing '-' → 400 slug_invalid;
 *     RESERVED words → 409 slug_taken (they're "taken by the system")
 *   - slug uniqueness GLOBAL incl. revoked rows → 409 slug_taken …
 *   - … EXCEPT republish-to-own-tombstone: POST to your own revoked slug
 *     revives it (new payload, revoked=false) — unless admin_locked.
 *     Revival counts against quota (transition-to-active) → 429
 *   - quota: 20 active (non-revoked) pages per ACCOUNT → 429 quota_exceeded
 *     (ALL limit rejections are 429; 400 is reserved for validation)
 *   - payload cap 256KB measured on serialized JSON → 400 payload_too_large
 *   - title ≤ 200 chars → 400 title_too_long; intent ∈ {show,reference,publish}
 *     → 400 intent_invalid (server-side validation, POST + PATCH)
 *   - MUTATIONS ARE SLUG-ADDRESSED: PATCH/DELETE hit /pages/<slug>/ (django-
 *     ninja path-converter constraint — Anchor's call). Publish response still
 *     exposes `id`; the slug is the mutation address.
 *   - PATCH: title/intent/payload only; slug change → 400 slug_invalid;
 *     admin_locked → 403 admin_locked; CROSS-ACCOUNT → 404 not_found
 *     (existence-hiding: the queryset scopes by world, confirmed live);
 *     own REVOKED row + payload → 200 REVIVES (second revival path,
 *     quota-checked → 429); unknown → 404
 *   - DELETE: tombstone (payload=null, revoked=true), idempotent 204 for own
 *     rows; cross-account → 404 (same existence-hiding); unknown → 404
 *   - GET /pages/<slug>/: public (no auth); active → §5.2 envelope —
 *     INCLUDING empty payloads ({} is a valid active page, NOT a 410);
 *     revoked/admin_locked → 410 revoked; unknown → 404 not_found
 *   - auth: 401 carries the envelope (`code: "unauthorized"`) AND the legacy
 *     `{"detail": "Unauthorized"}` top-level key (Anchor's additive handler)
 *   - 403 forbidden exists ONLY for demo-world writes (not modeled here)
 *
 * Status map (Anchor, 2026-06-12): 400 validation · 401 unauthorized ·
 * 403 forbidden/admin_locked · 404 not_found (missing OR cross-account) ·
 * 409 slug_taken (incl. reserved) · 429 quota_exceeded/rate_limited.
 *
 * Error bodies are the contract shape: `{"error":{"code","detail"?}}`.
 */

import { http, HttpResponse } from 'msw';

export interface FakeSharedPage {
  id: string;
  account: string;            // the api key — "world association derives from the key"
  world: string;
  slug: string;
  title: string;
  intent: string;
  payload: unknown | null;
  revoked: boolean;
  admin_locked: boolean;
  view_count: number;
  published_at: string;
  updated_at: string;
}

export interface SharingFakeState {
  pages: Map<string, FakeSharedPage>;
  /** Test hooks. */
  bySlug(slug: string): FakeSharedPage | undefined;
  adminLock(slug: string): void;
}

const RESERVED_SLUGS = new Set(['api', 'admin', 'assets', 'static', 'about', 'docs', 'help']);
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{2,38}[a-z0-9])?$/;
const QUOTA = 20;
const PAYLOAD_CAP_BYTES = 256 * 1024;
const TITLE_MAX = 200;
const VALID_INTENTS = new Set(['show', 'reference', 'publish']);

function err(status: number, code: string, detail?: string) {
  return HttpResponse.json({ error: { code, ...(detail ? { detail } : {}) } }, { status });
}

/** 401 as-built (live-probed 2026-06-12): envelope + the legacy top-level detail key. */
function unauthorized() {
  return HttpResponse.json(
    { detail: 'Unauthorized', error: { code: 'unauthorized', detail: 'Authentication required.' } },
    { status: 401 });
}

/** Format validity only — reserved words are format-VALID but 409 slug_taken. */
function validSlugFormat(slug: string): boolean {
  return typeof slug === 'string' && slug.length >= 4 && slug.length <= 40 && SLUG_RE.test(slug);
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `sp-${String(idCounter).padStart(6, '0')}`;
}

let clockCounter = 0;
function nextStamp(): string {
  clockCounter += 1;
  return new Date(1750000000000 + clockCounter * 1000).toISOString();
}

/**
 * Build the handler set + a state handle for assertions. `baseUrl` must match
 * the SharingClient's base (no trailing slash).
 */
export function statefulSharingHandlers(baseUrl: string) {
  const pages = new Map<string, FakeSharedPage>();

  const state: SharingFakeState = {
    pages,
    bySlug: (slug) => [...pages.values()].find(p => p.slug === slug),
    adminLock: (slug) => {
      const row = [...pages.values()].find(p => p.slug === slug);
      if (row) { row.admin_locked = true; row.revoked = true; row.payload = null; }
    },
  };

  const requireAuth = (request: Request): string | null => {
    const key = request.headers.get('API-Key');
    const pin = request.headers.get('API-Pin');
    if (!key || !pin) return null;
    return key;
  };

  const handlers = [
    // POST /pages/ — publish (or revive own tombstone).
    http.post(`${baseUrl}/pages/`, async ({ request }) => {
      const account = requireAuth(request);
      if (!account) return unauthorized();
      const body = await request.json() as { slug?: string; title?: string; intent?: string; payload?: unknown };
      const slug = body.slug ?? '';
      if (!validSlugFormat(slug)) return err(400, 'slug_invalid');
      if (RESERVED_SLUGS.has(slug)) return err(409, 'slug_taken', 'reserved');
      if (typeof body.title === 'string' && body.title.length > TITLE_MAX) {
        return err(400, 'title_too_long');
      }
      if (typeof body.intent === 'string' && !VALID_INTENTS.has(body.intent)) {
        return err(400, 'intent_invalid');
      }
      if (JSON.stringify(body.payload ?? null).length > PAYLOAD_CAP_BYTES) {
        return err(400, 'payload_too_large');
      }

      const existing = state.bySlug(slug);
      if (existing) {
        // Own tombstone → revive (un-tombstone with fresh content)…
        if (existing.account === account && existing.revoked && !existing.admin_locked) {
          // Confirmed: every transition-to-active is quota-checked, 429.
          const activeNow = [...pages.values()].filter(p => p.account === account && !p.revoked).length;
          if (activeNow >= QUOTA) return err(429, 'quota_exceeded');
          existing.payload = body.payload ?? null;
          existing.title = body.title ?? existing.title;
          existing.intent = body.intent ?? existing.intent;
          existing.revoked = false;
          existing.published_at = nextStamp();
          existing.updated_at = existing.published_at;
          return HttpResponse.json(
            { id: existing.id, slug, url: `https://show.onlyworlds.com/${slug}` }, { status: 201 });
        }
        // …anyone else (or admin-locked, or still active): taken.
        return err(409, 'slug_taken');
      }

      const active = [...pages.values()].filter(p => p.account === account && !p.revoked).length;
      if (active >= QUOTA) return err(429, 'quota_exceeded');

      const stamp = nextStamp();
      const row: FakeSharedPage = {
        id: nextId(), account, world: 'w-from-key', slug,
        title: body.title ?? '(untitled)', intent: body.intent ?? 'show',
        payload: body.payload ?? null, revoked: false, admin_locked: false,
        view_count: 0, published_at: stamp, updated_at: stamp,
      };
      pages.set(row.id, row);
      return HttpResponse.json({ id: row.id, slug, url: `https://show.onlyworlds.com/${slug}` }, { status: 201 });
    }),

    // GET /slug-check/?slug= (BEFORE the :slug route so it doesn't shadow).
    http.get(`${baseUrl}/slug-check/`, ({ request }) => {
      const account = requireAuth(request);
      if (!account) return unauthorized();
      const slug = new URL(request.url).searchParams.get('slug') ?? '';
      if (!validSlugFormat(slug) || RESERVED_SLUGS.has(slug)) {
        return HttpResponse.json({ available: false });
      }
      const existing = state.bySlug(slug);
      // Available when unused, or when it's YOUR revivable tombstone.
      const available = !existing || (existing.account === account && existing.revoked && !existing.admin_locked);
      return HttpResponse.json({ available });
    }),

    // GET /pages/?world= (list) — distinguished from the public GET by the query param.
    http.get(`${baseUrl}/pages/`, ({ request }) => {
      const account = requireAuth(request);
      if (!account) return unauthorized();
      const rows = [...pages.values()]
        .filter(p => p.account === account)
        .map(({ account: _a, payload: _p, ...row }) => row);
      return HttpResponse.json(rows);
    }),

    // GET /pages/<slug>/ — the PUBLIC fetch (no auth).
    http.get(`${baseUrl}/pages/:slug/`, ({ params }) => {
      const slug = String(params.slug);
      const row = state.bySlug(slug);
      if (!row) return err(404, 'not_found');
      if (row.revoked || row.admin_locked) return err(410, 'revoked');
      row.view_count += 1;
      return HttpResponse.json({
        slug: row.slug,
        published_at: row.published_at,
        updated_at: row.updated_at,
        payload: row.payload,
      }, {
        // Contract §7 fidelity — nothing client-side reads these today, but
        // the fake shouldn't under-claim the wire.
        headers: {
          'Cache-Control': 'public, max-age=3600',
          'ETag': `"${row.updated_at}"`,
        },
      });
    }),

    // PATCH /pages/<slug>/ — republish. SLUG-addressed (as-built; slug immutable).
    http.patch(`${baseUrl}/pages/:slug/`, async ({ params, request }) => {
      const account = requireAuth(request);
      if (!account) return unauthorized();
      const row = state.bySlug(String(params.slug));
      // Cross-account = same 404 as missing — the queryset scopes by world
      // (existence-hiding by construction; confirmed live 2026-06-12).
      if (!row || row.account !== account) return err(404, 'not_found');
      if (row.admin_locked) return err(403, 'admin_locked');
      const body = await request.json() as { slug?: string; title?: string; intent?: string; payload?: unknown };
      if (body.slug !== undefined && body.slug !== row.slug) {
        return err(400, 'slug_invalid', 'slug is immutable — revoke and republish to rename');
      }
      if (typeof body.title === 'string' && body.title.length > TITLE_MAX) {
        return err(400, 'title_too_long');
      }
      if (typeof body.intent === 'string' && !VALID_INTENTS.has(body.intent)) {
        return err(400, 'intent_invalid');
      }
      if (body.payload !== undefined) {
        if (JSON.stringify(body.payload).length > PAYLOAD_CAP_BYTES) return err(400, 'payload_too_large');
      }
      if (row.revoked) {
        // PATCH-revive (confirmed live): a payload-bearing PATCH on your own
        // revoked row revives it — quota-checked like any transition-to-active.
        // (Atlas's UI revives via POST; this path exists for fake fidelity.)
        // A payload-LESS patch updates fields but does not revive (unpinned
        // detail — UI never does this).
        if (body.payload !== undefined) {
          const activeNow = [...pages.values()].filter(p => p.account === account && !p.revoked).length;
          if (activeNow >= QUOTA) return err(429, 'quota_exceeded');
          row.revoked = false;
        }
      }
      if (body.payload !== undefined) row.payload = body.payload;
      if (body.title !== undefined) row.title = body.title;
      if (body.intent !== undefined) row.intent = body.intent;
      row.updated_at = nextStamp();
      const { account: _a, payload: _p, ...rest } = row;
      return HttpResponse.json(rest);
    }),

    // DELETE /pages/<slug>/ — revoke (tombstone). SLUG-addressed. Idempotent
    // for own rows (incl. already-revoked → 204).
    http.delete(`${baseUrl}/pages/:slug/`, ({ params, request }) => {
      const account = requireAuth(request);
      if (!account) return unauthorized();
      const row = state.bySlug(String(params.slug));
      // Cross-account = 404, same existence-hiding as PATCH (confirmed).
      if (!row || row.account !== account) return err(404, 'not_found');
      if (!row.revoked) {
        row.revoked = true;
        row.payload = null;
        row.updated_at = nextStamp();
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return { handlers, state };
}
