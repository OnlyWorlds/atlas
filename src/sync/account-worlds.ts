/**
 * Account-mode world list + open flow (session 260).
 *
 * `refreshAccountWorlds` fills the `accountWorlds` state slice from
 * GET /account/worlds — token-identity-guarded so the sidebar's render can
 * call it freely (R6: fires on Worlds-mode mount AND on the sign-in
 * transition while mounted). Offline-first law: failures land in the slice
 * as a quiet error string; local rendering never waits on this.
 *
 * `openAccountWorld` is the owned-row click: preconditions (where it lands, PIN)
 * → mint a WRITE key → download via the existing link pipeline ON the
 * activation chain → navigate home + waypoint. Ordering is the gate's R1:
 * every precondition resolves BEFORE the mint so a failed open never leaves
 * an orphaned server-side key.
 */

import { getState, patchSlice } from '../core/state';
import { navigate, homeHash } from '../core/router';
import { saveRegistry, setPin, findWorldByServerId, findLinkedWorld } from '../registry/registry';
import { enqueueActivationTask } from '../core/activation-chain';
import { linkExistingApiWorldInRoot } from '../setup/atlas-root-flow';
import { completeWaypoint } from '../core/waypoints';
import { AccountClient, accountErrorMessage, isAccountAuthError } from './account-client';
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
 * Open an owned account world: mint a key, download into a fresh folder,
 * activate. Collaborator rows never reach here (the sidebar routes them to
 * the link-by-key path — minting is owner-only, server 404s).
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
  let pin = state.registry.pin;
  if (!pin) {
    const entered = await new PinPromptModal().prompt(
      `Opening "${row.name}": atlas needs your OnlyWorlds PIN to sync edits. It is saved in settings for every online world.`
    );
    if (!entered) return false;
    pin = entered;
    const next = setPin(getState().registry, entered);
    saveRegistry(next);
    patchSlice('registry', next);
  }

  patchSlice('accountWorlds', { ...getState().accountWorlds, opening: row.id });
  // Blocking progress overlay (Captain smoke, S260): the mint + download +
  // first folder open take real seconds and previously froze silently.
  const overlay = showLoadingOverlay(`Opening ${row.name}`);
  try {
    // ---- Mint (the one server-side mutation before the download) ----
    overlay.update('Creating an access key…');
    const minted = await new AccountClient(token).mintWorldKey(row.id, deviceKeyName());
    toasts.info(`Created an access key for ${row.name}`);

    // ---- Download + register, serialized on the activation chain (R2) ----
    overlay.update('Waiting for a free slot…');
    const result = await enqueueActivationTask(() =>
      linkExistingApiWorldInRoot({
        where,
        apiKey: minted.key,
        apiPin: pin!,
        displayName: row.name,
        knownWorld: { id: row.id, name: row.name },
        onProgress: (p) => {
          if (p.phase === 'list') {
            overlay.update(`Finding elements${p.currentType ? ` · ${p.currentType}` : ''}…`);
          } else {
            overlay.update(p.total === 0
              ? 'Empty world; finishing up…'
              : `Downloading ${p.done} of ${p.total} elements…`);
          }
        },
      })
    );
    overlay.update('Opening…');

    // ---- Complete the handoff (R5 — parity with LinkWorldModal) ----
    navigate(homeHash(result.entry.id));
    completeWaypoint('ecosystem');
    if (result.failures.length > 0) {
      toasts.error(`Opened ${row.name}. ${result.failures.length} element${result.failures.length === 1 ? '' : 's'} did not download. Refresh from API brings ${result.failures.length === 1 ? 'it' : 'them'}.`);
    } else {
      toasts.success(`Opened ${row.name} · ${result.downloaded} elements`);
    }
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
