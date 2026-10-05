/**
 * Where a new world goes (1.17, ruling 2, conv. 129; contract §1.4, §2.3).
 *
 * A browser with the folder picker asks every time, folder first and browser
 * second. One without it makes every world in this browser's storage. The
 * home folder is the hydrated `state.atlasRoot` (a registry root whose handle
 * is gone does not count: S370 gate B18).
 */

import { getState } from '../core/state';
import { hasFolderMode } from '../core/capabilities';
import { isBrowserWorld } from '../core/browser-worlds';
import { loadUiPrefs } from '../core/ui-prefs';

export type WorldWhere = 'folder' | 'browser';

/** The browser row's caption: where the loss model is said before it matters. */
export const WHERE_BROWSER_CAPTION =
  'Nothing to pick. Only this browser can open it, and clearing its site data (or closing a private window) removes it. You can move it to a folder or download it later.';

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
  return loadUiPrefs().newWorldWhere ?? 'browser';
}

/**
 * Ask the browser to keep this origin's storage, inside the click that makes
 * the FIRST browser world of the user's own (S365 direction, gate B21). Called
 * synchronously before the click's first await and never awaited: Firefox
 * shows its own prompt and the promise may never settle.
 */
export function requestPersistOnFirstBrowserWorld(): void {
  const hasOne = getState().registry.worlds.some(w => isBrowserWorld(w) && w.demo !== true);
  if (hasOne) return;
  const storage = (navigator as unknown as { storage?: { persist?: () => Promise<boolean> } }).storage;
  if (typeof storage?.persist !== 'function') return;
  void storage.persist().catch(() => {});
}
