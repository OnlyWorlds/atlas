/**
 * Where a new world goes (1.17, ruling 2, conv. 129; contract §1.4, §2.3).
 *
 * A browser with the folder picker asks every time, folder first and browser
 * second. One without it makes every world in this browser's storage. The
 * home folder is the hydrated `state.atlasRoot` (a registry root whose handle
 * is gone does not count: S370 gate B18).
 */

import { getState } from '../core/state';
import { hasFolderMode, knownOpfsStatus } from '../core/capabilities';
import { isBrowserWorld } from '../core/browser-worlds';
import { loadUiPrefs } from '../core/ui-prefs';

export type WorldWhere = 'folder' | 'browser';

/** The browser row's caption: where the loss model is said before it matters. */
export const WHERE_BROWSER_CAPTION =
  'Only this browser can open it, and clearing its site data (or closing a private window) removes it. You can move it to a folder or download it later.';

/** Said instead of the question on a browser without the folder picker. */
export const WHERE_BROWSER_ONLY_LINE = 'It lives in this browser.';

/**
 * The row the where-question pre-selects (`ui/where-choice.ts`): the home
 * folder when one is set, else the user's last pick, else this browser (and
 * always this browser without the folder picker).
 */
export function defaultWorldWhere(): WorldWhere {
  if (!hasFolderMode()) return 'browser';
  if (getState().atlasRoot) return 'folder';
  // This browser's storage refused or is full: the row that can work (S376 lens C C16).
  const known = knownOpfsStatus();
  if (known === 'refused' || known === 'full') return 'folder';
  return loadUiPrefs().newWorldWhere ?? 'browser';
}

/** Said before Firefox's own storage prompt (contract §2.3). */
export const FIREFOX_PERSIST_NOTE =
  'Firefox will ask whether Atlas may keep data on this device. Allow it so the browser does not clear your worlds when space runs low.';

/**
 * Does this browser keep a world of the user's own? A row the browser
 * cleared is not one it keeps: after an eviction the next make asks again
 * (S376 gate B6). The dialogs' Firefox note asks the same.
 */
export function keepsABrowserWorld(): boolean {
  return getState().registry.worlds.some(w => isBrowserWorld(w) && w.demo !== true && !w.cleared_at);
}

/**
 * Ask the browser to keep this origin's storage. Called synchronously inside
 * the click, before its first await, and never awaited: Firefox shows its own
 * prompt and the promise may never settle. `say`: a door with no dialog to
 * carry the Firefox note says it this way, while the origin is not yet
 * persisted (the Captain's K7, built as my lean pending his ruling: S376).
 */
export function askBrowserToKeepWorlds(say?: (line: string) => void): void {
  const storage = (navigator as unknown as { storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> } }).storage;
  if (typeof storage?.persist !== 'function') return;
  void storage.persist().catch(() => {});
  if (say && /firefox/i.test(navigator.userAgent) && typeof storage.persisted === 'function') {
    void storage.persisted().then(kept => { if (!kept) say(FIREFOX_PERSIST_NOTE); }).catch(() => {});
  }
}

/**
 * The same, inside the click that makes the FIRST browser world of the
 * user's own (S365 direction, gate B21).
 */
export function requestPersistOnFirstBrowserWorld(say?: (line: string) => void): void {
  if (keepsABrowserWorld()) return;
  askBrowserToKeepWorlds(say);
}
