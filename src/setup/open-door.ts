/**
 * The `#/open/<world id>` door: "Open in Atlas" on a
 * world's page on onlyworlds.com opens that world here.
 *
 * It rides the account sign-in, never a code or a key in the URL: a world
 * already here opens; signed in, the account's row for that id opens through
 * the same `openAccountWorld` as a click in the Worlds list (#199), after one
 * question that names it (1.125.0, 2026-11-22, R2): with a world open, the corner
 * toast's Open; with none, the where-question itself, or without a folder
 * picker a card whose Open is the click the browser-storage request needs.
 * Signed out, or signed in with no row for that id, the public path runs
 * (1.123, `setup/public-door.ts`): a world anyone may read opens as a
 * view-only copy after an ask, and a world the public cannot read gets this
 * door's own words (signed out, a card that holds the sign-in, the id waiting
 * in memory, as a person's invitation does: R1). Only ever a download:
 * nothing here uploads into the world the link names (contract R7).
 */

import { getState } from '../core/state';
import { homeHash, navigate, settingsHash } from '../core/router';
import { enqueueActivationTask } from '../core/activation-chain';
import { findLinkedWorld, findWorldByServerId } from '../registry/registry';
import { accountWorldsWhenFetched, openAccountWorld } from '../sync/account-worlds';
import { activateWorld } from '../sidebar/worlds-sidebar';
import { isTourFlagActive } from '../tour/tour-flag';
import { parkedLandingFor, touchOpenLanding } from '../core/open-landing';
import { WAITS_FOR_SIGN_IN, type ToastManager } from '../ui/toast-manager';
import type { AccountWorldRow, WorldRegistryEntry } from '../core/types';
import { runPublicDoor, type PublicDoorCtx } from './public-door';
import { hasFolderMode } from '../core/capabilities';
import { PublicAskModal } from '../ui/public-ask-modal';
import { OpenSignInCard } from '../ui/open-sign-in-card';
import { onlyWorldsSignInOffered } from '../ui/onlyworlds-sign-in-button';
import { beginOnlyWorldsSignIn, type SignInResume } from '../sync/onlyworlds-sign-in';
import { flushBeforeUnloading } from '../core/reload-offer';
import { problemFor } from '../core/problems';
import { joinHeldForSignIn } from './join-door';

export const OPEN_MALFORMED_LINE = 'This link to open a world is not complete. Open the world again from onlyworlds.com.';
/** The card's line when the world's name is not known (a private world, read keyless). */
export const OPEN_SIGN_IN_CARD_LINE = 'This link opens a world on onlyworlds.com. Sign in to Atlas with your OnlyWorlds account and it opens here.';
/** The card's line from the public ask's Sign in, where the name is known. */
export function openSignInNamedLine(name: string): string {
  return `Sign in to Atlas with your OnlyWorlds account to open "${name}" here.`;
}
/** Said in Settings after the card's Email and password, until the sign-in takes it down. */
export const OPEN_SIGN_IN_LINE = 'Sign in here with your OnlyWorlds account. The world you opened from onlyworlds.com opens after that.';
const SIGNED_IN_ANOTHER_LINE = 'Atlas is signed in with another account now. Open the world again from onlyworlds.com.';
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

/** The id waiting for the sign-in, and its return after Sign in with OnlyWorlds's round trip unloaded the page. */
export function openHeldForSignIn(): string | null { return heldForSignIn; }
export function holdOpenForSignIn(id: string): void { heldForSignIn = id; }

/** A waiting id is dropped: another door took the sign-in, or the token was forgotten. */
export function dropHeldOpen(): void {
  heldForSignIn = null;
}

async function openWorldById(id: string, toasts: ToastManager): Promise<void> {
  if (isTourFlagActive()) {
    toasts.info(OPEN_TOUR_LINE);
    return;
  }
  // The boot reconciliation runs first on the chain and can bring a lost
  // copy back into the registry: look for one after it.
  await enqueueActivationTask(async () => {});
  if (await openHere(id, toasts)) return;
  const token = getState().registry.account_token;
  if (!token) {
    // Signed out: a world anyone may read takes the public path (1.123).
    await runPublicDoor(id, toasts, publicCtx(id, null, toasts));
    return;
  }
  // A fresh read: a world made or shared since this tab last asked is on it,
  // and an old failure is not repeated from the slice.
  const rows = await accountWorldsWhenFetched(token, undefined, { fresh: true });
  if (getState().registry.account_token !== token) return;
  if (rows === null) {
    toasts.error(getState().accountWorlds.error ?? OPEN_UNREAD_LINE, 12_000);
    return;
  }
  const row = rows.find(r => r.id === id);
  if (!row) {
    // No row for it on this account: a world anyone may read takes the public path (1.123).
    await runPublicDoor(id, toasts, publicCtx(id, token, toasts));
    return;
  }
  askToOpen(row, token, toasts);
}

/** Signed out, a world the door cannot open: the id waits for the sign-in, and the card holds it (R1). */
function saySignIn(id: string, toasts: ToastManager, name?: string): void {
  heldForSignIn = id;
  showSignInCard(toasts, name);
}

/**
 * A sign-in that came back cancelled or failed with an id held (`sign-in-return.ts`): the card again,
 * the id still held, in place of the return's Open Settings. Its Not now drops the id.
 */
export function askSignInAgain(toasts: ToastManager): void {
  if (heldForSignIn) showSignInCard(toasts);
}

/** The card (`ui/open-sign-in-card.ts`), over the page as it is: it does not navigate. */
function showSignInCard(toasts: ToastManager, name?: string): void {
  new OpenSignInCard({
    line: name ? openSignInNamedLine(name) : OPEN_SIGN_IN_CARD_LINE,
    focusNotNow: !!getState().active?.worldId,
    ...(onlyWorldsSignInOffered() ? { onOnlyWorlds: () => signInWithOnlyWorldsFromCard(toasts, name) } : {}),
    onPassword: () => {
      navigate(settingsHash(getState().active?.worldId ?? null, 'onlyworlds'));
      // Taken down by the sign-in itself (settings-account), never left up
      // through the Open question it leads to (a walk, 2026-10-16).
      toasts.show(OPEN_SIGN_IN_LINE, 'info', 20_000, { dedupeKey: WAITS_FOR_SIGN_IN });
    },
    onDrop: dropHeldOpen,
  }).open();
}

/**
 * The card's Sign in with OnlyWorlds, inside its click: the held id and its landing go into the resume
 * before any await (the page unload drops memory), with the page behind the card as its route, as the
 * shared button does (`onlyworlds-sign-in-button.ts`); then the rooms are saved, then the tab leaves.
 * A Back that brings the page out of the browser's cache drops the parked resume and shows the card
 * again, the id still held; a begin that fails shows it again too.
 */
function signInWithOnlyWorldsFromCard(toasts: ToastManager, name?: string): void {
  const resume: SignInResume = { hash: location.hash || '#/' };
  const open = heldForSignIn;
  if (open) {
    resume.open = open;
    const landing = parkedLandingFor(open);
    if (landing) resume.landing = landing;
  }
  const join = joinHeldForSignIn();
  if (join) resume.join = join;
  void (async () => {
    try {
      await flushBeforeUnloading();
      window.addEventListener('pageshow', (e) => {
        if (!e.persisted) return;
        if (heldForSignIn) showSignInCard(toasts, name);
      }, { once: true });
      await beginOnlyWorldsSignIn(resume);
    } catch (err) {
      toasts.error(problemFor(err, { inline: true, doing: 'signing in' }).sentence);
      if (heldForSignIn) showSignInCard(toasts, name);
    }
  })();
}

function sayNotAmong(toasts: ToastManager): void {
  const who = getState().registry.account_username;
  toasts.error(`This world is not among the worlds of ${who ? who : 'the account Atlas is signed in with'} on OnlyWorlds. Sign in to Atlas with the account that owns it or was invited into it.`, 15_000);
}

/** The public path's hooks into this door: its words for a world it cannot see, and its open of a world already here. */
function publicCtx(id: string, token: string | null, toasts: ToastManager): PublicDoorCtx {
  return {
    token,
    saySignIn: (name) => saySignIn(id, toasts, name),
    sayNotAmong: () => sayNotAmong(toasts),
    openHere: (entry, said) => openEntryHere(entry, toasts, said),
  };
}

/** The one question, named: `Open "<name>"[, shared with you], from your worlds on OnlyWorlds?`. */
export function openAccountLine(row: AccountWorldRow): string {
  return `Open "${row.name}"${row.role === 'owner' ? '' : ', shared with you'}, from your worlds on OnlyWorlds?`;
}

/**
 * The confirm: nothing is made before the person's Open (P1). With a world open in the tab, the corner toast
 * (it takes no focus). With none (1.125.0, 2026-11-22, R2): with the folder picker, the open runs at once and its
 * where-question is the confirm, named; without one (Firefox), a card whose Open is the click the storage
 * request needs. A Cancel or a Not now is the person's no: nothing offers it again, and the row stays under
 * "Your worlds on OnlyWorlds" on the first screen.
 */
function askToOpen(row: AccountWorldRow, token: string, toasts: ToastManager): void {
  // The tour may have started, or the sign-in moved, while the list was read: checked before any question.
  if (isTourFlagActive()) { toasts.info(OPEN_TOUR_LINE); return; }
  if (getState().registry.account_token !== token) { toasts.info(SIGNED_IN_ANOTHER_LINE); return; }
  const stillAsked = (): boolean => {
    // The toast and the card stay until pressed: the row is this token's, and the tour may have started since.
    if (isTourFlagActive()) { toasts.info(OPEN_TOUR_LINE); return false; }
    if (getState().registry.account_token !== token) { toasts.info(SIGNED_IN_ANOTHER_LINE); return false; }
    return true;
  };
  if (getState().active?.worldId) {
    toasts.show(openAccountLine(row), 'info', 0, {
      actions: [{
        label: 'Open',
        run: () => {
          if (!stillAsked()) return;
          touchOpenLanding(row.id);
          void openAccountWorld(row, toasts);
        },
      }],
    });
    return;
  }
  if (hasFolderMode()) {
    touchOpenLanding(row.id);
    void openAccountWorld(row, toasts, { fromLink: true });
    return;
  }
  new PublicAskModal({
    line: openAccountLine(row),
    dataModal: 'open-account',
    // Synchronous inside the click: `openAccountWorld` asks the browser to keep worlds before its first await.
    onOpen: () => {
      if (!stillAsked()) return;
      touchOpenLanding(row.id);
      void openAccountWorld(row, toasts, { fromLink: true });
    },
  }).open();
}

/**
 * A copy already here opens as it is. True when there was one. A route alone
 * never activates a world mid-session, so this activates it. Silently only
 * when no world is open: a link from anyone never moves a person out of the
 * world they are in without their click (2026-10-16), and a folder's
 * permission query runs after the open world is cleared, so a refused one
 * would leave that world empty. Any open that did not happen
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
  return openEntryHere(here, toasts, said);
}

/**
 * Open a world already here as the door does (a world it names, or the
 * public path's copy): `said` once it opened. False when the registry forgot
 * it (its folder gone), so the caller may find another way.
 */
async function openEntryHere(here: WorldRegistryEntry, toasts: ToastManager, said: () => void = () => {}): Promise<boolean> {
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
    // Its folder gone, the registry forgot it: the account's copy is the way back.
    if (!getState().registry.worlds.some(w => w.id === here.id)) return false;
  }
  // The click opens it, or says in its own words why it cannot (a cleared
  // copy, a lost folder).
  toasts.show(`Open "${here.name}" here?`, 'info', 0, {
    actions: [{ label: 'Open it', run: () => { void activateWorld(here.id, toasts).then(ok => { if (ok) said(); }); } }],
  });
  return true;
}
