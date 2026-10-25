/**
 * Sign in with OnlyWorlds (Keel #515, D139; the handoff sheet, Orrery
 * `keel/signin-handoff.md` §4; contract `Forge/Notes/2026-10-24-s465-sign-in-with-onlyworlds-contract.md`).
 * The SDK's two calls (4.46.0): `signInWithOnlyWorlds` sends the tab to
 * onlyworlds.com with a PKCE challenge, `completeSignIn` trades the code on
 * `/signin/callback`. The token is kept as every sign-in keeps it
 * (`after-sign-in.ts`).
 *
 * Atlas keeps its own small resume beside the SDK's record: keel's Cancel
 * comes back with `error=access_denied` and no code, which the SDK refuses
 * as `state_mismatch` and clears with its resume, and a person who cancels
 * still lands where they were (contract R5, R7).
 */

import { OwV2Client, OwSignInError } from '@onlyworlds/sdk';
import { ATLAS_CLIENT_NAME, DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { CANNOT_REACH_LINE } from '../setup/key-check-errors';
import { JOIN_CODE_RE } from '../core/join-capture';
import { UUID_RE } from '../core/open-capture';

/** keel's registry: `GET /api/v2/auth/clients` lists `atlas` with exactly this address (production only). */
export const SIGN_IN_CLIENT_ID = 'atlas';
export const SIGN_IN_REDIRECT_URI = 'https://atlas.onlyworlds.com/signin/callback';
export const SIGN_IN_CALLBACK_PATH = '/signin/callback';
const SIGN_IN_ORIGIN = new URL(SIGN_IN_REDIRECT_URI).origin;

/** Atlas's resume, in this tab's sessionStorage: the SDK keeps its own record beside it. */
export const SIGN_IN_RESUME_KEY = 'atlas-signin-resume';

/** The doors that come back open after the round trip. */
export type SignInDoor = 'make-online' | 'new-api';

export interface SignInResume {
  /** The route at the press: `#/...`. */
  hash: string;
  door?: SignInDoor;
  /** A world id an Open in Atlas link held for the sign-in (open-door). */
  open?: string;
  /** A person's invitation code held for the sign-in (join-door). */
  join?: string;
}

/**
 * Offered only on the registered origin (R1): from a preview deployment or a
 * dev server the round trip would come back to production Atlas, another
 * origin with other storage.
 */
export function canSignInWithOnlyWorlds(origin: string = globalThis.location?.origin ?? ''): boolean {
  return origin === SIGN_IN_ORIGIN;
}

export function isSignInCallback(pathname: string = globalThis.location?.pathname ?? ''): boolean {
  return pathname.replace(/\/$/, '') === SIGN_IN_CALLBACK_PATH;
}

const HASH_MAX = 2048;

/** A resume read back, each part checked by shape; a part that fails is dropped, never guessed (R5). */
export function readResume(raw: string | null | undefined): SignInResume {
  let v: unknown = null;
  try { v = raw ? JSON.parse(raw) : null; } catch { v = null; }
  const o = (v && typeof v === 'object' && !Array.isArray(v)) ? v as Record<string, unknown> : {};
  const hash = typeof o.hash === 'string' && o.hash.startsWith('#/') && o.hash.length <= HASH_MAX
    && !/[\s<>"]/.test(o.hash) ? o.hash : '#/';
  const out: SignInResume = { hash };
  if (o.door === 'make-online' || o.door === 'new-api') out.door = o.door;
  if (typeof o.open === 'string' && UUID_RE.test(o.open)) out.open = o.open;
  if (typeof o.join === 'string' && JOIN_CODE_RE.test(o.join)) out.join = o.join;
  return out;
}

function sessionStore(): Storage | null {
  try { return globalThis.sessionStorage ?? null; } catch { return null; }
}

/** Take the resume out of this tab's storage: read once, cleared whatever happens next. `found`: this tab had started one. */
export function takeResume(): { resume: SignInResume; found: boolean } {
  const s = sessionStore();
  let raw: string | null = null;
  try { raw = s?.getItem(SIGN_IN_RESUME_KEY) ?? null; s?.removeItem(SIGN_IN_RESUME_KEY); } catch { raw = null; }
  return { resume: readResume(raw), found: raw !== null };
}

/** How long the exchange may take before the person is told (the S465 gate's G6): the SDK reads an abort as offline. */
export const SIGN_IN_EXCHANGE_LIMIT_MS = 20_000;

function fetchWithin(limitMs: number): typeof fetch {
  return (input, init) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), limitMs);
    return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(timer));
  };
}

/** A resume left by a round trip that never came back (Back from onlyworlds.com, then a reload) goes. */
export function dropStaleResume(): void {
  try { sessionStore()?.removeItem(SIGN_IN_RESUME_KEY); } catch { /* storage refused */ }
}

/**
 * Send the tab to onlyworlds.com. The caller has already saved what was
 * pending (R2). Throws when the browser keeps no session storage, since the
 * round trip could not finish here.
 */
export async function beginOnlyWorldsSignIn(resume: SignInResume, navigate?: (url: string) => void): Promise<void> {
  const s = sessionStore();
  if (!s) throw new OwSignInError('failed', 'no session storage');
  s.setItem(SIGN_IN_RESUME_KEY, JSON.stringify(resume));
  const client = new OwV2Client({ baseUrl: DEFAULT_V2_BASE, client: ATLAS_CLIENT_NAME });
  try {
    await client.signInWithOnlyWorlds({
      clientId: SIGN_IN_CLIENT_ID,
      redirectUri: SIGN_IN_REDIRECT_URI,
      storage: { get: k => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: k => s.removeItem(k) },
      ...(navigate ? { navigate } : {}),
    });
  } catch (err) {
    dropStaleResume();
    throw err;
  }
}

export type SignInOutcome =
  | { ok: true; token: string; tokenId: string | null; username: string; resume: SignInResume }
  | { ok: false; cancelled: boolean; error: unknown; resume: SignInResume; started: boolean };

/**
 * On `/signin/callback`: trade the code, then set the address to `/` and the
 * resumed route. Called at module load, before any other request Atlas makes
 * (R3): the SDK takes `code` and `state` out of the address bar before its
 * first await, and this function swaps the path before returning, so the
 * router reads the resumed route.
 */
export function startSignInCallback(href: string = location.href, base: string = DEFAULT_V2_BASE): Promise<SignInOutcome> {
  const cancelled = new URL(href).searchParams.get('error') === 'access_denied';
  const { resume, found: started } = takeResume();
  const s = sessionStore();
  const client = new OwV2Client({ baseUrl: base, client: ATLAS_CLIENT_NAME, fetch: fetchWithin(SIGN_IN_EXCHANGE_LIMIT_MS) });
  const pending = s
    ? client.completeSignIn({
        clientId: SIGN_IN_CLIENT_ID,
        url: href,
        storage: { get: k => s.getItem(k), set: (k, v) => s.setItem(k, v), remove: k => s.removeItem(k) },
      })
    : Promise.reject(new OwSignInError('state_mismatch', 'no session storage'));
  try { history.replaceState(null, '', `/${resume.hash}`); } catch { /* the address stays; the router still runs */ }
  return pending.then(
    (r): SignInOutcome => ({ ok: true, token: r.token, tokenId: r.tokenId ?? null, username: r.account.username, resume }),
    (error: unknown): SignInOutcome => ({ ok: false, cancelled, error, resume, started }),
  );
}

/** What to tell the person when the round trip did not sign them in. Never keel's text (conv. 125). */
export function signInCallbackLine(outcome: { cancelled: boolean; error: unknown }): string {
  if (outcome.cancelled) return 'Sign in with OnlyWorlds was cancelled. Nothing changed.';
  const err = outcome.error;
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'state_mismatch': return 'That sign-in was not started in this tab, so Atlas did not finish it. Press Sign in with OnlyWorlds again.';
      case 'invalid_grant': return 'OnlyWorlds did not take that sign-in: it may have waited too long. Press Sign in with OnlyWorlds again.';
      case 'rate_limited': return 'Too many sign-ins in a short time. Wait a moment and try again.';
      case 'offline': return CANNOT_REACH_LINE;
      default: break;
    }
  }
  return 'Signing in with OnlyWorlds did not work. Try again in a moment.';
}
