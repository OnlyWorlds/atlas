/**
 * The web host's refusal at the doors beside sync (conv. 191): publishing a
 * page (its whole text goes up in one write) and adding a file (the ticket
 * carries its name and label). A 403 with no JSON body on a write is the
 * host's, never the key's; its page titled "Blocked" says the usual cause.
 * keel's own 403s keep their words. Also: a change held for a create the
 * host refused names the host, and Atlas's page test reads as the SDK's.
 */
import { describe, it, expect } from 'vitest';
import { OwApiError } from '@onlyworlds/sdk';
import { SharingClient, SharingApiError, sharingErrorMessage } from '../../src/sync/sharing-client';
import { addRefusal } from '../../src/sync/element-files';
import { syncIssueLine } from '../../src/middle/settings-world';
import { HOST_HELD_MESSAGE } from '../../src/sync/sync-engine';
import { isHostBlockedPage } from '../../src/sync/host-blocked-page';

const BLOCKED = '<!DOCTYPE html><html><head><title>Blocked</title></head><body>Sorry, you have been blocked</body></html>';
const OTHER = '<!DOCTYPE html><html><head><title>Access denied</title></head><body>Forbidden</body></html>';
const NEVER = /\bkey\b|\bPIN\b|Settings|sign in|signing in/i;
const CAUSE = /A command written between code marks, such as `python -m`, is the usual cause: write it without the marks, or in a code block that names its language, and it publishes\./;

function client(status: number, body: string, contentType = 'text/html'): SharingClient {
  return new SharingClient({
    baseUrl: 'https://test.local/api/sharing', apiKey: 'k', pin: '1234',
    fetchFn: async () => new Response(body, { status, headers: { 'Content-Type': contentType } }),
  });
}

async function refusal(p: Promise<unknown>): Promise<SharingApiError> {
  try { await p; } catch (err) { if (err instanceof SharingApiError) return err; throw err; }
  throw new Error('expected a refusal');
}

const page = { slug: 'my-page', title: 'Notes', intent: 'page', payload: { blocks: [] } };

describe('publishing a page the host refuses', () => {
  it('the Blocked page: the host refused the page, the usual cause, nothing lost; never the key', async () => {
    for (const p of [client(403, BLOCKED).publish(page), client(403, BLOCKED).republish('my-page', { title: 'x' })]) {
      const err = await refusal(p);
      expect(err.code).toBe('host_blocked');
      const line = sharingErrorMessage(err);
      expect(line).toMatch(/^The web host in front of OnlyWorlds refused this page before it reached OnlyWorlds\./);
      expect(line).toMatch(CAUSE);
      expect(line).toMatch(/Nothing was lost: the page is still here\.$/);
      expect(line).not.toMatch(NEVER);
      expect(line).not.toContain('—');
    }
  });

  it('another non-JSON 403 (or none): the host refused it, nothing lost, no guess at a cause', async () => {
    for (const body of [OTHER, '']) {
      const err = await refusal(client(403, body).publish(page));
      expect(err.code).toBe('host_refused');
      expect(sharingErrorMessage(err)).toBe('The web host in front of OnlyWorlds refused this page before it reached OnlyWorlds. Nothing was lost: the page is still here.');
    }
  });

  it('keel\'s own 403s keep their words; a read answered with the page stays forbidden', async () => {
    expect((await refusal(client(403, JSON.stringify({ error: { code: 'forbidden' } }), 'application/json').publish(page))).code).toBe('forbidden');
    expect((await refusal(client(403, JSON.stringify({ error: { code: 'owner_only' } }), 'application/json').publish(page))).code).toBe('owner_only');
    expect((await refusal(client(403, JSON.stringify({ detail: 'You do not have permission.' }), 'application/json').publish(page))).code).toBe('forbidden');
    expect((await refusal(client(403, BLOCKED).listForWorld('w'))).code).toBe('forbidden');
    expect((await refusal(client(401, BLOCKED).publish(page))).code).toBe('auth_failed');
  });
});

describe('adding a file the host refuses', () => {
  const sdk = (status: number, code: string | null, detail: unknown) => new OwApiError(status, code, 'refused', null, detail);

  it('the Blocked page names the name or label; another page says only the host; neither the key', () => {
    const blocked = addRefusal(sdk(403, null, BLOCKED), { size: 1 });
    expect(blocked).toBe('The web host in front of OnlyWorlds refused this file before it reached OnlyWorlds. A command between code marks in its name or label, such as `python -m`, is the usual cause: write it without the marks, and add the file again. Nothing was added.');
    const other = addRefusal(sdk(403, null, OTHER), { size: 1 });
    expect(other).toBe('The web host in front of OnlyWorlds refused this file before it reached OnlyWorlds. Nothing was added.');
    for (const line of [blocked, other]) expect(line).not.toMatch(NEVER);
  });

  it('keel\'s own 403s keep their words', () => {
    expect(addRefusal(sdk(403, 'not_author', { error: { code: 'not_author' } }), { size: 1 })).toMatch(/only to elements you made/);
    expect(addRefusal(sdk(403, null, { detail: 'Forbidden.' }), { size: 1 })).toBe('This world\'s key may not add files to this element.');
  });
});

describe('a change held for a create the host refused', () => {
  it('names the web host in its Not syncing row; one held for keel\'s refusal keeps its words', () => {
    const row = (message: string) => syncIssueLine({ kind: 'other', type: 'character', operation: 'create',
      failure: { element_id: 'a', type: 'character', operation: 'create', message } } as never, 'folder');
    expect(row(HOST_HELD_MESSAGE)).toBe('It links to an element the web host in front of OnlyWorlds refused, so it waits for that one.');
    expect(row('waits for an element OnlyWorlds refused in the same upload')).toBe('It links to an element OnlyWorlds refused, so it waits for that one.');
  });
});

describe('Atlas\'s page test reads as the SDK\'s', () => {
  it('agrees with OwApiError.isHostBlocked on every text body', () => {
    const bodies = [BLOCKED, OTHER, '<title>Blocked</title>', '<TITLE lang="en"> blocked </TITLE>', '<title>Attention Required! | Blocked</title>',
      '<title>Blocked by policy</title>', 'Blocked', '', '<title></title>'];
    for (const body of bodies) {
      expect(isHostBlockedPage(403, body), body).toBe(new OwApiError(403, null, 'x', null, body).isHostBlocked);
      expect(isHostBlockedPage(401, body), body).toBe(new OwApiError(401, null, 'x', null, body).isHostBlocked);
    }
  });
});

describe('a 429 on a page, by keel\'s param (1.124.35)', () => {
  const json = (param: string | null) => JSON.stringify({ error: { code: 'rate_limited', detail: 'Too many requests.', param } });
  it('keel\'s PIN wall says the wall and the PIN to check; any other 429 says the wait, never the PIN', async () => {
    const wall = await refusal(client(429, json('API-Pin'), 'application/json').publish(page));
    expect(wall.code).toBe('rate_limited');
    expect(wall.param).toBe('API-Pin');
    // An account world's page: the World PIN to check (a seat's, and a world not known, are in seat-credential-words).
    expect(sharingErrorMessage(wall, 'account')).toBe("OnlyWorlds refused too many different PINs for this world's key, so it takes none for a while. Nothing changed. Check the World PIN in Settings, then try again later.");
    const other = await refusal(client(429, json(null), 'application/json').publish(page));
    expect(sharingErrorMessage(other)).toBe('OnlyWorlds asked Atlas to wait. Nothing changed; wait a bit and try again.');
    // A 429 with no envelope at all is a wait too.
    expect(sharingErrorMessage(await refusal(client(429, '').publish(page)))).toBe('OnlyWorlds asked Atlas to wait. Nothing changed; wait a bit and try again.');
  });
});
