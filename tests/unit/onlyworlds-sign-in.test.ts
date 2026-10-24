/**
 * Sign in with OnlyWorlds, the tool's half (S465; contract
 * `Forge/Notes/2026-10-24-s465-sign-in-with-onlyworlds-contract.md`): the
 * origin rule (R1), the exchange through the real SDK with fetch stubbed
 * (R3), the resume read back by shape (R5) and the refusal lines (R7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OwSignInError } from '@onlyworlds/sdk';
import {
  SIGN_IN_REDIRECT_URI, SIGN_IN_RESUME_KEY, beginOnlyWorldsSignIn, canSignInWithOnlyWorlds,
  isSignInCallback, readResume, signInCallbackLine, startSignInCallback,
} from '../../src/sync/onlyworlds-sign-in';

const WORLD = '0192a000-aaaa-7bbb-8ccc-000000000465';
const JOIN = 'ow_j_abcdefghijklmnop0123';

describe('where the button is offered (R1)', () => {
  it('only on the registered origin', () => {
    expect(canSignInWithOnlyWorlds('https://atlas.onlyworlds.com')).toBe(true);
    expect(canSignInWithOnlyWorlds('https://c2ea35f2.atlas-8o5.pages.dev')).toBe(false);
    expect(canSignInWithOnlyWorlds('http://localhost:3045')).toBe(false);
    expect(canSignInWithOnlyWorlds('http://atlas.onlyworlds.com')).toBe(false);
  });
  it('the callback path, with or without its slash', () => {
    expect(isSignInCallback('/signin/callback')).toBe(true);
    expect(isSignInCallback('/signin/callback/')).toBe(true);
    expect(isSignInCallback('/')).toBe(false);
    expect(isSignInCallback('/signin')).toBe(false);
  });
});

describe('the resume read back (R5)', () => {
  it('keeps each part of the right shape', () => {
    expect(readResume(JSON.stringify({ hash: `#/w/${WORLD}/writing`, door: 'make-online', open: WORLD, join: JOIN })))
      .toEqual({ hash: `#/w/${WORLD}/writing`, door: 'make-online', open: WORLD, join: JOIN });
  });
  it('drops each part of the wrong shape, never guessing', () => {
    expect(readResume(JSON.stringify({ hash: 'javascript:alert(1)', door: 'settings', open: 'not-an-id', join: 'ow_x_nope' }))).toEqual({ hash: '#/' });
    expect(readResume(JSON.stringify({ hash: `#/${'a'.repeat(3000)}` })).hash).toBe('#/');
    expect(readResume(JSON.stringify({ hash: '#/w/x" onclick="y' })).hash).toBe('#/');
    expect(readResume(JSON.stringify({ hash: '#/w/a b' })).hash).toBe('#/');
  });
  it('anything that is not one object lands on #/', () => {
    for (const raw of [null, '', '{nope', '[]', '"#/w/x"', '42']) expect(readResume(raw)).toEqual({ hash: '#/' });
  });
});

describe('the round trip through the SDK (R3)', () => {
  const home = location.href;
  let sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  beforeEach(() => {
    sessionStorage.clear();
    sent = [];
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, '', home);
    sessionStorage.clear();
  });

  /** Press the button (navigation captured), then come back with this query. */
  async function pressAndReturn(query: (state: string) => string, answer: Response | (() => Promise<Response>)): Promise<ReturnType<typeof startSignInCallback>> {
    let to = '';
    await beginOnlyWorldsSignIn({ hash: `#/w/${WORLD}/writing`, door: 'new-api', join: JOIN }, (u) => { to = u; });
    const authorize = new URL(to);
    expect(authorize.origin + authorize.pathname).toBe('https://www.onlyworlds.com/signin/authorize');
    expect(authorize.searchParams.get('client_id')).toBe('atlas');
    expect(authorize.searchParams.get('redirect_uri')).toBe(SIGN_IN_REDIRECT_URI);
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return typeof answer === 'function' ? answer() : answer;
    }));
    return startSignInCallback(`${SIGN_IN_REDIRECT_URI}?${query(authorize.searchParams.get('state')!)}`);
  }

  it('signed in: the token, the account and Atlas\'s resume; the address is / and the route; nothing left in the tab', async () => {
    const outcome = await pressAndReturn(s => `code=c0de&state=${s}`,
      new Response(JSON.stringify({ token: 'ow_a_minted', token_type: 'bearer', account: { id: 'acc', username: 'wren' } }), { status: 200 }));
    expect(outcome).toEqual({ ok: true, token: 'ow_a_minted', username: 'wren', resume: { hash: `#/w/${WORLD}/writing`, door: 'new-api', join: JOIN } });
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe('https://www.onlyworlds.com/api/v2/auth/token');
    expect(sent[0].body).toMatchObject({ grant_type: 'authorization_code', code: 'c0de', client_id: 'atlas', redirect_uri: SIGN_IN_REDIRECT_URI });
    expect(location.pathname + location.search + location.hash).toBe(`/#/w/${WORLD}/writing`);
    expect(sessionStorage.length).toBe(0);
  });

  it('the address is swapped before the exchange answers, so the router reads the resumed route', async () => {
    let release!: (r: Response) => void;
    const answered = new Promise<Response>(r => { release = r; });
    const pending = pressAndReturn(s => `code=c0de&state=${s}`, () => answered);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(location.pathname + location.search).toBe('/');
    expect(location.hash).toBe(`#/w/${WORLD}/writing`);
    release(new Response(JSON.stringify({ token: 'ow_a_t', account: { id: 'a', username: 'u' } }), { status: 200 }));
    expect((await (await pending)).ok).toBe(true);
  });

  it('cancelled on onlyworlds.com: nothing sent, said as a cancel, back where the person was', async () => {
    const outcome = await pressAndReturn(s => `error=access_denied&state=${s}`, new Response('{}', { status: 500 }));
    expect(sent).toHaveLength(0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.cancelled).toBe(true);
    expect(outcome.resume.hash).toBe(`#/w/${WORLD}/writing`);
    expect(signInCallbackLine(outcome)).toMatch(/cancelled/);
    expect(sessionStorage.length).toBe(0);
  });

  it('a used or expired code: keel\'s invalid_grant, worded by Atlas', async () => {
    const outcome = await pressAndReturn(s => `code=old&state=${s}`,
      new Response(JSON.stringify({ error: { type: 'invalid_request_error', code: 'invalid_grant', message: 'raw keel text' } }), { status: 400 }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect((outcome.error as OwSignInError).reason).toBe('invalid_grant');
    expect(signInCallbackLine(outcome)).not.toContain('raw keel text');
  });

  it('a state this tab did not start: refused before anything is sent', async () => {
    const outcome = await pressAndReturn(() => 'code=c0de&state=forged', new Response('{}', { status: 200 }));
    expect(sent).toHaveLength(0);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect((outcome.error as OwSignInError).reason).toBe('state_mismatch');
    expect(outcome.cancelled).toBe(false);
  });
});

describe('the refusal lines (R7)', () => {
  it('each reason has its own sentence, none of them keel\'s', () => {
    const line = (reason: ConstructorParameters<typeof OwSignInError>[0]) =>
      signInCallbackLine({ cancelled: false, error: new OwSignInError(reason, 'keel text') });
    const lines = (['state_mismatch', 'invalid_grant', 'rate_limited', 'offline', 'failed'] as const).map(line);
    expect(new Set(lines).size).toBe(5);
    for (const l of lines) expect(l).not.toContain('keel text');
    expect(signInCallbackLine({ cancelled: false, error: new Error('boom') })).toBe(line('failed'));
  });
});
