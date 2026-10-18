/**
 * Sign in with an OnlyWorlds email (or username) and password (#387, the
 * journey's A8: a stranger was sent to onlyworlds.com to make a token and
 * paste it back). The SDK's `signInWithPassword` (4.31, Kael h17 #6818) logs
 * in through keel's app client, mints this browser its own account token
 * named for it (revocable on the site's Account tokens), and ends the
 * session. Only the token is kept, exactly as a pasted one is; the password
 * is never stored.
 */

import { OwV2Client, OwSignInError } from '@onlyworlds/sdk';
import { devV2Base } from './dev-api-base';
import { DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { CANNOT_REACH_LINE } from '../setup/key-check-errors';

/** The token's name on the site's Account tokens page: which browser holds it. */
export function tokenNameForThisBrowser(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'a browser';
  return `Atlas in ${browser}`;
}

/** What to tell the user for each refusal. Never keel's raw text. */
export function passwordSignInLine(err: unknown): string {
  if (err instanceof OwSignInError) {
    switch (err.reason) {
      case 'invalid_credentials': return 'That email or username and password did not match an OnlyWorlds account.';
      case 'email_unverified': return 'Confirm your email first: the link is in the mail onlyworlds.com sent you.';
      case 'rate_limited': return 'Too many attempts. Wait a moment and try again.';
      case 'offline': return CANNOT_REACH_LINE;
      default: return 'Signing in did not work. Try again in a moment.';
    }
  }
  return 'Signing in did not work. Try again in a moment.';
}

/** The account token for these credentials. A refusal is the SDK's OwSignInError: word it with passwordSignInLine. */
export async function signInWithPassword(login: string, password: string): Promise<string> {
  const id = login.trim();
  const client = new OwV2Client({ baseUrl: devV2Base() ?? DEFAULT_V2_BASE });
  const signed = await client.signInWithPassword({
    ...(id.includes('@') ? { email: id } : { username: id }),
    password,
    tokenName: tokenNameForThisBrowser(),
  });
  return signed.token;
}
