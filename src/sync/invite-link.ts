/**
 * Invite links made in Atlas (#341, the night floor's B10, h58 #5524; as
 * Lantern makes them since the Captain's yes, h56 #5322). keel makes a link
 * for the world's owner only (keel C1, `POST /account/worlds/{id}/links`),
 * through the SDK's `createWorldLink` with the account token. The link is
 * shown once: keel keeps only a hash, and Atlas keeps nothing. Seeing and
 * taking back links stays on the website's Access pane.
 *
 * Lantern's half: `tools/lantern/src/invite.ts`. The choices and words match.
 */

import { OwApiError, OwNetworkError, OwV2Client } from '@onlyworlds/sdk';
import { DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import { PlainError } from '../core/plain-error';

export type InviteRole = 'contributor' | 'guest';

/** How long a link works, said where it is made (keel's default; the SDK takes 1, 7 or 30). */
export const INVITE_DAYS = 7;

export interface MadeInvite {
  /** The link alone (keel's /join page with the code after `#`). */
  link: string;
  /** keel's one line to send: who invites, to which world, and the link. */
  line: string;
}

export const INVITE_NOT_OWNER_LINE = 'Only the world\'s owner can make an invite link for it, signed in with their own account.';

export const INVITE_CAP_LINE = 'This world has as many open invites as it can hold, links not yet used included. Take some back on its page on onlyworlds.com, under Access, then make a new one.';

/** A new invite link for a person, made by the signed-in owner. Nothing about it is kept. */
export async function makeInvite(
  token: string,
  worldId: string,
  role: InviteRole,
  inviterName: string,
): Promise<MadeInvite> {
  const name = inviterName.trim();
  const client = new OwV2Client({ apiKey: token, baseUrl: devV2Base() ?? DEFAULT_V2_BASE });
  try {
    const made = await client.createWorldLink(worldId, {
      reader: 'person',
      role,
      days: INVITE_DAYS,
      ...(name ? { inviterName: name } : {}),
    });
    return { link: made.link, line: made.line };
  } catch (err) {
    // Every refusal is worded here, never read out (conv. 125).
    if (err instanceof OwNetworkError) throw new PlainError('Atlas could not reach OnlyWorlds, so no link was made. Check the connection and try again.');
    if (err instanceof OwApiError) {
      if (err.isNotFound) throw new PlainError(INVITE_NOT_OWNER_LINE);
      if (err.isAuthError) throw new PlainError('OnlyWorlds no longer takes this browser\'s sign-in. Sign in again in Settings, OnlyWorlds.');
      // keel's cap on a world's open invites (50, links not yet used counted:
      // keel accounts/agents.py, MAX_PENDING_INVITES) is a 422 naming no field;
      // a retry never helps (the S414 gate's M1).
      if (err.status === 422 && !err.param) throw new PlainError(INVITE_CAP_LINE);
    }
    throw new PlainError('The link was not made. Try again in a moment.');
  }
}
