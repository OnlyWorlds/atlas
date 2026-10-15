/**
 * Account-mode world list + open flow (session 260).
 *
 * `refreshAccountWorlds` fills the `accountWorlds` state slice from
 * GET /account/worlds — token-identity-guarded so the sidebar's render can
 * call it freely (R6: fires on Worlds-mode mount AND on the sign-in
 * transition while mounted). Offline-first law: failures land in the slice
 * as a quiet error string; local rendering never waits on this.
 *
 * `openAccountWorld` is a row's click, owned or shared (#199): preconditions
 * (where it lands, the PIN when it will write) → mint this account's own key
 * → download via the existing link pipeline ON the activation chain →
 * navigate home + waypoint. Ordering is the gate's R1: every precondition
 * resolves BEFORE the mint so a failed open never leaves an orphaned
 * server-side key.
 */

import { downloadingLine } from '../ui/download-progress';
import { getState, patchSlice } from '../core/state';
import { navigate, homeHash } from '../core/router';
import { saveRegistry, setPin, findWorldByServerId, findLinkedWorld } from '../registry/registry';
import { enqueueActivationTask } from '../core/activation-chain';
import { linkExistingApiWorldInRoot } from '../setup/atlas-root-flow';
import { completeWaypoint } from '../core/waypoints';
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
      error: undefined,
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
        error: undefined,
      });
    } catch (err) {
      if (getState().registry.account_token !== token) return;
      patchSlice('accountWorlds', {
        ...getState().accountWorlds,
        status: 'error',
        error: accountErrorMessage(err),
        // A bad token's rows are meaningless; an offline blip keeps old rows.
        rows: isAccountAuthError(err) ? [] : getState().accountWorlds.rows,
      });
    } finally {
      if (inFlightToken === token) inFlightToken = null;
    }
  }
}

/**
 * Remote rows to render: every account world not already represented by a
 * registry entry — a LIVE link (api.world_id) or a remembered former link
 * (an unlinked world whose folder is still here; relinking is Make Online →
 * link's job, not a fresh download's — gate R3a).
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
  // This copy stays a read key: a swap in place is #198, not built. The way to
  // edit is the read key's (settings-world.ts): Unlink, then Make online.
  if (why === 'no-pin') return `${row.name} is open to read: editing a world shared with you needs a PIN on your account, set on onlyworlds.com in Account settings under World PIN. This copy stays read-only. To edit it after that, make a write key on the world's page there, then here Unlink it in Settings, This world, and link it again with Make online.`;
  if (row.member_role === 'contributor') return `As a contributor in ${row.name}, you can add to it and change what you add.`;
  return null;
}

/**
 * Open an account world, owned or shared with this account (#199): mint this
 * account's own key, download into a fresh folder, activate.
 */
export async function openAccountWorld(row: AccountWorldRow, toasts: ToastManager): Promise<boolean> {
  const state = getState();
  const token = state.registry.account_token;
  if (!token) return false;
  if (state.accountWorlds.opening) return false; // one open at a time
  // Without the folder picker the world lands in this browser: ask the
  // browser to keep worlds inside the click, before the first await
  // (contract §2.3; S376 gate B6).
  if (!hasFolderMode()) requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000));

  // ---- Preconditions BEFORE the mint (gate R1: no orphaned keys) ----
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
  const where = await askWhere({
    title: `Open "${row.name}"`,
    action: 'Open',
    purpose: 'Opening an online world downloads it into a new folder.',
    toasts,
  });
  if (!where) return false;
  // A guest reads, so only a world that opens to write asks for the PIN.
  let pin = state.registry.pin;
  let enteredPin: string | null = null;
  if (!pin && opensToWrite(row)) {
    enteredPin = await new PinPromptModal().prompt(row.role === 'owner'
      ? `Opening "${row.name}": Atlas needs your OnlyWorlds PIN to sync edits. It is saved in settings for every online world.`
      : `Opening "${row.name}", shared with you: Atlas needs your OnlyWorlds PIN to save your edits. No PIN yet? You set it on onlyworlds.com, in Account settings under World PIN.`
    );
    if (!enteredPin) return false;
    pin = enteredPin;
  }

  patchSlice('accountWorlds', { ...getState().accountWorlds, opening: row.id });
  // Blocking progress overlay (Captain smoke, S260): the mint + download +
  // first folder open take real seconds and previously froze silently.
  const overlay = showLoadingOverlay(`Opening ${row.name}`);
  try {
    // ---- Mint (the one server-side mutation before the download) ----
    overlay.update('Making a key…');
    const { minted, readOnly, why } = await mintOwnKey(new AccountClient(token), row);
    // A typed PIN is kept only for a world that writes: a member whose
    // account has no PIN typed one keel cannot know.
    if (enteredPin && !readOnly) {
      const next = setPin(getState().registry, enteredPin);
      saveRegistry(next);
      patchSlice('registry', next);
    }
    toasts.info(`Made a key for ${row.name}`);

    // ---- Download + register, serialized on the activation chain (R2) ----
    overlay.update('Waiting for a free slot…');
    const result = await enqueueActivationTask(() =>
      linkExistingApiWorldInRoot({
        where,
        apiKey: minted.key,
        apiPin: readOnly ? '' : pin!,
        readOnly,
        displayName: row.name,
        knownWorld: { id: row.id, name: row.name },
        onProgress: (p) => {
          if (p.phase === 'list') {
            overlay.update(`Finding elements${p.currentType ? ` · ${p.currentType}` : ''}…`);
          } else {
            overlay.update(p.total === 0
              ? 'Empty world; finishing up…'
              : downloadingLine(p.done, p.total, where));
          }
        },
      })
    );
    overlay.update('Opening…');

    // ---- Complete the handoff (R5 — parity with LinkWorldModal) ----
    navigate(homeHash(result.entry.id));
    completeWaypoint('ecosystem');
    if (result.failures.length > 0) {
      toasts.error(`Opened ${row.name}. ${result.failures.length} element${result.failures.length === 1 ? '' : 's'} did not download. Refresh from OnlyWorlds brings ${result.failures.length === 1 ? 'it' : 'them'}.`);
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
      toasts.error(accountErrorMessage(err));
    }
    return false;
  } finally {
    overlay.close();
    patchSlice('accountWorlds', { ...getState().accountWorlds, opening: null });
  }
}
