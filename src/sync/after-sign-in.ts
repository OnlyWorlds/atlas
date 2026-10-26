/**
 * What every sign-in does once it holds a token and its account's name: a
 * pasted token, the email and password in Settings, or Sign in with
 * OnlyWorlds (contract R4). The token is kept, the ask to sign in is
 * answered, and what waited for it runs: a person's invitation (#294) or a
 * world page's Open in Atlas (#104), one of them, else
 * the account's worlds are offered on the first screen.
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, setAccountToken } from '../registry/registry';
import { WAITS_FOR_SIGN_IN, type ToastManager } from '../ui/toast-manager';
import { isAtlasGrounded } from '../core/grounded';
import { isTourFlagActive } from '../tour/tour-flag';
import { accountWorldsWhenFetched } from './account-worlds';
import { navigate } from '../core/router';

/**
 * Keep the token, say so, and run what waited for it. Resolves once the
 * waiting door has run. `tokenId` comes with a token Atlas minted, so
 * Forget can revoke it; a pasted token has none.
 */
export async function keepSignIn(token: string, username: string, toasts: ToastManager, tokenId?: string | null): Promise<void> {
  const next = setAccountToken(getState().registry, token, username, tokenId);
  saveRegistry(next);
  patchSlice('registry', next);
  // The ask to sign in is answered: it goes before the door's next question (Kael, 2026-10-16).
  toasts.dismiss(WAITS_FOR_SIGN_IN);
  toasts.success(username ? `Signed in as ${username}` : 'Signed in');
  const m = await import('../ui/person-join-modal');
  const door = await import('../setup/open-door');
  if (await m.resumeJoinAfterSignIn(toasts)) { door.dropHeldOpen(); return; }
  if (await door.resumeOpenAfterSignIn(toasts) || isAtlasGrounded() || isTourFlagActive()) return;
  // Said only once the list has come with worlds in it, and never under the tour.
  const rows = await accountWorldsWhenFetched(token);
  if (!rows?.length || isAtlasGrounded() || isTourFlagActive()) return;
  toasts.show(`Your worlds on OnlyWorlds (${rows.length}) are listed on the first screen.`, 'info', 0, {
    actions: [{ label: 'Show them', run: () => navigate('#/') }],
  });
}
