/**
 * The where-question (1.17, ruling 2, conv. 129; contract §1.4, §2.3, §9
 * invariant 12): every dialog that makes a world or brings one down asks it
 * the same way. With the folder picker: two rows, the folder first (pre-
 * selected when a home folder is set, and showing its path; else the user's
 * last pick decides). Without it: one line, "It lives in this browser.", and
 * on Firefox a note about its storage prompt while nothing is persisted yet.
 *
 * The answer is taken in two steps because of the gesture rules:
 * `takeWhereInClick` runs synchronously in the submit handler, before its
 * first await (it asks `persist()`, which must be inside the gesture);
 * `readyWhere` then checks the browser can hold a world here, or asks for a
 * home folder when the folder row was chosen without one.
 */

import { getState } from '../core/state';
import { hasFolderMode, opfsStatus, NO_BROWSER_STORAGE_LINE } from '../core/capabilities';
import { browserStorageFullSentence } from '../core/problems';
import { escapeText } from '../core/dom-utils';
import { isBrowserWorld } from '../core/browser-worlds';
import { setNewWorldWherePref } from '../core/ui-prefs';
import {
  defaultWorldWhere,
  requestPersistOnFirstBrowserWorld,
  keepsABrowserWorld,
  FIREFOX_PERSIST_NOTE,
  WHERE_BROWSER_CAPTION,
  WHERE_BROWSER_ONLY_LINE,
  type WorldWhere,
} from '../setup/world-parent';
import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';

/** Why this window cannot hold a world in its storage, in a sentence; null when it can. */
async function browserStorageProblem(doing: string): Promise<string | null> {
  const status = await opfsStatus();
  if (status === 'ok') return null;
  return status === 'full' ? browserStorageFullSentence(doing) : NO_BROWSER_STORAGE_LINE;
}

/** Firefox's own storage prompt, explained before it appears (contract §2.3, lens C R6-c). */
export { FIREFOX_PERSIST_NOTE };

/** The question's markup: the two rows, or the browser-only line. */
export function whereChoiceHtml(): string {
  if (!hasFolderMode()) {
    return `<p class="atlas-modal-hint" data-role="where-browser">${WHERE_BROWSER_ONLY_LINE}</p>
      <p class="atlas-modal-hint" data-role="persist-note" hidden>${FIREFOX_PERSIST_NOTE}</p>`;
  }
  const root = getState().atlasRoot;
  const rootDisplay = root?.pathHint ?? root?.folderName;
  const preselect = defaultWorldWhere();
  return `<fieldset class="atlas-where-choice" data-role="where">
      <legend>Where should this world live?</legend>
      <label class="atlas-where-row">
        <input type="radio" name="where" value="folder" ${preselect === 'folder' ? 'checked' : ''} />
        <span><strong>In a folder on your drive (your AI can work on it)</strong>
        <span>${rootDisplay ? `In <code>${escapeText(rootDisplay)}</code>` : 'Pick a folder once; Atlas keeps your new worlds in it as plain files.'}</span></span>
      </label>
      <label class="atlas-where-row">
        <input type="radio" name="where" value="browser" ${preselect === 'browser' ? 'checked' : ''} />
        <span><strong>In this browser</strong><span>${WHERE_BROWSER_CAPTION}</span></span>
      </label>
    </fieldset>`;
}

/**
 * After the markup is in the page: show the Firefox note while this origin is
 * not persisted and no world of the user's own lives in this browser yet (the
 * prompt comes with the first one).
 */
export function wireWhereChoice(root: ParentNode): void {
  const note = root.querySelector<HTMLElement>('[data-role="persist-note"]');
  if (!note || !/firefox/i.test(navigator.userAgent)) return;
  if (keepsABrowserWorld()) return;
  const storage = (navigator as unknown as { storage?: { persisted?: () => Promise<boolean> } }).storage;
  if (typeof storage?.persisted !== 'function') return;
  void storage.persisted().then(kept => { note.hidden = kept; }).catch(() => {});
}

/** Disable or enable the rows while the dialog works. */
export function lockWhereChoice(root: ParentNode, locked: boolean): void {
  root.querySelectorAll<HTMLInputElement>('input[name="where"]').forEach(i => { i.disabled = locked; });
}

/**
 * Read the answer, SYNCHRONOUSLY, inside the click and before its first
 * await: a browser answer asks the browser to keep worlds (never awaited),
 * and the pick is remembered for the next dialog.
 */
export function takeWhereInClick(root: ParentNode): WorldWhere {
  if (!hasFolderMode()) {
    requestPersistOnFirstBrowserWorld();
    return 'browser';
  }
  const picked = root.querySelector<HTMLInputElement>('input[name="where"]:checked')?.value;
  const where: WorldWhere = picked === 'folder' ? 'folder' : 'browser';
  if (where === 'browser') requestPersistOnFirstBrowserWorld();
  setNewWorldWherePref(where);
  return where;
}

/**
 * Make the chosen place ready: `true` to go on, `false` when the user
 * cancelled the home-folder step (nothing to say), or a sentence to show.
 */
export async function readyWhere(where: WorldWhere, toasts: ToastManager, purpose: string): Promise<true | false | string> {
  if (where === 'browser') return (await browserStorageProblem('making the world')) ?? true;
  if (getState().atlasRoot) return true;
  const { ensureAtlasRoot } = await import('../setup/world-doors');
  return ensureAtlasRoot(toasts, purpose);
}

/**
 * The question as its own small step, for a door with no dialog of its own
 * (the account row's open, import as new: contract §1.4, lens C R2-d).
 * Resolves the ready place, or null when the user cancelled or the place
 * cannot hold a world (said in a toast). Call it before the caller's first
 * await: without the folder picker it asks `persist()` at once.
 */
export async function askWhere(opts: { title: string; action: string; purpose: string; toasts: ToastManager }): Promise<WorldWhere | null> {
  if (!hasFolderMode()) {
    requestPersistOnFirstBrowserWorld();
    const problem = await browserStorageProblem('making the world');
    if (!problem) return 'browser';
    opts.toasts.error(problem);
    return null;
  }
  return (await new WhereAskModal().ask(opts))?.where ?? null;
}

/** A browser answer, or a folder answer with the home folder made writable inside the click. */
export type WhereWithHome =
  | { where: 'browser' }
  | { where: 'folder'; home: FileSystemDirectoryHandle; hint: string };

/**
 * The question for a world that lands in this browser first and then moves to
 * the home folder (opening a world file, contract §5.2: the unpack, then the
 * §4 move). A folder answer makes the home folder writable INSIDE the answer's
 * click, the gesture the permission prompt needs, so the move can run later
 * without one. For a browser with the folder picker; null when cancelled.
 */
export async function askWhereWithHome(opts: { title: string; action: string; purpose: string; toasts: ToastManager }): Promise<WhereWithHome | null> {
  const answer = await new WhereAskModal().ask({ ...opts, withHome: true });
  if (!answer) return null;
  return answer.where === 'folder' && answer.home
    ? { where: 'folder', home: answer.home, hint: answer.hint ?? answer.home.name }
    : { where: 'browser' };
}

/** The home folder, writable, from inside a click; a sentence when it cannot be. */
async function writableHome(): Promise<{ home: FileSystemDirectoryHandle; hint: string } | string> {
  const { loadHandle, ensureWritable } = await import('../store/handle-vault');
  const { ATLAS_ROOT_HANDLE_KEY } = await import('../core/constants');
  const home = await loadHandle(ATLAS_ROOT_HANDLE_KEY).catch(() => undefined);
  if (!home || !(await ensureWritable(home).catch(() => false))) {
    return 'Atlas needs to be allowed to change your OnlyWorlds folder to put the world there. Allow it, or choose this browser.';
  }
  const root = getState().atlasRoot;
  return { home, hint: root?.pathHint ?? root?.folderName ?? home.name };
}

interface WhereAnswer { where: WorldWhere; home?: FileSystemDirectoryHandle; hint?: string }

class WhereAskModal extends BaseModal {
  private resolve: ((answer: WhereAnswer | null) => void) | null = null;

  ask(opts: { title: string; action: string; purpose: string; toasts: ToastManager; withHome?: boolean }): Promise<WhereAnswer | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      const { overlay, body } = this.buildModalShell({ title: opts.title, dataModal: 'where-ask' });
      body.innerHTML = `
        <form data-form="where-ask">
          ${whereChoiceHtml()}
          <div class="atlas-modal-error" data-role="error" hidden></div>
          <div class="atlas-modal-actions">
            <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="atlas-btn-primary" data-action="go">${escapeText(opts.action)}</button>
          </div>
        </form>`;
      const form = body.querySelector<HTMLFormElement>('form')!;
      const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
      body.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.settle(null));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.hidden = true;
        const where = takeWhereInClick(form);
        const ready = await readyWhere(where, opts.toasts, opts.purpose);
        if (ready !== true) {
          errorBox.textContent = ready || '';
          errorBox.hidden = !ready;
          return;
        }
        if (where === 'folder' && opts.withHome) {
          const home = await writableHome();
          if (typeof home === 'string') {
            errorBox.textContent = home;
            errorBox.hidden = false;
            return;
          }
          this.settle({ where, ...home });
          return;
        }
        this.settle({ where });
      });
      this.modal = overlay;
      this.show();
      queueMicrotask(() => body.querySelector<HTMLButtonElement>('[data-action="go"]')?.focus());
    });
  }

  private settle(answer: WhereAnswer | null): void {
    const r = this.resolve;
    this.resolve = null;
    this.hide();
    r?.(answer);
  }

  protected hide(): void {
    super.hide();
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(null);
    }
  }
}
