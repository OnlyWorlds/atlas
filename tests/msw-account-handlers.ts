/**
 * Stateful MSW handlers for the keel v2 ACCOUNT endpoints (account mode).
 *
 * Independent from statefulV2Handlers (element CRUD / bulk / changes): the
 * account wall authenticates with `Authorization: Bearer ow_a_...` and NOTHING
 * else — no API-Key / API-Pin. Wire contract pinned from keel source 2026-07-13
 * (see src/sync/account-client.ts header + Notes/2026-07-13-account-mode-design.md):
 *
 *   GET  /account                    → 200 {id, username, email, date_joined}
 *   GET  /account/worlds             → 200 {data:[AccountWorldRow]}
 *   POST /account/worlds             → 201 row + full ow_w_ key (pin dance)
 *   POST /account/worlds/{id}/keys   → 201 {..., key}; owner-only, else 404
 *
 * Errors ride the same §9 envelope as statefulV2Handlers.envelope(): a bad
 * bearer token 401s with code `invalid_credentials`; a revoked token 401s with
 * `key_revoked` (distinct code, distinct user message). The mint + create
 * paths reproduce the owner-only 404 and the PIN-dance 422 exactly so the
 * client's flow logic is exercised against real status codes.
 */

import { http, HttpResponse, type HttpHandler } from 'msw';
import type { AccountWorldRow } from '../src/core/types';

const V2_DEFAULT_BASE = 'https://www.onlyworlds.com/api/v2';

export interface AccountProfileSeed {
  id: string;
  username: string;
  email: string;
  date_joined: string | null;
}

export interface StatefulAccountOptions {
  /** Override the base URL. Default: production v2. Routes have NO trailing slash. */
  base?: string;
  /** The one valid bearer token. Any other (or missing) → 401 invalid_credentials. */
  token: string;
  /** Identity served by GET /account. */
  profile: AccountProfileSeed;
  /** World rows served by GET /account/worlds (also the mint/owner source). */
  worlds: AccountWorldRow[];
  /**
   * When true, EVERY authenticated call 401s with code `key_revoked` — even
   * with the correct token. Models a revoked account token (keel T6).
   */
  revoked?: boolean;
  /**
   * PIN-dance seam for POST /account/worlds. When true the account already has
   * a PIN, so a body carrying `pin` is rejected 422 param=pin; when false the
   * account is pinless, so a body WITHOUT `pin` is rejected 422 param=pin.
   */
  accountHasPin?: boolean;
}

export interface AccountHandlerState {
  /** Every WRITE key minted via POST /account/worlds/{id}/keys, in order. */
  minted: Array<{ worldId: string; key: string }>;
  /** Every world created via POST /account/worlds, in order. */
  created: Array<{ name: string; id: string; key: string }>;
  /** GET /account/worlds hit count — lets the caller assert fetch de-dup. */
  listCount: number;
  /** GET /account hit count. */
  profileCount: number;
}

/** §9 envelope, byte-compatible with statefulV2Handlers.envelope(). */
function envelope(
  status: number,
  code: string,
  message: string,
  param: string | null = null,
): Response {
  const errType = code === 'invalid_credentials' || code === 'key_revoked'
    ? 'authentication_error'
    : 'invalid_request_error';
  return HttpResponse.json(
    {
      error: {
        type: errType,
        code,
        message,
        param,
        doc_url: `https://www.onlyworlds.com/docs/errors#${code}`,
      },
    },
    { status },
  );
}

export function statefulAccountHandlers(options: StatefulAccountOptions): {
  handlers: HttpHandler[];
  state: AccountHandlerState;
} {
  const base = (options.base ?? V2_DEFAULT_BASE).replace(/\/$/, '');
  const state: AccountHandlerState = { minted: [], created: [], listCount: 0, profileCount: 0 };
  let mintCounter = 0;
  const worlds = [...options.worlds];

  /**
   * Bearer-wall check. Returns a 401 Response when the auth is bad (missing /
   * wrong token → invalid_credentials; revoked flag → key_revoked), or null
   * when the caller may proceed.
   */
  function authFail(request: Request): Response | null {
    const header = request.headers.get('Authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (options.revoked) {
      return envelope(401, 'key_revoked', 'This account token was revoked.');
    }
    if (!token || token !== options.token) {
      return envelope(401, 'invalid_credentials', 'Account token not recognized.');
    }
    return null;
  }

  const handlers: HttpHandler[] = [
    // GET /account — identity / "who am I" validation call.
    http.get(`${base}/account`, ({ request }) => {
      const fail = authFail(request);
      if (fail) return fail;
      state.profileCount += 1;
      return HttpResponse.json(options.profile);
    }),

    // GET /account/worlds — every world on the account, envelope {data:[...]}.
    http.get(`${base}/account/worlds`, ({ request }) => {
      const fail = authFail(request);
      if (fail) return fail;
      state.listCount += 1;
      return HttpResponse.json({ data: worlds });
    }),

    // POST /account/worlds — create a new api world (PIN dance). MUST precede
    // the /{id}/keys route so a bare POST /account/worlds isn't captured by it.
    http.post(`${base}/account/worlds`, async ({ request }) => {
      const fail = authFail(request);
      if (fail) return fail;
      const body = (await request.json().catch(() => ({}))) as { name?: string; pin?: string };
      const hasPin = 'pin' in body && body.pin !== undefined;
      // The dance: pinned account REJECTS a sent pin; pinless account REQUIRES one.
      if (options.accountHasPin && hasPin) {
        return envelope(422, 'invalid_request', 'This account already has a PIN.', 'pin');
      }
      if (!options.accountHasPin && !hasPin) {
        return envelope(422, 'invalid_request', 'A PIN is required to create your first world.', 'pin');
      }
      mintCounter += 1;
      const id = `srv-created-${mintCounter}`;
      const key = `ow_w_test${mintCounter}`;
      state.created.push({ name: body.name ?? '', id, key });
      return HttpResponse.json(
        { id, name: body.name ?? '', role: 'owner', public_read: false, key },
        { status: 201 },
      );
    }),

    // POST /account/worlds/{id}/keys — mint a WRITE key. Owner-only; a row that
    // isn't owned (or doesn't exist) 404s per the contract.
    http.post(`${base}/account/worlds/:id/keys`, ({ request, params }) => {
      const fail = authFail(request);
      if (fail) return fail;
      const worldId = String(params.id);
      const row = worlds.find(w => w.id === worldId);
      if (!row || row.role !== 'owner') {
        return envelope(404, 'not_found', `World '${worldId}' not found.`);
      }
      mintCounter += 1;
      const key = `ow_w_test${mintCounter}`;
      state.minted.push({ worldId, key });
      return HttpResponse.json(
        { id: `key-${mintCounter}`, last4: key.slice(-4), scope: 'WRITE', last_used_at: null, revoked: false, key },
        { status: 201 },
      );
    }),
  ];

  return { handlers, state };
}
