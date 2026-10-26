/**
 * keel's PIN rule in Atlas's own client (1.79.0; Skeld 2026-10-22;
 * the PIN-on-writes contract): the
 * secret on every write, on GET /me, and on every call of a ten-digit key; a
 * prefixed key's other reads bare. The link doors ask /me for the PIN.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { OwV2ClientAdapter, sendsPin } from '../../src/sync/ow-v2-client-adapter';
import { keyCheckError } from '../../src/setup/key-check-errors';

const BASE = 'https://test-ow.local/api/v2';
let seen: Array<{ call: string; pin: string | null }>;

beforeEach(() => {
  seen = [];
  mswServer.use(http.all(`${BASE}/*`, ({ request }) => {
    const url = new URL(request.url);
    const call = `${request.method} ${url.pathname.replace('/api/v2', '')}`;
    seen.push({ call, pin: request.headers.get('API-Pin') });
    if (request.method === 'DELETE') return new HttpResponse(null, { status: 204 });
    if (url.pathname.endsWith('/me')) return HttpResponse.json({ role: 'owner' });
    if (url.pathname.endsWith('/world')) return HttpResponse.json({ id: 'w-1', name: 'Here' });
    return HttpResponse.json({ id: 'c-1', type: 'character', name: 'Ada', updated_at: '2026-10-22T19:00:00Z' });
  }));
});

async function everyKind(apiKey: string, apiPin: string) {
  const a = new OwV2ClientAdapter({ apiKey, apiPin, baseUrl: BASE });
  await a.getWorld();
  await a.me();
  await a.getElement('character', 'c-1');
  await a.updateElement('character', 'c-1', { description: 'x' });
  await a.deleteElement('character', 'c-1');
  return Object.fromEntries(seen.map(s => [s.call, s.pin]));
}

describe('the header by the rule', () => {
  it('a prefixed key with a PIN: reads bare but /me, every write carries it', async () => {
    expect(await everyKind('ow_w_abc', '1234')).toEqual({
      'GET /world': null,
      'GET /me': '1234',
      'GET /character/c-1': null,
      'PATCH /character/c-1': '1234',
      'DELETE /character/c-1': '1234',
    });
  });

  it('a seat secret goes where a PIN goes', async () => {
    const pins = await everyKind('ow_w_seat', 'ow_s_secret');
    expect(pins['GET /world']).toBeNull();
    expect(pins['GET /me']).toBe('ow_s_secret');
    expect(pins['PATCH /character/c-1']).toBe('ow_s_secret');
  });

  it('a legacy ten-digit key sends it on every call', async () => {
    expect(Object.values(await everyKind('4815162342', '1234')).every(p => p === '1234')).toBe(true);
  });

  it('no PIN, no header', async () => {
    expect(Object.values(await everyKind('ow_r_abc', '')).every(p => p === null)).toBe(true);
  });

  it('sendsPin, the sentence', () => {
    expect(sendsPin('GET', '/changes', 'ow_w_x')).toBe(false);
    expect(sendsPin('GET', '/me', 'ow_w_x')).toBe(true);
    expect(sendsPin('POST', '/bulk', 'ow_w_x')).toBe(true);
    expect(sendsPin('GET', '/changes', '0123456789')).toBe(true);
    expect(sendsPin('GET', '/changes', '01234567890')).toBe(false);
  });
});

describe('a door asks /me for the PIN', () => {
  it('checkPin asks /me with the PIN, and a refusal there reads as the PIN', async () => {
    mswServer.use(http.get(`${BASE}/me`, ({ request }) => {
      seen.push({ call: 'GET /me', pin: request.headers.get('API-Pin') });
      return HttpResponse.json({ error: { type: 'authentication_error', code: 'invalid_credentials', message: 'Incorrect PIN.', param: 'API-Pin' } }, { status: 401 });
    }));
    const a = new OwV2ClientAdapter({ apiKey: 'ow_w_abc', apiPin: '9999', baseUrl: BASE });
    await expect(a.getWorld()).resolves.toMatchObject({ id: 'w-1' });
    const err = await a.checkPin().then(() => null, e => e);
    expect(seen.find(s => s.call === 'GET /me')?.pin).toBe('9999');
    expect(String((keyCheckError(err) as Error).message)).toMatch(/did not accept that PIN/);
  });

  it('nothing to ask without a PIN, or for a ten-digit key (its /world sent it)', async () => {
    await new OwV2ClientAdapter({ apiKey: 'ow_r_abc', apiPin: '', baseUrl: BASE }).checkPin();
    await new OwV2ClientAdapter({ apiKey: '4815162342', apiPin: '1234', baseUrl: BASE }).checkPin();
    expect(seen).toEqual([]);
  });
});
