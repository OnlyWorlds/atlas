/**
 * keel (PR 171, live 2026-10-22): every write Atlas makes names the app,
 * `X-OW-Client: atlas`, so keel's changed_client and Recent changes say
 * "through atlas". keel reads it on writes only; a read keeps the headers its
 * CORS preflight always asked for.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { globSync, readFileSync } from 'node:fs';
import { ATLAS_CLIENT_NAME, OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

const AT = '2026-10-01T00:00:00.000Z';
const seen: { method: string; client: string | null }[] = [];

function stubFetch() {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers);
    seen.push({ method: init.method ?? 'GET', client: headers.get('X-OW-Client') });
    const body = init.method === 'DELETE' ? null : JSON.stringify({ id: 'z1', type: 'character', name: 'Ada', updated_at: AT });
    return new Response(body, { status: init.method === 'DELETE' ? 204 : 200, headers: { 'Content-Type': 'application/json' } });
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  seen.length = 0;
});

describe('the client name on writes', () => {
  it('is a name keel takes: lower case, digits and hyphens, 1 to 32', () => {
    expect(ATLAS_CLIENT_NAME).toMatch(/^[a-z0-9-]{1,32}$/);
  });

  // The SDK's own writes (sign-in, files, invites, the roster) name Atlas too since SDK 4.56.0's
  // `client` option (its default is 'sdk'): a census, so a new client cannot arrive without it.
  it('every OwV2Client Atlas builds passes the name', () => {
    const files = globSync('src/**/*.ts', { cwd: process.cwd() });
    const sites: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/new OwV2Client\(/g)) {
        // The call's own parentheses, matched (an options object can hold `{ apiPin } : {})`).
        let depth = 0;
        let end = m.index! + 'new OwV2Client'.length;
        for (; end < text.length; end++) {
          if (text[end] === '(') depth++;
          else if (text[end] === ')' && --depth === 0) break;
        }
        const body = text.slice(m.index!, end + 1);
        sites.push(`${f}: ${/client: ATLAS_CLIENT_NAME/.test(body) ? 'named' : 'UNNAMED'}`);
      }
    }
    expect(sites.length).toBeGreaterThanOrEqual(5);
    expect(sites.filter(s => s.endsWith('UNNAMED'))).toEqual([]);
  });

  it('rides every write and no read', async () => {
    stubFetch();
    const a = new OwV2ClientAdapter({ apiKey: 'ow_w_' + 'k'.repeat(32), apiPin: '1234' });
    await a.getElement('character', 'z1');
    await a.createElement('character', { id: 'z1', name: 'Ada' });
    await a.updateElement('character', 'z1', { name: 'Ada' });
    await a.deleteElement('character', 'z1');
    expect(seen).toEqual([
      { method: 'GET', client: null },
      { method: 'POST', client: 'atlas' },
      { method: 'PATCH', client: 'atlas' },
      { method: 'DELETE', client: 'atlas' },
    ]);
  });
});
