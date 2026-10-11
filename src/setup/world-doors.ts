/**
 * THE WORLD DOORS (S365): the one place that opens a world folder the user
 * picked, and the one place that asks for a home folder (the atlas root)
 * when an action needs one.
 *
 * Why this exists: the OnlyWorlds toolkit tells people "open Atlas and pick
 * the world folder your AI made". On a first visit Atlas had only "set up a
 * folder", and picking a world there answered with a hint naming a sidebar
 * button that was not on screen yet. A world folder now opens in place from
 * any door, with or without a root; a root is asked for only when the user
 * first makes a NEW world (or brings one down from onlyworlds.com), because
 * that is the only thing it is for. The File System Access API cannot hand
 * us a picked folder's parent, so "use the folder it sits in" is not an
 * option, and asking for a second folder right after the first is a question
 * the user cannot answer yet.
 *
 * Every door routes here: the landing's "open a world folder", the three
 * setup doors (landing, recover screen, Settings → Storage) when their pick
 * turns out to be a world, the sidebar's open-folder button, Ctrl+K.
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, deleteWorldEntry } from '../registry/registry';
import { deleteHandle } from '../store/handle-vault';
import { BaseModal } from '../ui/modal-base';
import { NO_FOLDER_PICKER_LINE, PICKER_CANCELLED_HINT } from '../ui/directory-picker';
import { browserStorageDoorOpen, hasFolderMode } from '../core/capabilities';
import { completeWaypoint } from '../core/waypoints';
import { pickWorldFile, openWorldFileFrom, openDemoWorld } from '../ui/open-world-file';
import { PlainError } from '../core/plain-error';
import { isTourFlagActive } from '../tour/tour-flag';
import { requestPersistOnFirstBrowserWorld } from './world-parent';
import type { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import {
  openWorldFolder, isWorldFolder, isAtlasRootFolder, setupAtlasRoot, setupAtlasRootFrom,
  type SetupAtlasRootResult,
} from './atlas-root-flow';

type Toasts = Pick<ToastManager, 'info' | 'success' | 'error'>;

/**
 * Open a picked world folder in place and activate it. A folder registered
 * just now whose first open fails is taken off the list again, so it does
 * not sit there unopenable (the S309 close-gate rollback, lifted here from
 * the sidebar). Returns true when the world became active.
 */
export async function openPickedWorld(picked: FileSystemDirectoryHandle, toasts: Toasts, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const { worldId, already } = await openWorldFolder(picked);
  // The WORLD's name, not the folder's (S365 gate lens C L11): it is the first
  // thing a toolkit arrival reads.
  const name = getState().registry.worlds.find(w => w.id === worldId)?.name || picked.name;
  if (opts.quiet) { /* the caller says what happened, once (lens C L10) */ }
  else if (already) toasts.info(`"${name}" is already in Atlas. Opening it`);
  else toasts.success(`Opened "${name}" in place. Its folder stays where it is`);
  const { activateWorld } = await import('../sidebar/worlds-sidebar');
  const ok = await activateWorld(worldId, toasts as ToastManager);
  // Opening a world folder is a first world too (1.17, contract §6.2).
  if (ok && !already) completeWaypoint('first-world');
  if (!ok && !already && getState().active?.worldId !== worldId) {
    const entry = getState().registry.worlds.find(w => w.id === worldId);
    if (entry) {
      await deleteHandle(entry.folder.handle_key).catch(() => {});
      const cleaned = deleteWorldEntry(getState().registry, worldId);
      saveRegistry(cleaned);
      patchSlice('registry', cleaned);
      toasts.info('Removed the folder from the list: it could not be opened');
    }
  }
  return ok;
}

/** The toast a finished root setup says, from any door. */
export function sayRootSetUp(result: SetupAtlasRootResult, toasts: Toasts, verb = 'set up'): void {
  toasts.success(
    result.imported > 0
      ? `OnlyWorlds folder ${verb}: found ${result.imported} existing world${result.imported === 1 ? '' : 's'}`
      : `OnlyWorlds folder ${verb === 'set up' ? 'is set up' : verb}`,
  );
}

/**
 * "Open a world folder": pick, then act on what was picked. A world opens in
 * place. A folder that KEEPS worlds (an atlas root, or one holding the
 * wrapper) is the other door's thing, and the door recognises it rather than
 * refusing: it becomes the home folder and its worlds appear. Anything else
 * gets the plain reason.
 */
export async function pickAndOpenWorldFolder(toasts: Toasts): Promise<void> {
  let picked: FileSystemDirectoryHandle | null;
  try {
    const { pickDirectory } = await import('../ui/directory-picker');
    picked = await pickDirectory();
  } catch (err) {
    console.warn('[world-doors] folder pick failed:', err);
    showProblem(err, { doing: 'choosing a folder', folder: 'picked', toasts: toasts as ToastManager });
    return;
  }
  if (!picked) {
    toasts.info(PICKER_CANCELLED_HINT);
    return;
  }
  try {
    if (await isWorldFolder(picked)) {
      await openPickedWorld(picked, toasts);
      return;
    }
    if (await isAtlasRootFolder(picked)) {
      // A folder that keeps worlds. With a home folder already set, this door
      // never switches it: that is Settings' deliberate "Change folder"
      // (S365 gate lens B F9 / C M6). Without one, it becomes the home folder,
      // and the toast says so rather than "is set up".
      if (getState().atlasRoot) {
        toasts.info('That folder keeps worlds rather than being one. To make it your OnlyWorlds folder, use Settings, then Storage.');
        return;
      }
      const result = await setupAtlasRootFrom(picked);
      toasts.success(result.imported > 0
        ? `That folder keeps worlds, so Atlas now uses it for new ones: found ${result.imported} world${result.imported === 1 ? '' : 's'}`
        : 'That folder keeps worlds, so Atlas now uses it for new ones');
      return;
    }
    // A folder of world folders with no home-folder marker (a toolkit user's
    // "worlds" folder): say what is in it (S365 gate lens B F7).
    const inside = await countWorldFoldersIn(picked);
    if (inside > 0) {
      toasts.info(`That folder holds ${inside} world${inside === 1 ? '' : 's'}. To open one, pick its own folder.`);
      return;
    }
    // Not a world and not a home folder: openWorldFolder says why, plainly.
    await openPickedWorld(picked, toasts);
  } catch (err) {
    // A refusal ("That folder is not a world") arrives as a PlainError and
    // reads as itself; anything else is worded (S369).
    console.warn('[world-doors] open world folder failed:', err);
    showProblem(err, { doing: 'opening the world folder', folder: 'picked', toasts: toasts as ToastManager });
  }
}

/** How many direct subfolders of `dir` are worlds (hold a world.json with an id). */
async function countWorldFoldersIn(dir: FileSystemDirectoryHandle): Promise<number> {
  let n = 0;
  try {
    for await (const entry of (dir as unknown as { values(): AsyncIterable<FileSystemHandle> }).values()) {
      if (entry.kind === 'directory' && !entry.name.startsWith('.') && await isWorldFolder(entry as FileSystemDirectoryHandle)) n++;
    }
  } catch { /* unreadable: say nothing more than the plain reason */ }
  return n;
}

/**
 * What a setup door does with its result: a world pick opens in place, a
 * root pick says what it found, a cancel says so.
 */
export async function finishSetupDoor(result: SetupAtlasRootResult | null, toasts: Toasts, verb = 'set up'): Promise<void> {
  if (result?.worldFolder) {
    await openPickedWorld(result.worldFolder, toasts);
  } else if (result) {
    sayRootSetUp(result, toasts, verb);
  } else {
    toasts.info(PICKER_CANCELLED_HINT);
  }
}

/**
 * Make sure there is a home folder before an action that creates a world in
 * it. With one, resolves true at once. Without one (a world was opened in
 * place on a first visit), a small dialog says why and lets the user choose;
 * the picker runs inside that click, which is the gesture it needs. Resolves
 * true only when a home folder now exists.
 */
export async function ensureAtlasRoot(
  toasts: Toasts,
  purpose: string,
  opts: { worldPicked?: 'open' | 'refuse' } = {},
): Promise<boolean> {
  if (getState().atlasRoot) return true;
  const go = await new HomeFolderModal().ask(purpose);
  if (!go) return false;
  try {
    const result = await setupAtlasRoot();
    if (!result) {
      toasts.info(PICKER_CANCELLED_HINT);
      return false;
    }
    if (result.worldFolder && opts.worldPicked === 'refuse') {
      // Moving a world (1.17, lens C W4): opening the picked world here would
      // leave the world being moved.
      toasts.info('That folder is a world. Pick the folder where Atlas should keep worlds, not a world itself.');
      return false;
    }
    if (result.worldFolder) {
      // A world is not a place to keep worlds: open it, and let the user
      // come back to the new-world action when they want a home folder.
      await openPickedWorld(result.worldFolder, toasts, { quiet: true });
      toasts.info('That was a world folder, so Atlas opened it. New worlds still need a folder to live in');
      return false;
    }
    sayRootSetUp(result, toasts);
    return !!getState().atlasRoot;
  } catch (err) {
    console.warn('[world-doors] home folder setup failed:', err);
    showProblem(err, { doing: 'setting up your OnlyWorlds folder', folder: 'picked', toasts: toasts as ToastManager });
    return false;
  }
}

/** The ways into a world, named by the sidebar buttons' `data-action` (and the chooser's sixth row, a world file). */
export type AddWorldAction = 'create-local' | 'open-folder' | 'new-api' | 'link-api' | 'view-api' | 'open-file' | 'try-demo';

/**
 * The Start page's links (#127): `#/start` and `#/bring-in` open the
 * start-a-world dialog; the world it makes counts as answered, and
 * `bring-in` lands in its Data room.
 */
export async function startWorldFromLink(then: 'home' | 'bring-in', toasts: ToastManager): Promise<void> {
  if (isTourFlagActive()) {
    toasts.info('That is yours to use after the tour.');
    return;
  }
  const { CreateWorldModal } = await import('../ui/create-world-modal');
  new CreateWorldModal(toasts, undefined, undefined, { then }).open();
}

/** Run one way into a world, from any surface (the icon row, the chooser, Ctrl+K). */
export async function runAddWorldAction(action: AddWorldAction, toasts: ToastManager): Promise<void> {
  // Backstop: the tour owns the world list while it runs (S365 gate lens B F5).
  if (isTourFlagActive()) {
    toasts.info('That is yours to use after the tour.');
    return;
  }
  if (action === 'open-file') {
    // The file picker opens inside this click, before any await (1.17, contract §5.2),
    // and a file that lands in this browser is a browser world: ask the browser
    // to keep worlds while the gesture is live (§2.3, invariant 10; S374 gate F8).
    requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000));
    const file = await pickWorldFile();
    if (file) await openWorldFileFrom(file, toasts);
    return;
  }
  if (action === 'try-demo') {
    // A copy of the demo world lands in this browser like a world file (#113).
    requestPersistOnFirstBrowserWorld(line => toasts.info(line, 10_000));
    await openDemoWorld(toasts);
    return;
  }
  if (action === 'open-folder') {
    // Folder-only (conv. 129): the door is hidden where the picker is missing;
    // this is the backstop, said plainly rather than as a bug.
    if (!hasFolderMode()) {
      showProblem(new PlainError(NO_FOLDER_PICKER_LINE), { doing: 'choosing a folder', folder: 'picked', toasts });
      return;
    }
    await pickAndOpenWorldFolder(toasts);
    return;
  }
  // Where it goes (1.17, conv. 129): each dialog asks the where-question
  // (`ui/where-choice.ts`) and asks for a home folder only when the folder is
  // the answer and none is set.
  if (action === 'create-local') {
    const { CreateWorldModal } = await import('../ui/create-world-modal');
    new CreateWorldModal(toasts).open();
  } else if (action === 'new-api') {
    const { NewApiWorldModal } = await import('../ui/new-api-world-modal');
    new NewApiWorldModal(toasts).open();
  } else if (action === 'link-api') {
    const { LinkWorldModal } = await import('../ui/link-world-modal');
    new LinkWorldModal(toasts).open();
  } else {
    const { ViewWorldModal } = await import('../ui/view-world-modal');
    new ViewWorldModal(toasts).open();
  }
}

/**
 * The new-world door's glyph: never a folder, since the world may live in this
 * browser (S376 lens C C6). Without the folder picker it is the browser
 * world's own glyph; with it, a world.
 */
export function newWorldGlyph(): string {
  return hasFolderMode() ? 'public' : 'web';
}

/** The chooser's rows: the icon row's five, said in words (S365). */
const CHOICES: Array<{ action: AddWorldAction; icon: string; title: string; line: string; /** Said instead without the folder picker. */ browserOnlyLine?: string }> = [
  { action: 'create-local', get icon() { return newWorldGlyph(); }, title: 'Start a world', line: 'Plain files, in a folder on your drive or in this browser. Works offline; take it online any time.', browserOnlyLine: 'Plain files, in this browser. Works offline; take it online any time.' },
  { action: 'open-folder', icon: 'folder_open', title: 'Open a world folder', line: 'One you already have, from Atlas, another tool, or your AI. It opens where it is; nothing is copied.' },
  { action: 'new-api', icon: 'cloud_upload', title: 'New world on OnlyWorlds', line: 'Created on onlyworlds.com and here, synced from the start. Needs a free account.' },
  { action: 'link-api', icon: 'link', title: 'Download a world from OnlyWorlds', line: 'Its API key and PIN: Atlas downloads a full copy and keeps the two in sync.' },
  { action: 'view-api', icon: 'visibility', title: 'View a shared world', line: 'Someone gave you a read key: browse their world, view only. No PIN needed.' },
  { action: 'open-file', icon: 'file_open', title: 'Open a world file', line: 'A world file Atlas saved, from this or any other browser.' },
  { action: 'try-demo', icon: 'explore', title: 'Explore Moppetopia', line: 'The demo world, as your own copy in this browser to explore and change. Nothing goes back to OnlyWorlds.' },
];

/**
 * The plain name of one way in: the chooser row's title, and the accessible
 * name of the sidebar icon button for the same action (S369), so a screen
 * reader hears the same words the chooser shows.
 */
export function addWorldLabel(action: AddWorldAction): string {
  return CHOICES.find(c => c.action === action)?.title ?? 'Add a world';
}

/** "Add a world": the five ways in, as plain rows. */
export function openAddWorldChooser(toasts: ToastManager): void {
  if (isTourFlagActive()) {
    toasts.info('That is yours to use after the tour.');
    return;
  }
  new AddWorldChooser(toasts).open();
}

class AddWorldChooser extends BaseModal {
  constructor(private readonly toasts: ToastManager) { super(); }

  open(): void {
    const { overlay, body } = this.buildModalShell({ title: 'Add a world', dataModal: 'add-world' });
    const needsStorage = (a: AddWorldAction): boolean => a === 'open-file' || a === 'try-demo';
    const rows = CHOICES.filter(c => (c.action !== 'open-folder' || hasFolderMode()) && (!needsStorage(c.action) || browserStorageDoorOpen()));
    body.innerHTML = `<div class="atlas-add-world-list">${rows.map(c => `
      <button type="button" class="atlas-add-world-row" data-choice="${c.action}">
        <span class="material-symbols-outlined atlas-add-world-icon" aria-hidden="true">${c.icon}</span>
        <span class="atlas-add-world-text"><strong>${c.title}</strong><span>${!hasFolderMode() && c.browserOnlyLine ? c.browserOnlyLine : c.line}</span></span>
      </button>`).join('')}</div>`;
    body.querySelectorAll<HTMLButtonElement>('[data-choice]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-choice') as AddWorldAction;
        this.hide();
        void runAddWorldAction(action, this.toasts);
      });
    });
    this.modal = overlay;
    this.show();
    queueMicrotask(() => body.querySelector<HTMLButtonElement>('[data-choice]')?.focus());
  }
}

/** The one question: where do new worlds live? Resolves true on "Choose a folder". */
class HomeFolderModal extends BaseModal {
  private resolve: ((go: boolean) => void) | null = null;

  ask(purpose: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      const { overlay, body } = this.buildModalShell({
        title: 'Where should Atlas keep worlds?',
        dataModal: 'home-folder',
      });
      body.innerHTML = `
        <p class="atlas-modal-hint" data-role="purpose"></p>
        <p class="atlas-modal-hint">Atlas keeps each world it makes or downloads in one folder you choose, inside an <code>onlyworlds-atlas</code> folder there. Worlds you opened from their own folder stay put.</p>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="button" class="atlas-btn-primary" data-action="choose">Choose a folder</button>
        </div>
      `;
      body.querySelector<HTMLElement>('[data-role="purpose"]')!.textContent = purpose;
      body.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.settle(false));
      body.querySelector('[data-action="choose"]')?.addEventListener('click', () => this.settle(true));
      this.modal = overlay;
      this.show();
      queueMicrotask(() => body.querySelector<HTMLButtonElement>('[data-action="choose"]')?.focus());
    });
  }

  private settle(go: boolean): void {
    const r = this.resolve;
    this.resolve = null;
    this.hide();
    r?.(go);
  }

  protected hide(): void {
    super.hide();
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(false);
    }
  }
}
