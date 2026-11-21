/**
 * keel's key and PIN rules, played for tests (read from keel's `core/auth.py`
 * `_authenticate` and `accounts/roster_api.py` `_check_sent_member_pin`).
 *
 * Two readings of a PIN sent beside a key that cannot write, chosen by
 * `readKeyPin`:
 * - `checked` (keel today): an owner's read key on a read route has a sent PIN
 *   checked against the world PIN, and a member's read key has one checked on
 *   `GET /me` against the member's account PIN (a player seat's is ignored). A
 *   wrong one is a 401 `invalid_credentials`, param `API-Pin`, and counts.
 * - `ignored` (keel after the change): a PIN beside a read-scope key is not
 *   read at all, so a wrong one answers as no PIN does (200).
 *
 * Everything else is the same in both: a write key's PIN is checked on writes
 * and on `/me` (an owner key on every read it is sent with), a classic
 * ten-digit write key needs its PIN on every read, a read key on a write route
 * is a 403 `permission_error`, and an unknown key is a 401 with no param.
 *
 * The gate answers `GET /world` and `GET /me` itself and lets every other
 * request it allows fall through to the handlers after it (the stateful fake).
 *
 * The PIN wall (keel's lockout): a wrong PIN is a 401 each time, and the same
 * wrong PIN sent again counts once. Ten DIFFERENT wrong PINs on one key within
 * 15 minutes lock that key for `lockMs`: every later request that carries a
 * PIN, the right one included, answers 429 `rate_limited` with `param`
 * `API-Pin` and a `Retry-After` of the seconds left. A request that carries no
 * PIN goes through the lock. `throttleUntil` plays keel's other throttles: a
 * 429 `rate_limited` with no `param`, on every request, while it runs.
 */
import { http, HttpResponse } from 'msw';

export type ReadKeyPin = 'checked' | 'ignored';

export interface PlayedKey {
  scope: 'read' | 'write';
  /** A member's key (`person`, `agent`, `player`); absent for the owner's own keys. */
  member?: 'person' | 'agent' | 'player';
  /** An agent seat's secret, checked as its PIN. */
  seatSecret?: string;
}

export interface PlayedKeel {
  /** The world PIN (the owner's account PIN). */
  worldPin: string;
  /** A person member's own account PIN. */
  memberPin: string;
  keys: Record<string, PlayedKey>;
  readKeyPin: ReadKeyPin;
  /** Every request: its route, the key and the PIN it carried. */
  seen: Array<{ call: string; key: string | null; pin: string | null }>;
  /** Wrong PINs keel counted, by key. */
  counted: Record<string, number>;
  /** The different wrong PINs each key met, with when (the wall's count). */
  wrongPins: Record<string, Map<string, number>>;
  /** A key's lock ends at this time (`Date.now()` clock). Set it to play a key already locked. */
  lockedUntil: Record<string, number>;
  /** How long the wall locks a key. */
  lockMs: number;
  /** keel's other throttles: every request answers 429 with no `param` until this time. */
  throttleUntil: number;
}

const LEGACY = /^\d{10}$/;
const DEMO = /^000000000[0-9]$/;

function err(status: number, type: string, code: string, message: string, param: string | null): Response {
  return HttpResponse.json({ error: { type, code, message, param } }, { status });
}

const WALL_WINDOW_MS = 15 * 60_000;
const WALL_DIFFERENT = 10;

function wait429(seconds: number, param: string | null): Response {
  return HttpResponse.json(
    { error: { type: 'rate_limit_error', code: 'rate_limited', message: 'Too many requests. Try again later.', param } },
    { status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil(seconds))) } },
  );
}

function wrongPin(state: PlayedKeel, key: string, pin: string | null): Response {
  state.counted[key] = (state.counted[key] ?? 0) + 1;
  if (pin) {
    const now = Date.now();
    const seen = state.wrongPins[key] ?? (state.wrongPins[key] = new Map());
    for (const [p, at] of seen) if (now - at > WALL_WINDOW_MS) seen.delete(p);
    if (!seen.has(pin)) seen.set(pin, now);
    if (seen.size >= WALL_DIFFERENT) {
      state.lockedUntil[key] = now + state.lockMs;
      seen.clear();
    }
  }
  return err(401, 'authentication_error', 'invalid_credentials', pin ? 'Incorrect PIN.' : 'A PIN is required: send it as API-Pin.', 'API-Pin');
}

export function playedKeel(base: string, init: Partial<PlayedKeel> & { keys: Record<string, PlayedKey> }, world = { id: 'w-played', name: 'Played world' }) {
  const state: PlayedKeel = {
    worldPin: '1234',
    memberPin: '5678',
    readKeyPin: 'checked',
    seen: [],
    counted: {},
    wrongPins: {},
    lockedUntil: {},
    lockMs: 15 * 60_000,
    throttleUntil: 0,
    ...init,
  };

  /** The key's record, a classic key by keel's own rule (demo range reads, the rest write). */
  const keyOf = (key: string): PlayedKey | null => {
    if (state.keys[key]) return state.keys[key];
    if (LEGACY.test(key)) return { scope: DEMO.test(key) ? 'read' : 'write' };
    return null;
  };

  const gate = http.all(`${base}/*`, ({ request }) => {
    const url = new URL(request.url);
    const path = url.pathname.slice(new URL(base).pathname.length);
    const key = request.headers.get('API-Key');
    const pin = request.headers.get('API-Pin');
    state.seen.push({ call: `${request.method} ${path}`, key, pin });
    const now = Date.now();
    if (state.throttleUntil > now) return wait429((state.throttleUntil - now) / 1000, null);
    // The wall: a locked key takes no PIN, the right one included; a request with none goes through.
    const locked = key ? state.lockedUntil[key] ?? 0 : 0;
    if (pin && locked > now) return wait429((locked - now) / 1000, 'API-Pin');
    const k = key ? keyOf(key) : null;
    if (!key || !k) return err(401, 'authentication_error', 'invalid_credentials', 'No valid API-Key.', null);
    const write = request.method !== 'GET';
    if (write && k.scope !== 'write') return err(403, 'permission_error', 'permission_error', 'This key is read-only and cannot write to this world.', null);
    const legacy = LEGACY.test(key);
    if (k.member) {
      if (write) {
        if (k.member === 'player') return err(403, 'permission_error', 'permission_error', 'This key is read-only and cannot write to this world.', null);
        const expected = k.member === 'agent' ? k.seatSecret : state.memberPin;
        if (!pin || pin !== expected) return wrongPin(state, key, pin);
      } else if (path === '/me' && pin && k.member !== 'player') {
        // A member key's sent PIN, checked on /me only.
        const reads = !(k.scope === 'read' && state.readKeyPin === 'ignored');
        const expected = k.member === 'agent' ? k.seatSecret : state.memberPin;
        if (reads && pin !== expected) return wrongPin(state, key, pin);
      }
    } else if (write) {
      if (pin !== state.worldPin) return wrongPin(state, key, pin);
    } else if (legacy && k.scope === 'write') {
      // v1 parity: a classic write key's reads need the PIN.
      if (pin !== state.worldPin) return wrongPin(state, key, pin);
    } else if (pin && !DEMO.test(key)) {
      // A sent PIN is checked on a read; after the change, only beside a key that writes.
      const reads = !(k.scope === 'read' && state.readKeyPin === 'ignored');
      if (reads && pin !== state.worldPin) return wrongPin(state, key, pin);
    }
    if (request.method === 'GET' && path === '/world') return HttpResponse.json({ ...world, updated_at: '2026-11-20T10:00:00Z' });
    if (request.method === 'GET' && path === '/me') {
      return HttpResponse.json({
        world,
        scope: k.scope,
        kind: k.member ?? 'owner',
        role: k.member ? 'contributor' : 'owner',
        membership: k.member ? 'mem-1' : null,
        character: null,
      });
    }
    return undefined;
  });

  return { state, gate };
}
