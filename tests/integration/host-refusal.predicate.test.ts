/**
 * The web host's refusal of a write (R1, R2): a 403 whose body is not keel's
 * (the host's HTML "Blocked" page, answered before keel sees the request) is
 * one write refused, never a dead key and never a busy server. keel's own
 * 403s, its 401s and 429s keep their readings.
 *
 * Every adapter case runs the REAL OwV2ClientAdapter against an MSW answer,
 * so the shape the predicate reads is the one the adapter builds.
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { OwApiError } from '@onlyworlds/sdk';
import { mswServer } from '../setup';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { isAuthError, isHostBlocked, isHostRefusal, isTransientError } from '../../src/sync/sync-engine';
import { isHostBlockedPage } from '../../src/sync/host-blocked-page';
import { classifyError } from '../../src/core/problems';

const BASE = 'https://test-ow.local/api/v2';
const adapter = (): OwV2ClientAdapter => new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: BASE });

const BLOCKED_PAGE = '<!DOCTYPE html><html lang="en-US"><head><title>Blocked</title></head><body>Sorry, you have been blocked</body></html>';
/** A host page that is not the Blocked one: the wide tier only. */
const OTHER_PAGE = '<!DOCTYPE html><html><head><title>Access denied</title></head><body>Forbidden</body></html>';
const html403 = () => new HttpResponse(BLOCKED_PAGE, { status: 403, headers: { 'Content-Type': 'text/html; charset=UTF-8' } });
const keel = (status: number, error: Record<string, unknown>, headers: Record<string, string> = {}) =>
  HttpResponse.json({ error }, { status, headers });

/** Every route the adapter writes or reads here answers the same. */
function answerAll(resolve: () => Response): void {
  mswServer.use(
    http.all(`${BASE}/*`, () => resolve()),
  );
}

async function thrown(p: Promise<unknown>): Promise<unknown> {
  try { await p; } catch (err) { return err; }
  throw new Error('expected a refusal');
}

const ID = '019a0000-0000-7000-8000-000000000001';

describe('isHostRefusal: the host\'s page on a write', () => {
  it('an element PATCH, a create, a bulk and a settings PATCH answered with the HTML page are host refusals, never auth or transient', async () => {
    answerAll(html403);
    const a = adapter();
    const errs = [
      await thrown(a.updateElement('character', ID, { name: 'run `python -m http.server`' })),
      await thrown(a.createElement('character', { id: ID, name: 'x' })),
      await thrown(a.bulkCreate([{ type: 'character', element: { id: ID, name: 'x' } }], { atomic: true, idempotencyKey: 'k' })),
      await thrown(a.patchWorldMeta({ description: 'run `python -m http.server`' })),
    ];
    for (const err of errs) {
      expect(isHostRefusal(err)).toBe(true);
      expect(isAuthError(err)).toBe(false);
      expect(isTransientError(err)).toBe(false);
      // Through problems too: a refusal by the server, never "sign in again".
      expect(classifyError(err)).toBe('server-refused');
    }
  });

  it('a read or a delete answered with the same page keeps today\'s reading (no body to refuse)', async () => {
    answerAll(html403);
    const a = adapter();
    const errs = [
      await thrown(a.getWorldMeta()),
      await thrown(a.deleteElement('character', ID)),
    ];
    for (const err of errs) {
      expect(isHostRefusal(err)).toBe(false);
      expect(isHostBlocked(err)).toBe(false); // the Blocked page on a read is neither tier
      expect(isAuthError(err)).toBe(true);
    }
  });
});

describe('isHostRefusal: keel\'s own answers on the same write keep their readings', () => {
  const write = (a: OwV2ClientAdapter) => a.updateElement('character', ID, { name: 'x' });

  it('keel\'s coded 403s: member and mark refusals stay per element, key refusals stay auth', async () => {
    const readings: Array<[string, boolean]> = [
      ['not_author', false], ['owner_only', false], ['keeper_only', false], ['review_by_another', false],
      ['hidden_not_allowed', false], ['permission_error', true], ['invalid_credentials', true], ['key_revoked', true],
    ];
    for (const [code, auth] of readings) {
      answerAll(() => keel(403, { type: 'permission_error', code, message: 'refused' }));
      const err = await thrown(write(adapter()));
      expect(isHostRefusal(err), code).toBe(false);
      expect(isAuthError(err), code).toBe(auth);
      expect(isTransientError(err), code).toBe(false);
    }
  });

  it('keel\'s 403 with an envelope and no code is still read as auth', async () => {
    answerAll(() => keel(403, { message: 'Forbidden.' }));
    const err = await thrown(write(adapter()));
    expect(isHostRefusal(err)).toBe(false);
    expect(isAuthError(err)).toBe(true);
  });

  it('a 401, enveloped or the host\'s page, is auth', async () => {
    answerAll(() => keel(401, { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null }));
    const enveloped = await thrown(write(adapter()));
    expect(isHostRefusal(enveloped)).toBe(false);
    expect(isAuthError(enveloped)).toBe(true);
    answerAll(() => new HttpResponse(BLOCKED_PAGE, { status: 401, headers: { 'Content-Type': 'text/html' } }));
    const page = await thrown(write(adapter()));
    expect(isHostRefusal(page)).toBe(false);
    expect(isAuthError(page)).toBe(true);
  });

  it('a 429 stays transient', async () => {
    answerAll(() => keel(429, { type: 'rate_limited', code: 'too_many_requests', message: 'Too many requests.' }, { 'Retry-After': '9' }));
    const err = await thrown(write(adapter()));
    expect(isHostRefusal(err)).toBe(false);
    expect(isAuthError(err)).toBe(false);
    expect(isTransientError(err)).toBe(true);
  });
});

describe('two tiers: any 403 without keel\'s envelope (wide), the "Blocked" page (narrow)', () => {
  it('isHostBlockedPage: a 403, no JSON object or list, a title saying Blocked', () => {
    expect(isHostBlockedPage(403, BLOCKED_PAGE)).toBe(true);
    expect(isHostBlockedPage(403, '<html><head><title>Blocked</title></head></html>')).toBe(true);
    expect(isHostBlockedPage(401, BLOCKED_PAGE)).toBe(false);
    expect(isHostBlockedPage(403, OTHER_PAGE)).toBe(false);
    expect(isHostBlockedPage(403, 'Sorry, you have been blocked')).toBe(false); // no title
    expect(isHostBlockedPage(403, JSON.stringify({ error: { message: '<title>Blocked</title>' } }))).toBe(false);
    expect(isHostBlockedPage(403, JSON.stringify(['<title>Blocked</title>']))).toBe(false);
    expect(isHostBlockedPage(403, '<title>Unblocked</title>')).toBe(false);
    // The SDK's reading: the title is "Blocked" alone (spaces and case aside), not the word anywhere.
    expect(isHostBlockedPage(403, '<title> blocked\n</title>')).toBe(true);
    expect(isHostBlockedPage(403, '<title>Attention Required! | Blocked</title>')).toBe(false);
    expect(isHostBlockedPage(403, '<title>Blocked by policy</title>')).toBe(false);
  });

  it('the Blocked page on a write: both tiers; read on the whole body, past the 300 characters the error keeps', async () => {
    const longHead = `<!DOCTYPE html><html><head>${'<meta name="x" content="padding padding padding">'.repeat(12)}<title>Blocked</title></head></html>`;
    expect(longHead.indexOf('<title>')).toBeGreaterThan(300);
    for (const page of [BLOCKED_PAGE, longHead]) {
      answerAll(() => new HttpResponse(page, { status: 403, headers: { 'Content-Type': 'text/html' } }));
      const err = await thrown(adapter().updateElement('character', ID, { name: 'x' }));
      expect(isHostRefusal(err)).toBe(true);
      expect(isHostBlocked(err)).toBe(true);
    }
  });

  it('another non-JSON 403 on a write (no Blocked title, or no body): the wide tier only, still never auth or transient', async () => {
    for (const make of [
      () => new HttpResponse(OTHER_PAGE, { status: 403, headers: { 'Content-Type': 'text/html' } }),
      () => new HttpResponse('', { status: 403 }),
    ]) {
      answerAll(make);
      const err = await thrown(adapter().updateElement('character', ID, { name: 'x' }));
      expect(isHostRefusal(err)).toBe(true);
      expect(isHostBlocked(err)).toBe(false);
      expect(isAuthError(err)).toBe(false);
      expect(isTransientError(err)).toBe(false);
    }
  });

  it('keel\'s enveloped 403s are neither tier', async () => {
    for (const error of [{ code: 'permission_error', message: 'read key' }, { message: 'Forbidden.' }, { code: 'not_author', message: '<title>Blocked</title>' }]) {
      answerAll(() => keel(403, error));
      const err = await thrown(adapter().updateElement('character', ID, { name: 'x' }));
      expect(isHostRefusal(err)).toBe(false);
      expect(isHostBlocked(err)).toBe(false);
    }
  });

  it('the SDK\'s error: its own isHostBlocked is the narrow tier; a 403 page without that title is the wide one', () => {
    const blocked = new OwApiError(403, null, 'refused', null, '<html><head><title>Blocked</title></head></html>');
    expect(blocked.isHostBlocked).toBe(true);
    expect(isHostRefusal(blocked)).toBe(true);
    expect(isHostBlocked(blocked)).toBe(true);
    const other = new OwApiError(403, null, 'OnlyWorlds API error 403', null, OTHER_PAGE);
    expect(isHostRefusal(other)).toBe(true);
    expect(isHostBlocked(other)).toBe(false);
  });

  it('the bare message form: the page in the message is the narrow tier', () => {
    expect(isHostBlocked(new Error(`API Error 403: ${BLOCKED_PAGE}`))).toBe(true);
    expect(isHostBlocked(new Error(`API Error 403: ${OTHER_PAGE}`))).toBe(false);
    expect(isHostRefusal(new Error(`API Error 403: ${OTHER_PAGE}`))).toBe(true);
  });
});

describe('isHostRefusal: the SDK\'s error and the legacy message form', () => {
  it('the SDK\'s OwApiError: a 403 with no code and a text body is one; a coded or JSON one is not', () => {
    const sdkPage = new OwApiError(403, null, 'OnlyWorlds API error 403', null, BLOCKED_PAGE);
    expect(isHostRefusal(sdkPage)).toBe(true);
    expect(isAuthError(sdkPage)).toBe(false);
    expect(isTransientError(sdkPage)).toBe(false);
    const sdkCoded = new OwApiError(403, 'not_author', 'not yours', null, { error: { code: 'not_author' } });
    expect(isHostRefusal(sdkCoded)).toBe(false);
    const sdkJson = new OwApiError(403, null, 'Forbidden.', null, { detail: 'Forbidden.' });
    expect(isHostRefusal(sdkJson)).toBe(false);
    expect(isAuthError(sdkJson)).toBe(true);
    const sdk401 = new OwApiError(401, null, 'OnlyWorlds API error 401', null, BLOCKED_PAGE);
    expect(isHostRefusal(sdk401)).toBe(false);
  });

  it('the bare message "API Error 403: <html…" never reaches the 403 substring arm; a bare "API Error 403: Forbidden" still does', () => {
    const page = new Error(`API Error 403: ${BLOCKED_PAGE}`);
    expect(isHostRefusal(page)).toBe(true);
    expect(isAuthError(page)).toBe(false);
    expect(isTransientError(page)).toBe(false);
    const plain = new Error('API Error 403: Forbidden');
    expect(isHostRefusal(plain)).toBe(false);
    expect(isAuthError(plain)).toBe(true);
    expect(isHostRefusal(new Error(`API Error 401: ${BLOCKED_PAGE}`))).toBe(false);
    expect(isHostRefusal('API Error 403: <html>')).toBe(false);
  });
});
