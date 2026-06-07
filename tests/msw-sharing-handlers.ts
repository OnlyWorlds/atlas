/**
 * Stateful MSW handlers for the SHARING API — encodes SHARING_CONTRACT.md
 * v0.2 §4 BEFORE the backend exists (fakes-first, convention #20): the
 * client + S4 publish flow are built and test-locked against these rules,
 * so integration with Anchor's slice is "point at the real base path".
 *
 * Encoded contract rules:
 *   - slug: [a-z0-9-], 4–40, no leading/trailing '-', reserved list → 400 slug_invalid
 *   - slug uniqueness GLOBAL incl. revoked rows → 409 slug_taken …
 *   - … EXCEPT republish-to-own-tombstone: POST to your own revoked slug
 *     revives it (new payload, revoked=false) — unless admin_locked
 *   - quota: 10 active (non-revoked) pages per ACCOUNT (api key) → quota_exceeded
 *   - payload cap 256KB measured on serialized JSON → 400 payload_too_large
 *   - PATCH: title/intent/payload only; slug change → 400 slug_invalid;
 *     admin_locked → 403 admin_locked; revoked/unknown id → 404 not_found
 *   - DELETE: tombstone (payload=null, revoked=true), idempotent 204
 *   - GET /pages/<slug>/: public (no auth); active → §5.2 envelope;
 *     revoked/admin_locked → 410 revoked; unknown → 404 not_found
 *   - auth: API-Key + API-Pin headers on everything else → 401 auth_failed
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
const QUOTA = 10;
const PAYLOAD_CAP_BYTES = 256 * 1024;

function err(status: number, code: string, detail?: string) {
  return HttpResponse.json({ error: { code, ...(detail ? { detail } : {}) } }, { status });
}

function validSlug(slug: string): boolean {
  return typeof slug === 'string' && slug.length >= 4 && slug.length <= 40
    && SLUG_RE.test(slug) && !RESERVED_SLUGS.has(slug);
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
      if (!account) return err(401, 'auth_failed');
      const body = await request.json() as { slug?: string; title?: string; intent?: string; payload?: unknown };
      const slug = body.slug ?? '';
      if (!validSlug(slug)) return err(400, 'slug_invalid');
      if (JSON.stringify(body.payload ?? null).length > PAYLOAD_CAP_BYTES) {
        return err(400, 'payload_too_large');
      }

      const existing = state.bySlug(slug);
      if (existing) {
        // Own tombstone → revive (un-tombstone with fresh content)…
        if (existing.account === account && existing.revoked && !existing.admin_locked) {
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
      if (active >= QUOTA) return err(400, 'quota_exceeded');

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
      if (!account) return err(401, 'auth_failed');
      const slug = new URL(request.url).searchParams.get('slug') ?? '';
      if (!validSlug(slug)) return HttpResponse.json({ available: false });
      const existing = state.bySlug(slug);
      // Available when unused, or when it's YOUR revivable tombstone.
      const available = !existing || (existing.account === account && existing.revoked && !existing.admin_locked);
      return HttpResponse.json({ available });
    }),

    // GET /pages/?world= (list) — distinguished from the public GET by the query param.
    http.get(`${baseUrl}/pages/`, ({ request }) => {
      const account = requireAuth(request);
      if (!account) return err(401, 'auth_failed');
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
      });
    }),

    // PATCH /pages/<id>/ — republish (slug immutable).
    http.patch(`${baseUrl}/pages/:id/`, async ({ params, request }) => {
      const account = requireAuth(request);
      if (!account) return err(401, 'auth_failed');
      const row = pages.get(String(params.id));
      if (!row || row.account !== account || row.revoked) return err(404, 'not_found');
      if (row.admin_locked) return err(403, 'admin_locked');
      const body = await request.json() as { slug?: string; title?: string; intent?: string; payload?: unknown };
      if (body.slug !== undefined && body.slug !== row.slug) {
        return err(400, 'slug_invalid', 'slug is immutable — revoke and republish to rename');
      }
      if (body.payload !== undefined) {
        if (JSON.stringify(body.payload).length > PAYLOAD_CAP_BYTES) return err(400, 'payload_too_large');
        row.payload = body.payload;
      }
      if (body.title !== undefined) row.title = body.title;
      if (body.intent !== undefined) row.intent = body.intent;
      row.updated_at = nextStamp();
      const { account: _a, payload: _p, ...rest } = row;
      return HttpResponse.json(rest);
    }),

    // DELETE /pages/<id>/ — revoke (tombstone). Idempotent.
    http.delete(`${baseUrl}/pages/:id/`, ({ params, request }) => {
      const account = requireAuth(request);
      if (!account) return err(401, 'auth_failed');
      const row = pages.get(String(params.id));
      if (row && row.account === account) {
        row.revoked = true;
        row.payload = null;
        row.updated_at = nextStamp();
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return { handlers, state };
}
