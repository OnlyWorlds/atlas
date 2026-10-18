/**
 * The `#/open/<world id>` door (OW Infra #104, S416): "Open in Atlas" on a
 * world's page on onlyworlds.com opens that world here.
 *
 * It rides the account sign-in, never a code or a key in the URL: a world
 * already here opens; signed in, the account's row for that id opens through
 * the same `openAccountWorld` as a click in the Worlds list (#199), after the
 * person says Open (the click the browser-storage request needs, and the
 * confirm that names the world); signed out, the id waits in memory for the
 * sign-in in Settings, as a person's invitation does. Only ever a download:
 * nothing here uploads into the world the link names (contract R7).
 */

import { getState } from '../core/state';
import { homeHash, navigate, settingsHash } from '../core/router';
import { enqueueActivationTask } from '../core/activation-chain';
import { findLinkedWorld, findWorldByServerId } from '../registry/registry';
import { accountWorldsWhenFetched, openAccountWorld } from '../sync/account-worlds';
import { activateWorld } from '../sidebar/worlds-sidebar';
import { isTourFlagActive } from '../tour/tour-flag';
import { WAITS_FOR_SIGN_IN, type ToastManager } from '../ui/toast-manager';
import type { AccountWorldRow } from '../core/types';

export const OPEN_MALFORMED_LINE = 'This link to open a world is not complete. Open the world again from onlyworlds.com.';
export const OPEN_SIGN_IN_LINE = 'To open this world from onlyworlds.com, sign in to Atlas with your OnlyWorlds account: your email or username and password, under Account. The world opens after that, in this tab; if you reload, open it again from onlyworlds.com.';
export const OPEN_UNREAD_LINE = 'Atlas could not read your worlds on OnlyWorlds just now. Open the world again from onlyworlds.com in a moment.';
const OPEN_TOUR_LINE = 'Finish the tour first, then open the world again from onlyworlds.com.';

/** An id waiting for the sign-in (memory only, as the captured id is). */
let heldForSignIn: string | null = null;

/** Run the door for an id `open-capture` took ('' when malformed), once. */
export async function runOpenLink(id: string, toasts: ToastManager): Promise<void> {
  if (id === '') { toasts.error(OPEN_MALFORMED_LINE); return; }
  await openWorldById(id, toasts);
}

/**
 * The sign-in in Settings succeeded: an id that waited for it runs the door
 * again. True when one was waiting (the door then speaks).
 */
export async function resumeOpenAfterSignIn(toasts: ToastManager): Promise<boolean> {
  const id = heldForSignIn;
  heldForSignIn = null;
  if (!id) return false;
  await openWorldById(id, toasts);
  return true;
}

/** A waiting id is dropped: another door took the sign-in, or the token was forgotten (the S416 gate's F4). */
export function dropHeldOpen(): void {
  heldForSignIn = null;
}

async function openWorldById(id: string, toasts: ToastManager): Promise<void> {
  if (isTourFlagActive()) {
    toasts.info(OPEN_TOUR_LINE);
    return;
  }
  // The boot reconciliation runs first on the chain and can bring a lost
  // copy back into the registry: look for one after it (the gate's F6).
  await enqueueActivationTask(async () => {});
  if (await openHere(id, toasts)) return;
  const token = getState().registry.account_token;
  if (!token) {
    heldForSignIn = id;
    navigate(settingsHash(getState().active?.worldId ?? null, 'onlyworlds'));
    // Taken down by the sign-in itself (settings-account), never left up
    // through the Open question it leads to (Kael's walk, h57 #5950).
    toasts.show(OPEN_SIGN_IN_LINE, 'info', 20_000, { dedupeKey: WAITS_FOR_SIGN_IN });
    return;
  }
  // A fresh read: a world made or shared since this tab last asked is on it,
  // and an old failure is not repeated from the slice (the gate's F2, F3).
  const rows = await accountWorldsWhenFetched(token, undefined, { fresh: true });
  if (getState().registry.account_token !== token) return;
  if (rows === null) {
    toasts.error(getState().accountWorlds.error ?? OPEN_UNREAD_LINE, 12_000);
    return;
  }
  const row = rows.find(r => r.id === id);
  if (!row) {
    const who = getState().registry.account_username;
    toasts.error(`This world is not among the worlds of ${who ? who : 'the account Atlas is signed in with'} on OnlyWorlds. Sign in to Atlas with the account that owns it or was invited into it.`, 15_000);
    return;
  }
  askToOpen(row, token, toasts);
}

/** The confirm: nothing is made before this Open (P1), and its click is the gesture. */
function askToOpen(row: AccountWorldRow, token: string, toasts: ToastManager): void {
  const shared = row.role === 'owner' ? '' : ', shared with you';
  toasts.show(`Open "${row.name}"${shared}, from your worlds on OnlyWorlds?`, 'info', 0, {
    actions: [{
      label: 'Open',
      run: () => {
        // The toast stays until clicked: the row is this token's, and the tour
        // may have started since (the gate's F7).
        if (isTourFlagActive()) { toasts.info(OPEN_TOUR_LINE); return; }
        if (getState().registry.account_token !== token) {
          toasts.info('Atlas is signed in with another account now. Open the world again from onlyworlds.com.');
          return;
        }
        void openAccountWorld(row, toasts);
      },
    }],
  });
}

/**
 * A copy already here opens as it is. True when there was one. A route alone
 * never activates a world mid-session, so this activates it. Silently only
 * when no world is open: a link from anyone never moves a person out of the
 * world they are in without their click (Kael, h37 #5811), and a folder's
 * permission query runs after the open world is cleared, so a refused one
 * would leave that world empty (the gate's F1). Any open that did not happen
 * asks for a click too.
 */
async function openHere(id: string, toasts: ToastManager): Promise<boolean> {
  const reg = getState().registry;
  const linked = findLinkedWorld(reg, id);
  const here = linked ?? findWorldByServerId(reg, id);
  if (!here) return false;
  // A world unlinked here stays as it is: the link names it, never relinks it.
  const said = () => {
    if (!linked) toasts.info(`${here.name} is already here, no longer linked to OnlyWorlds, so Atlas opened it as it is.`, 10_000);
  };
  const active = getState().active?.worldId ?? null;
  if (active === here.id) {
    navigate(homeHash(here.id));
    said();
    return true;
  }
  if (active === null) {
    if (await activateWorld(here.id, toasts, { silent: true, permissionMode: 'query' })) {
      said();
      return true;
    }
    // Its folder gone, the registry forgot it: the account's copy is the way back (the gate's F5).
    if (!getState().registry.worlds.some(w => w.id === here.id)) return false;
  }
  // The click opens it, or says in its own words why it cannot (a cleared
  // copy, a lost folder).
  toasts.show(`Open "${here.name}" here?`, 'info', 0, {
    actions: [{ label: 'Open it', run: () => { void activateWorld(here.id, toasts).then(ok => { if (ok) said(); }); } }],
  });
  return true;
}
