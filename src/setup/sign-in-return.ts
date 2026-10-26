/**
 * Back from onlyworlds.com on `/signin/callback` (contract R4, R6, R7): the
 * exchange already ran at module load (`main.ts`), the app has started on the
 * resumed route, and this applies what came back. What waited for a sign-in
 * (an invitation, an Open in Atlas link) is held again, since the page unload
 * dropped it from memory: signed in, it runs; refused, it still waits. The
 * door the person pressed from comes back either way, so a refusal leaves the
 * password fields one look away.
 */

import { OwSignInError } from '@onlyworlds/sdk';
import type { SignInOutcome } from '../sync/onlyworlds-sign-in';
import { signInCallbackLine } from '../sync/onlyworlds-sign-in';
import { keepSignIn } from '../sync/after-sign-in';
import { enqueueActivationTask } from '../core/activation-chain';
import { getState } from '../core/state';
import { navigate, parseHash, settingsHash } from '../core/router';
import type { ToastManager } from '../ui/toast-manager';

export const MAKE_ONLINE_AGAIN_LINE = 'Signed in. Open the world and press Make online again to finish.';

export async function applySignInOutcome(outcome: SignInOutcome, toasts: ToastManager): Promise<void> {
  const { resume } = outcome;
  // Back after a finished sign-in can ask onlyworlds.com again, which answers
  // with a fresh code for a round trip this tab no longer holds: signed in
  // already and nothing started here, there is nothing to say.
  if (!outcome.ok && !outcome.started && !outcome.cancelled && getState().registry.account_token
    && outcome.error instanceof OwSignInError && outcome.error.reason === 'state_mismatch') {
    console.info('[sign-in] a return this tab did not start, while signed in: left alone');
    return;
  }
  if (resume.join) (await import('./join-door')).holdJoinForSignIn(resume.join);
  if (resume.open) (await import('./open-door')).holdOpenForSignIn(resume.open);
  const heldDoorRuns = outcome.ok && Boolean(resume.join || resume.open);
  if (outcome.ok) {
    // keepSignIn saves the token before its first await, so a door reopened
    // below already sees it; its follow-ups (a held door, the worlds offer) run on.
    void keepSignIn(outcome.token, outcome.username, toasts, outcome.tokenId);
  } else {
    if (!outcome.cancelled) console.warn('[sign-in] the return did not sign in:', outcome.error);
    const line = signInCallbackLine(outcome);
    // Without a door coming back, the way to try again is Settings.
    const toSettings = !resume.door && parseHash(resume.hash).mode !== 'settings'
      ? { actions: [{ label: 'Open Settings', run: () => navigate(settingsHash(getState().active?.worldId ?? null, 'onlyworlds')) }] }
      : undefined;
    if (outcome.cancelled) toasts.show(line, 'info', 10_000, toSettings);
    else toasts.show(line, 'error', 15_000, toSettings);
  }
  // A held invitation or Open link opens its own dialog: the door does not stack on it.
  if (!resume.door || heldDoorRuns) return;
  if (resume.door === 'new-api') {
    const { runAddWorldAction } = await import('./world-doors');
    await runAddWorldAction('new-api', toasts);
    return;
  }
  // Make online belongs to one world: only once that world is the active one (R6).
  // A folder whose permission lapsed over the round trip does not reopen by
  // itself (boot asks quietly): then the person is told.
  await enqueueActivationTask(async () => {});
  const want = parseHash(resume.hash).worldId;
  if (!want || getState().active?.worldId !== want) {
    if (outcome.ok) toasts.info(MAKE_ONLINE_AGAIN_LINE, 12_000);
    return;
  }
  const { MakeOnlineModal } = await import('../ui/make-online-modal');
  new MakeOnlineModal(toasts).open();
}
