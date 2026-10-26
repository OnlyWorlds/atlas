/**
 * Take back an account token Atlas minted, when Atlas lets it go (a
 * contract of 2026-10-25):
 * `DELETE /account/tokens/{id}` by the id recorded at the mint, with the token
 * itself as the bearer (keel asks no PIN here). Never a lookup by last four or
 * name: a delete runs only on an id Atlas made and recorded.
 *
 * keel's answers (probed on a crew account, and read in its source):
 * 204 revoked; 401 the token works no more (revoked already); 404 the
 * bearer works and the id is not its account's, so the token is still LIVE.
 * Revoking a token minted by Sign in with OnlyWorlds ends the
 * person's consent for Atlas only when it was Atlas's last live token for them.
 *
 * This never writes the registry: the caller has already
 * let the token go, and a later sign-in must not be undone by an old answer.
 */

import { DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import { isTokenId, mintedTokenId } from '../registry/registry';
import type { WorldsRegistry } from '../core/types';

/** Said when a sign-in elsewhere replaced the token a step began with: the step stops, nothing refused. */
export const SIGNED_IN_AGAIN_LINE = 'You signed in again since this started, so Atlas stopped here. Try once more.';

/**
 * A sign-in that replaces a token Atlas minted lets the old one go: revoked by
 * the id recorded beside it, after the new token is kept (2026-10-26). keel
 * keeps a tool's consent while another of its tokens for the person lives, so
 * a sign-in by the same door asks nothing more next time; a move to the
 * password door or to another account can end the old one's consent, which is
 * what letting it go means. A pasted token, the same token kept again, or no
 * token before: nothing is sent. Best effort: nothing waits on the answer.
 */
export function revokeReplacedToken(before: WorldsRegistry, after: WorldsRegistry, revoke: typeof revokeAtlasToken = revokeAtlasToken): void {
  const id = mintedTokenId(before);
  const old = before.account_token;
  if (!id || !old || old === after.account_token) return;
  void revoke(old, id);
}

/** How long a revoke may take: it is best effort, and nothing waits on it longer. */
export const TOKEN_REVOKE_LIMIT_MS = 8_000;

/** 'revoked': the token works no more. 'kept': it may still work (no answer, a refusal, or a 404). */
export type RevokeOutcome = 'revoked' | 'kept';

export async function revokeAtlasToken(
  token: string,
  tokenId: string,
  deps: { fetch?: typeof fetch; base?: string; limitMs?: number } = {},
): Promise<RevokeOutcome> {
  if (!token || !isTokenId(tokenId)) return 'kept';
  const base = (deps.base ?? devV2Base() ?? DEFAULT_V2_BASE).replace(/\/$/, '');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), deps.limitMs ?? TOKEN_REVOKE_LIMIT_MS);
  const send = (keepalive: boolean) => (deps.fetch ?? fetch)(`${base}/account/tokens/${encodeURIComponent(tokenId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    // A tab closed right after Forget still sends it.
    keepalive,
    signal: ctl.signal,
  });
  try {
    let res: Response;
    try {
      res = await send(true);
    } catch (err) {
      // A browser may refuse a keepalive request that needs a preflight: once more without it,
      // unless the time limit already ended it.
      if (ctl.signal.aborted) throw err;
      res = await send(false);
    }
    if (res.ok || res.status === 401) return 'revoked';
    if (res.status === 404) console.error('[token-revoke] keel does not know this id for this token: the token may still work');
    else console.warn(`[token-revoke] not revoked (${res.status})`);
    return 'kept';
  } catch (err) {
    console.warn('[token-revoke] not revoked (no answer):', err);
    return 'kept';
  } finally {
    clearTimeout(timer);
  }
}
