/**
 * Account-mode world list + open flow.
 *
 * `refreshAccountWorlds` fills the `accountWorlds` state slice from
 * GET /account/worlds — token-identity-guarded so the sidebar's render can
 * call it freely (R6: fires on Worlds-mode mount AND on the sign-in
 * transition while mounted). Offline-first law: failures land in the slice
 * as a quiet error string; local rendering never waits on this.
 *
 * `openAccountWorld` is a row's click, owned or shared (#199): preconditions
 * (where it lands; a member's PIN, asked after the mint; an owner's PIN is
 * asked later, in the world, 1.125.0) → mint this account's own key
 * → download via the existing link pipeline ON the activation chain →
 * navigate home. Ordering matters: every precondition
 * resolves BEFORE the mint so a failed open never leaves an orphaned
 * server-side key.
 */

import { progressLine } from '../ui/download-progress';
import { getState, patchSlice, subscribe } from '../core/state';
import { SIGNED_IN_AGAIN_LINE } from './token-revoke';
import { mintRecordOf } from './key-takeback';
import { navigate, homeHash } from '../core/router';
import { findWorldByServerId, findLinkedWorld } from '../registry/registry';
import { enqueueActivationTask } from '../core/activation-chain';
import { linkExistingApiWorldInRoot, PinNeededError } from '../setup/atlas-root-flow';
import { PinRefusedError } from '../setup/key-check-errors';
import { AccountClient, accountErrorMessage, isAccountAuthError, type MintedWorldKey } from './account-client';
import { OwV2Error } from './ow-v2-client-adapter';
import { PinPromptModal } from '../ui/pin-prompt-modal';
import { showLoadingOverlay } from '../ui/loading-overlay';
import { ToastManager } from '../ui/toast-manager';
import { hasFolderMode } from '../core/capabilities';
import { requestPersistOnFirstBrowserWorld } from '../setup/world-parent';
import type { AccountWorldRow } from '../core/types';

/**
 * Fetch the account world list if the signed-in token hasn't been fetched
 * yet (or `force`). Safe to call from render paths: in-flight and same-token
 * calls are no-ops, and the state patch is microtask-deferred so a render-
 * path caller never re-enters notify mid-render (conv #112).
 */
let inFlightToken: string | null = null;

/**
 * The name a minted key carries in the portal keys table: "atlas · windows".
 * The device half is the coarsest honest label a browser can give (platform);
 * it distinguishes tools and machine families, and the key's last4 covers the
 * rest. Clipped to the server's 255-char limit (422 param=name past it).
 */
export function deviceKeyName(): string {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = (nav.userAgentData?.platform || nav.platform || 'device')
    .toLowerCase().trim() || 'device';
  return `atlas · ${platform}`.slice(0, 255);
}

export function refreshAccountWorlds(force = false): void {
  const { registry, accountWorlds } = getState();
  const token = registry.account_token;
  if (!token) return;
  if (!force && accountWorlds.fetchedWithToken === token) return;
  if (inFlightToken === token) return;
  inFlightToken = token;

  queueMicrotask(() => {
    if (getState().registry.account_token !== token) { inFlightToken = null; return; }
    patchSlice('accountWorlds', {
      ...getState().accountWorlds,
      status: 'loading',
      fetchedWithToken: token,
      error: undefined, errorKind: undefined,
    });
    void run();
  });

  async function run(): Promise<void> {
    try {
      const rows = await new AccountClient(token!).listWorlds();
      // Token may have changed (forget / re-sign-in) while we fetched.
      if (getState().registry.account_token !== token) return;
      patchSlice('accountWorlds', {
        ...getState().accountWorlds,
        status: 'ready',
        rows,
        error: undefined, errorKind: undefined,
      });
    } catch (err) {
      if (getState().registry.account_token !== token) return;
      patchSlice('accountWorlds', {
        ...getState().accountWorlds,
        status: 'error',
        // The list is account calls alone: no PIN goes with them.
        error: accountErrorMessage(err, { noPin: true }), errorKind: isAccountAuthError(err) ? 'auth' : 'other',
        // A bad token's rows are meaningless; an offline blip keeps old rows.
        rows: isAccountAuthError(err) ? [] : getState().accountWorlds.rows,
      });
    } finally {
      if (inFlightToken === token) inFlightToken = null;
    }
  }
}

/**
 * The account list for this token, once it has come (or failed, or 15 s
 * passed): the rows still to open here, or null when none came. A sentence
 * that promises the list waits on this (an account with
 * no worlds was once told they were listed).
 */
export function accountWorldsWhenFetched(
  token: string,
  timeoutMs = 15_000,
  opts: { fresh?: boolean } = {},
): Promise<AccountWorldRow[] | null> {
  refreshAccountWorlds(opts.fresh);
  // `fresh` waits for a fetch begun now or already running: the slice turns
  // 'loading' a microtask after the call, and until then its old answer (an
  // old list, an old failure) is no answer.
  let begun = !opts.fresh || getState().accountWorlds.status === 'loading';
  return new Promise((resolve) => {
    let unsub: () => void = () => undefined;
    const timer = setTimeout(() => finish(null), timeoutMs);
    function finish(rows: AccountWorldRow[] | null): void {
      clearTimeout(timer);
      unsub();
      resolve(rows);
    }
    function check(): boolean {
      const { registry, accountWorlds } = getState();
      if (registry.account_token !== token) { finish(null); return true; }
      if (!begun) {
        if (accountWorlds.status === 'loading') begun = true;
        return false;
      }
      if (accountWorlds.fetchedWithToken !== token) return false;
      if (accountWorlds.status === 'ready') { finish(remoteAccountWorlds()); return true; }
      if (accountWorlds.status === 'error') { finish(null); return true; }
      return false;
    }
    if (check()) return;
    unsub = subscribe(() => { check(); });
  });
}

/**
 * Remote rows to render: every account world not already represented by a
 * registry entry — a LIVE link (api.world_id) or a remembered former link
 * (an unlinked world whose folder is still here; relinking is Make Online →
 * link's job, not a fresh download's).
 */
export function remoteAccountWorlds(): AccountWorldRow[] {
  const { registry, accountWorlds } = getState();
  if (!registry.account_token) return [];
  return accountWorlds.rows.filter(row => !findWorldByServerId(registry, row.id));
}

/**
 * True when opening the row asks for a write key: an owner, a co-builder, a
 * contributor. A guest (Lantern's player) reads, as in Lantern.
 */
export function opensToWrite(row: AccountWorldRow): boolean {
  return row.role === 'owner' || row.member_role !== 'guest';
}

/** Why a row opened to read: a guest's seat, or a member with no account PIN. */
export type ReadOnlyWhy = 'guest' | 'no-pin';

/**
 * Mint this account's own key for the row (keel D72 R9: a member's key is
 * bound to their membership). A member's write key needs an account PIN on
 * onlyworlds.com (409 pin_required); without one the member gets a read key
 * and the world opens to read. The owner always has a PIN (keel's create
 * requires one), so the fallback is a member's only.
 */
export async function mintOwnKey(
  client: AccountClient,
  row: AccountWorldRow,
): Promise<{ minted: MintedWorldKey; readOnly: boolean; why?: ReadOnlyWhy }> {
  const name = deviceKeyName();
  if (!opensToWrite(row)) {
    return { minted: await client.mintWorldKey(row.id, name, 'read'), readOnly: true, why: 'guest' };
  }
  try {
    return { minted: await client.mintWorldKey(row.id, name), readOnly: false };
  } catch (err) {
    if (row.role !== 'owner' && err instanceof OwV2Error && err.code === 'pin_required') {
      return { minted: await client.mintWorldKey(row.id, name, 'read'), readOnly: true, why: 'no-pin' };
    }
    throw err;
  }
}

/** The line a shared world's open leaves after its toast, or null. */
export function sharedOpenLine(row: AccountWorldRow, why: ReadOnlyWhy | undefined): string | null {
  if (why === 'guest') return `${row.name} is open to read: you are a guest in it, so you see only part of it.`;
  // After a PIN is set, the key is swapped in place (#198, `world-key.ts`).
  if (why === 'no-pin') return `${row.name} is open to read: editing a world shared with you needs a World PIN on your account, set on onlyworlds.com in Account settings under World PIN. Then press Make a new key in Settings, This world, and it opens to edit.`;
  if (row.member_role === 'contributor') return `As a contributor in ${row.name}, you can add to it and change what you add.`;
  return null;
}

/** What the open door says when another open holds the one-open guard (1.125.0). */
export const OPENING_ANOTHER_LINE = 'Atlas is opening another world. Open this one again from onlyworlds.com when it is done.';

/** How `#/open/<id>` opens a row (1.125.0, 2026-11-22, R2): the where-question names it, and goes down on a move. */
export interface AccountOpenOpts {
  fromLink?: boolean;
}

/** The where-question's title for a link from onlyworlds.com: the first and only question, named. */
export function openFromLinkTitle(row: AccountWorldRow): string {
  return `Open "${row.name}"${row.role === 'owner' ? '' : ', shared with you'}, from your worlds on OnlyWorlds`;
}

/**
 * Open an account world, owned or shared with this account (#199): mint this
 * account's own key, download into a fresh folder, activate.
 */
export async function openAccountWorld(row: AccountWorldRow, toasts: ToastManager, opts: AccountOpenOpts = {}): Promise<boolean> {
  // One open at a time from the first click: the `opening` slice is set only
  // after the where-question, so a double tap on a browser that asks nothing
  // started two opens and made two keys.
  if (openStarted) {
    if (opts.fromLink) toasts.info(OPENING_ANOTHER_LINE);
    return false;
  }
  openStarted = true;
  try {
    return await openAccountWorldOnce(row, toasts, opts);
  } finally {
    openStarted = false;
  }
}

let openStarted = false;

async function openAccountWorldOnce(row: AccountWorldRow, toasts: ToastManager, opts: AccountOpenOpts): Promise<boolean> {
  const state = getState();
  const token = state.registry.account_token;
  if (!token) return false;
  if (state.accountWorlds.opening) { // one open at a time
    if (opts.fromLink) toasts.info(OPENING_ANOTHER_LINE);
    return false;
  }
  // Without the folder picker the world lands in this browser: ask the
  // browser to keep worlds inside the click, before the first await
  // (contract §2.3).
  if (!hasFolderMode()) requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000));

  // ---- Preconditions BEFORE the mint (no orphaned keys) ----
  // The duplicate check re-runs inside the link flow (on the chain); this
  // early one just avoids a pointless mint on an obviously-stale row.
  if (findLinkedWorld(state.registry, row.id) ?? findWorldByServerId(state.registry, row.id)) {
    toasts.info(`"${row.name}" is already here. Open it from the list above`);
    refreshAccountWorlds(true);
    return false;
  }
  // Where it lands (1.17, conv. 129): the where-question as its own step,
  // with the home folder asked for inside it when the folder is the answer
  // and none is set. A Cancel is the user's answer: stop quietly.
  const { askWhere } = await import('../ui/where-choice');
  // From a link (1.125.0, R2) the question is the arrival's first and only one, named, and it goes down
  // on the tour's start or a real move of the address, as the public ask does.
  const where = await askWhere({
    title: opts.fromLink ? openFromLinkTitle(row) : `Open "${row.name}"`,
    action: 'Open',
    purpose: 'Opening an online world downloads it into a new folder.',
    toasts,
    ...(opts.fromLink ? { putDownOnMove: true } : {}),
  });
  if (!where) return false;
  // A guest reads, so only a world that opens to write asks for the PIN. The
  // owner is asked nothing here (1.125.0, 2026-11-22, R3): keel reads the key just
  // made without a PIN, so the world comes down with none kept and asks for it
  // in the world (the pill's Add PIN, the first change), where onlyworlds.com
  // says it will. A member is asked only after the mint, as before: the mint
  // says whether their account has a PIN at all, and one who joined with a new
  // account has none and opens to read without a question they cannot answer
  // (#294's walk).
  let pin = state.registry.pin;
  let enteredPin: string | null = null;
  const pinLater = !pin && opensToWrite(row) && row.role === 'owner';
  // A sign-in in another tab while the questions waited replaced the token, and the old one is
  // revoked (conv. 179): stop here rather than say the new one was refused.
  if (getState().registry.account_token !== token) {
    toasts.info(SIGNED_IN_AGAIN_LINE);
    refreshAccountWorlds(true);
    return false;
  }

  patchSlice('accountWorlds', { ...getState().accountWorlds, opening: row.id });
  // Blocking progress overlay (Titus smoke): the mint + download +
  // first folder open take real seconds and previously froze silently.
  const overlay = showLoadingOverlay(`Opening ${row.name}`);
  try {
    // ---- Mint (the one server-side mutation before the download) ----
    overlay.update('Making a key…');
    const client = new AccountClient(token);
    const { minted, readOnly, why } = await mintOwnKey(client, row);
    // A member with a PIN on their account and none saved here: asked now,
    // with the overlay down. A Cancel takes the new key back, so a refusal
    // leaves nothing on keel.
    if (!pin && !readOnly && !pinLater) {
      overlay.hide();
      enteredPin = await new PinPromptModal().prompt(
        `Opening "${row.name}", shared with you: Atlas needs your World PIN to save your edits. It is one for your whole account, set on onlyworlds.com in Account settings under World PIN.`
      );
      if (!enteredPin) {
        await client.revokeWorldKey(row.id, minted.id).catch(() => {});
        return false;
      }
      pin = enteredPin;
      overlay.show();
    }
    // A PIN typed here is kept as the account's by the link below, once keel
    // has taken it beside the new write key; a refused one takes the key back.
    toasts.info(`Made a key for ${row.name}`);

    // ---- Download + register, serialized on the activation chain (R2) ----
    overlay.update('Waiting for a free slot…');
    const result = await enqueueActivationTask(() =>
      linkExistingApiWorldInRoot({
        where,
        apiKey: minted.key,
        apiPin: readOnly ? '' : (pin ?? ''),
        readOnly,
        ...(pinLater ? { pinLater: true } : {}),
        displayName: row.name,
        knownWorld: { id: row.id, name: row.name },
        keyMint: mintRecordOf(minted.key, minted.id),
        onProgress: (p) => {
          if (p.phase === 'list') {
            overlay.update(`Finding elements${p.currentType ? ` · ${p.currentType}` : ''}…`);
          } else {
            overlay.update(p.total === 0 && p.phase !== 'open'
              ? 'Empty world; finishing up…'
              : progressLine(p));
          }
        },
      })
    ).catch(async (err: unknown) => {
      // keel refused the PIN beside the key made a moment ago, or the owner's
      // key turned out to need a PIN to read (`pinLater` refused): nothing was
      // kept, so the key goes back too.
      if (err instanceof PinRefusedError || err instanceof PinNeededError) await client.revokeWorldKey(row.id, minted.id).catch(() => {});
      throw err;
    });
    overlay.update('Opening…');

    // ---- Complete the handoff (R5 — parity with LinkWorldModal) ----
    navigate(homeHash(result.entry.id));
    if (result.failures.length > 0) {
      // With the PIN later, a refresh first asks for the PIN (1.125.0): say so.
      const n = result.failures.length;
      const what = `${n} element${n === 1 ? '' : 's'} did not download`;
      toasts.error(pinLater
        ? `Opened ${row.name}. ${what}: once your World PIN is in, a refresh from OnlyWorlds brings ${n === 1 ? 'it' : 'them'}.`
        : `Opened ${row.name}. ${what}. Refresh from OnlyWorlds brings ${n === 1 ? 'it' : 'them'}.`);
    } else {
      toasts.success(`Opened ${row.name} · ${result.downloaded} element${result.downloaded === 1 ? '' : 's'}`);
    }
    const line = sharedOpenLine(row, why);
    if (line) toasts.info(line, why === 'no-pin' ? 20_000 : 12_000);
    return true;
  } catch (err) {
    if (err instanceof Error && /not_found|404/.test(err.message)) {
      // Stale row: world deleted (or ownership changed) since the list.
      toasts.error(`${row.name} is no longer available on your account`);
      refreshAccountWorlds(true);
    } else {
      // The open's refusals that reach here sent no PIN (its `/me` is worded by the link), and a key may
      // have been made before it failed.
      toasts.error(accountErrorMessage(err, { noPin: 'may-have-left' }));
    }
    return false;
  } finally {
    overlay.close();
    patchSlice('accountWorlds', { ...getState().accountWorlds, opening: null });
  }
}
