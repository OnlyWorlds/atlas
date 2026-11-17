/**
 * The web host in front of OnlyWorlds can refuse the inviter's name (a command between code
 * marks): Make the link says so in the host's words, and offers no code block for a name.
 * Before 1.124.13 it read "The link was not made. Try again in a moment.", and a retry never helps.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeInvite } from '../../src/sync/invite-link';

const BLOCKED = '<!DOCTYPE html><html><head><title>Blocked</title></head><body>Sorry, you have been blocked</body></html>';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function answer(status: number, body: string, type: string): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': type } })));
}

describe('Make the link when the web host refuses the name', () => {
  it("says the host's refusal, its cause without a code block", async () => {
    answer(403, BLOCKED, 'text/html');
    const err = await makeInvite('ow_a_TOKEN', 'w-1', 'player', 'Ada `python -m`').then(() => null, e => e as Error);
    expect(err).not.toBeNull();
    expect(err!.message).toBe('The web host in front of OnlyWorlds refused this before it reached OnlyWorlds, so Atlas could not finish making the invite link. A command written between code marks, such as `python -m`, is the usual cause: write it without the marks, then try again.');
  });

  it('any other refusal keeps the old line', async () => {
    answer(400, JSON.stringify({ error: { code: 'bad_request', message: 'no' } }), 'application/json');
    const err = await makeInvite('ow_a_TOKEN', 'w-1', 'player', 'Ada').then(() => null, e => e as Error);
    expect(err!.message).toBe('The link was not made. Try again in a moment.');
  });
});
