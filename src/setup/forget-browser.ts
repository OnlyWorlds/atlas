/**
 * Fully forget (Atlas #140): remove everything Atlas keeps in this browser,
 * so a reload is a first visit. Folders on the drive and worlds on
 * onlyworlds.com are never touched.
 *
 * What goes, all of it this origin's alone (atlas.onlyworlds.com hosts only
 * Atlas): the worlds kept in this browser (OPFS), the remembered folders
 * (the handle vault, Atlas's one IndexedDB), and localStorage and
 * sessionStorage (the registry, the PIN, the account sign-in, settings,
 * waypoints, the tour). The app's own cached files stay: they are the app.
 *
 * The order is the gate (craft: every failure leaves a state; name it):
 * 1. Another open Atlas tab would write its registry back after the clear,
 *    so the forget refuses while one answers (`otherAtlasTabs`).
 * 2. The open world is left the normal way first, so a folder world's
 *    unsaved room lands on the drive (`releasePriorWorld`).
 * 3. OPFS goes before the registry: if a removal fails, nothing else is
 *    cleared, the registry still names every world, and a browser world
 *    whose directory went reads as cleared, the state Atlas already shows.
 *    The reverse order would leave directories the next boot re-adopts.
 * 4. Then the vault, then the two storages, then a reload with no hash.
 */

import { HANDLE_VAULT_DB } from '../core/constants';
import { PlainError } from '../core/plain-error';
import { BROWSER_HOME, isBrowserWorld } from '../core/browser-worlds';
import type { WorldsRegistry } from '../core/types';
import { heldSeats } from '../core/held-seats';
import { getState } from '../core/state';
import { mintedTokenId } from '../registry/registry';
import { revokeAtlasToken } from '../sync/token-revoke';
import { mintedKeyId, takeBackMintedKey } from '../sync/key-takeback';

const CHANNEL = 'atlas-forget';
/** This tab: a channel hears other channel objects in its own tab too, so messages carry who sent them. */
const TAB = crypto.randomUUID();

/** What the confirm screen names. */
export interface ForgetInventory {
  /** Worlds in this browser that exist nowhere else: gone for good. */
  browserOnly: string[];
  /** Worlds in this browser that are online: onlyworlds.com keeps what reached it, not changes still waiting to sync. */
  browserOnline: string[];
  /** Worlds in folders on the drive: they stay; Atlas forgets where they are. */
  folderWorlds: number;
  /** Worlds on a seat: the seat's secret goes, and they come back only through onlyworlds.com. */
  seatWorlds: number;
  /** Seats a link left held, never downloaded: the record goes, the seat stays on keel. */
  heldSeats: string[];
}

export function forgetInventory(reg: WorldsRegistry): ForgetInventory {
  // `demo` marks the tour's world (Hyperion), which Atlas makes again; a
  // 1.16 tour world sat at the OPFS root with no `where`, so it is never
  // counted as a folder on the drive.
  const inBrowser = reg.worlds.filter(w => isBrowserWorld(w) && !w.cleared_at && w.demo !== true);
  return {
    browserOnly: inBrowser.filter(w => w.state !== 'api-linked').map(w => w.name),
    browserOnline: inBrowser.filter(w => w.state === 'api-linked').map(w => w.name),
    folderWorlds: reg.worlds.filter(w => !isBrowserWorld(w) && w.demo !== true).length,
    seatWorlds: reg.worlds.filter(w => !!w.api?.seat).length,
    heldSeats: heldSeats(reg).map(h => h.world_name || 'Untitled world'),
  };
}

let presence: BroadcastChannel | null = null;

/**
 * Every Atlas tab answers a forget's roll call, and reloads when another tab
 * has forgotten (its memory would otherwise write the registry back).
 */
export function installForgetPresence(): () => void {
  if (typeof BroadcastChannel === 'undefined' || presence) return () => {};
  presence = new BroadcastChannel(CHANNEL);
  const me = presence;
  me.onmessage = (e: MessageEvent) => {
    const msg = e.data as { kind?: string; id?: string; from?: string } | null;
    if (!msg || msg.from === TAB) return;
    if (msg.kind === 'here?') me.postMessage({ kind: 'here', id: msg.id, from: TAB });
    else if (msg.kind === 'forgotten') location.replace(location.pathname);
  };
  return () => { me.close(); if (presence === me) presence = null; };
}

/** How many other Atlas tabs in this browser answer within `waitMs`. */
export async function otherAtlasTabs(waitMs = 400): Promise<number> {
  if (typeof BroadcastChannel === 'undefined') return 0;
  const ch = new BroadcastChannel(CHANNEL);
  const id = crypto.randomUUID();
  let n = 0;
  ch.onmessage = (e: MessageEvent) => {
    const msg = e.data as { kind?: string; id?: string; from?: string } | null;
    if (msg?.kind === 'here' && msg.id === id && msg.from !== TAB) n++;
  };
  ch.postMessage({ kind: 'here?', id, from: TAB });
  await new Promise(r => setTimeout(r, waitMs));
  ch.close();
  return n;
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Another connection holds it open: the delete completes when it closes,
    // and nothing in Atlas keeps one open (each vault call closes its own).
    req.onblocked = () => resolve();
  });
}

const BUSY_RETRY_MS = [150, 400, 1000, 2000];

export const FORGET_PARTIAL_LINE =
  'Atlas could not remove everything kept in this browser, so it stopped before clearing its settings and the list of worlds. Reload the page, close every other Atlas tab, and try again.';

/**
 * Remove it all, then reload. The caller has confirmed, run the roll call,
 * and left the open world (`releasePriorWorld`, after detaching sync).
 */
export async function forgetEverything(deps: {
  opfsRoot?: () => Promise<FileSystemDirectoryHandle>;
  reload?: () => void;
  wait?: (ms: number) => Promise<void>;
  revoke?: (token: string, tokenId: string) => Promise<unknown>;
} = {}): Promise<void> {
  // 3. OPFS first, every entry under the origin's root. The worlds' home goes
  // LAST: a failure on a stray entry then leaves every world where it was,
  // not all of them gone with the registry still naming them.
  // A directory a just-closed store still holds is busy for a moment: retry.
  const wait = deps.wait ?? ((ms: number) => new Promise(r => setTimeout(r, ms)));
  try {
    const root = await (deps.opfsRoot ?? (() => navigator.storage.getDirectory()))();
    const names: string[] = [];
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    names.sort((a, b) => Number(a === BROWSER_HOME) - Number(b === BROWSER_HOME));
    for (const name of names) {
      for (let attempt = 0; ; attempt++) {
        try { await root.removeEntry(name, { recursive: true }); break; } catch (err) {
          if ((err as { name?: string })?.name !== 'NoModificationAllowedError' || attempt >= BUSY_RETRY_MS.length) throw err;
          await wait(BUSY_RETRY_MS[attempt]);
        }
      }
    }
  } catch (err) {
    console.warn('[forget] removing browser storage failed:', err);
    throw new PlainError(FORGET_PARTIAL_LINE);
  }
  // 4. The vault, then the storages.
  const names = new Set<string>([HANDLE_VAULT_DB]);
  try {
    for (const d of (await indexedDB.databases?.()) ?? []) if (d.name) names.add(d.name);
  } catch { /* databases() missing: the vault is Atlas's one database */ }
  for (const name of names) await deleteDatabase(name).catch(err => console.warn('[forget] could not delete', name, err));
  // 5. The keys Atlas minted for the browser worlds now gone are taken back
  // (#814), before the token that can revoke them, and before the registry
  // that holds their records (their files are in this browser alone, so no
  // copy uses them). Each is best effort and does not stop the forget.
  // Concurrently, so a batch of offline revokes is bounded by one 8 s limit,
  // not their sum (#814 gate G5). Folder worlds are skipped inside the call.
  await Promise.all(getState().registry.worlds.filter(w => mintedKeyId(w)).map(w => takeBackMintedKey(w)));
  // 6. A token Atlas minted is revoked here, after everything that can stop
  // the forget and right before the registry goes: a forget that stopped
  // earlier keeps a working token, never a revoked one.
  // Its outcome does not stop the forget.
  const token = getState().registry.account_token;
  const tokenId = mintedTokenId(getState().registry);
  if (token && tokenId) await (deps.revoke ?? revokeAtlasToken)(token, tokenId).catch(() => {});
  localStorage.clear();
  sessionStorage.clear();
  // Closed after the post: a message already posted is still delivered, and
  // an open channel left behind receives every later roll call (in the
  // one-process test run it took the next test's and threw there).
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ kind: 'forgotten', from: TAB });
    ch.close();
  } catch { /* no other tab to tell */ }
  (deps.reload ?? (() => location.replace(location.pathname)))();
}
