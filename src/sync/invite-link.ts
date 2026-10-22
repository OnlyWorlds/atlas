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
import { ATLAS_CLIENT_NAME, DEFAULT_V2_BASE } from './ow-v2-client-adapter';
import { devV2Base } from './dev-api-base';
import { PlainError } from '../core/plain-error';
import { typeNameStart } from '../core/type-words';

/**
 * Who a link is for (the sharing floor's Q1, the Captain's yes, h50 #7610):
 * `player` is keel's no-account player link (#353), a friend reading as one
 * Character; `guest` is a person's link with role guest, the same reading
 * with an account of their own; `contributor` a person's link.
 */
export type InviteFor = 'contributor' | 'player' | 'guest';

/** A player link's Character: one of the world's, by its id, or a new one named for the player. */
export const NEW_CHARACTER = 'new';

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

/** The open world's Character in its own word (names.md). */
export function inviteCharacterGoneLine(): string {
  return `That ${typeNameStart('character')} is not on OnlyWorlds yet, or no longer. Let the world sync, or pick another, then make the link.`;
}

/**
 * A new invite link, made by the signed-in owner. Nothing about it is kept.
 * `character` is for a player link only: a Character's id, or `NEW_CHARACTER`.
 */
export async function makeInvite(
  token: string,
  worldId: string,
  inviteFor: InviteFor,
  inviterName: string,
  character: string = NEW_CHARACTER,
): Promise<MadeInvite> {
  const name = inviterName.trim();
  const client = new OwV2Client({ apiKey: token, baseUrl: devV2Base() ?? DEFAULT_V2_BASE, client: ATLAS_CLIENT_NAME });
  try {
    const made = await client.createWorldLink(worldId, inviteFor === 'player'
      ? { reader: 'player', character, days: INVITE_DAYS, ...(name ? { inviterName: name } : {}) }
      : { reader: 'person', role: inviteFor, days: INVITE_DAYS, ...(name ? { inviterName: name } : {}) });
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
      // keel refuses a Character it does not hold in this world (agents.py
      // `_clean_link_character`): made here and not synced yet, or deleted there.
      if (err.status === 422 && err.param === 'character') throw new PlainError(inviteCharacterGoneLine());
    }
    throw new PlainError('The link was not made. Try again in a moment.');
  }
}
