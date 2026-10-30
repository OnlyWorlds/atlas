/**
 * Atlas's client reads the key's own membership from `GET /me` beside its
 * role (`OwMe.membership`: a membership id, null for the owner), so a round
 * can keep it on the registry entry.
 */
import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

const BASE = 'https://test-ow.local/api/v2';

function answering(body: Record<string, unknown>): OwV2ClientAdapter {
  mswServer.use(http.get(`${BASE}/me`, () => HttpResponse.json(body)));
  return new OwV2ClientAdapter({ apiKey: 'ow_w_abc', apiPin: '1234', baseUrl: BASE });
}

describe('GET /me, read by the client', () => {
  it('a member\'s membership id rides with the role', async () => {
    expect(await answering({ role: 'contributor', membership: 'mem-1' }).me()).toEqual({ role: 'contributor', membership: 'mem-1' });
  });

  it('the owner\'s is null', async () => {
    expect(await answering({ role: 'owner', membership: null }).me()).toEqual({ role: 'owner', membership: null });
  });

  it('a /me without it, or with something else there, gives the role alone', async () => {
    expect(await answering({ role: 'guest' }).me()).toEqual({ role: 'guest' });
    expect(await answering({ role: 'guest', membership: 7 }).me()).toEqual({ role: 'guest' });
  });
});
