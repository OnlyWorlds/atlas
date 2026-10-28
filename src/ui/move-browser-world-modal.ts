/**
 * Move to a folder (1.17, contract §4.2): say what happens, then a
 * LOCKED run with progress. Step 1 runs inside the Move click, which is the
 * gesture the folder picker and the permission prompt need: the home folder
 * made writable, or picked (a picked world folder is refused as a home, lens
 * C W4). The app behind goes `inert` for the run, as for the re-key: nothing
 * may write the world between the copy's verify and the commit.
 */
import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';
import type { WorldRegistryEntry } from '../core/types';
import { getState } from '../core/state';
import { problemFor } from '../core/problems';
import { ATLAS_ROOT_HANDLE_KEY } from '../core/constants';
import { escapeText } from '../core/dom-utils';
import { ensureWritable, loadHandle } from '../store/handle-vault';
import { ensureAtlasRoot } from '../setup/world-doors';
import { moveBrowserWorldToFolder, MOVE_DID_NOT_FINISH } from '../setup/browser-world-move';

function appRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.atlas-shell');
}

function unlockApp(): void {
  appRoot()?.removeAttribute('inert');
}

/** Step 1, inside the click: the home folder, writable. `null`: the user did not give one (already said). */
export async function readyHome(toasts: ToastManager): Promise<{ home: FileSystemDirectoryHandle; hint: string } | null> {
  if (!getState().atlasRoot) {
    const ok = await ensureAtlasRoot(toasts, 'Moving this world puts it in a new folder.', { worldPicked: 'refuse' });
    if (!ok) return null;
  }
  const home = await loadHandle(ATLAS_ROOT_HANDLE_KEY).catch(() => undefined);
  if (!home || !(await ensureWritable(home).catch(() => false))) {
    toasts.info('To move the world there, try again and choose Allow when the browser asks.');
    return null;
  }
  const root = getState().atlasRoot;
  return { home, hint: root?.pathHint ?? root?.folderName ?? home.name };
}

export class MoveBrowserWorldModal extends BaseModal {
  constructor(private readonly world: WorldRegistryEntry, private readonly toasts: ToastManager) {
    super();
  }

  open(): void {
    const w = this.world;
    const root = getState().atlasRoot;
    const { cancel, confirm, progress } = this.shell(`
      <p class="atlas-modal-hint">Atlas copies the world into ${root ? `your OnlyWorlds folder, <code>${escapeText(root.pathHint ?? root.folderName)}</code>` : 'a folder on your drive'}, checks the copy, then removes it from this browser. In the folder, your AI and other tools can work on it.</p>
      ${root ? '' : '<p class="atlas-modal-hint">You pick that folder once; Atlas keeps your worlds in it as plain files.</p>'}`);
    confirm.focus();
    cancel.addEventListener('click', () => this.hide());
    confirm.addEventListener('click', async () => {
      // Locked from the click: readying the home folder can
      // take a dialog, a picker and a permission prompt, and a dialog closed
      // meanwhile must not leave a move running with nothing on screen.
      this.lock(cancel, confirm, true);
      const ready = await readyHome(this.toasts);
      if (!this.modal?.isConnected) return;
      if (!ready) { this.lock(cancel, confirm, false); return; }
      await this.run(ready, { cancel, confirm, progress });
    });
  }

  /**
   * Run the move at once with a home folder already made writable inside an
   * earlier click (opening a world file into a folder, contract §5.2): the
   * same locked run and progress, no confirm. Resolves whether it moved.
   */
  start(
    ready: { home: FileSystemDirectoryHandle; hint: string },
    /** The keep's own sentences (Save it to a folder, contract §7.5): the world is the user's whichever way the move ends. */
    lines: { success?: string; failed?: string } = {},
  ): Promise<boolean> {
    // Already asked (the where-question): a statement, not a question, and no
    // confirm button.
    const { cancel, confirm, progress } = this.shell(
      `<p class="atlas-modal-hint">Atlas copies the world into your OnlyWorlds folder, <code>${escapeText(ready.hint)}</code>, checks the copy, then removes it from this browser.</p>`,
      `Moving "${this.world.name}" to your folder`);
    cancel.addEventListener('click', () => this.hide());
    confirm.hidden = true;
    this.lock(cancel, confirm, true);
    return this.run(ready, { cancel, confirm, progress }, lines);
  }

  private shell(intro: string, title = `Move "${this.world.name}" to a folder?`): { body: HTMLElement; cancel: HTMLButtonElement; confirm: HTMLButtonElement; progress: HTMLElement } {
    const { overlay, body } = this.buildModalShell({ title, dataModal: 'move-browser-world' });
    body.innerHTML = `
      ${intro}
      <div class="atlas-modal-progress" data-role="move-progress" hidden></div>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
        <button type="button" class="atlas-btn-primary" data-action="move-confirm">Move it</button>
      </div>`;
    this.modal = overlay;
    this.show();
    // The app behind goes back to normal whenever the dialog leaves the page.
    const observer = new MutationObserver(() => {
      if (!overlay.isConnected) { observer.disconnect(); unlockApp(); }
    });
    observer.observe(document.body, { childList: true });
    return {
      body,
      cancel: body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!,
      confirm: body.querySelector<HTMLButtonElement>('[data-action="move-confirm"]')!,
      progress: body.querySelector<HTMLElement>('[data-role="move-progress"]')!,
    };
  }

  private lock(cancel: HTMLButtonElement, confirm: HTMLButtonElement, locked: boolean): void {
    confirm.disabled = locked;
    cancel.disabled = locked;
    this.dismissLocked = locked;
  }

  private async run(
    ready: { home: FileSystemDirectoryHandle; hint: string },
    els: { cancel: HTMLButtonElement; confirm: HTMLButtonElement; progress: HTMLElement },
    lines: { success?: string; failed?: string } = {},
  ): Promise<boolean> {
    const w = this.world;
    const { cancel, confirm, progress } = els;
    appRoot()?.setAttribute('inert', '');
    progress.hidden = false;
    progress.textContent = 'Getting the world ready…';
    let outcome: Awaited<ReturnType<typeof moveBrowserWorldToFolder>> | null = null;
    let refusal: unknown = null;
    try {
      outcome = await moveBrowserWorldToFolder(w, {
        home: ready.home,
        homeHint: ready.hint,
        onProgress: (done, total) => { progress.textContent = `Copying: ${done} of ${total} files`; },
      });
    } catch (err) {
      refusal = err;
    }
    unlockApp();
    this.dismissLocked = false;
    if (outcome?.ok) {
      this.hide();
      this.toasts.success((lines.success ?? `"${w.name}" now lives in a folder on your drive: ${outcome.pathHint}.`)
        + (outcome.leftBrowserCopy ? ' Its old copy in this browser is removed the next time Atlas starts.' : ''));
      return true;
    }
    if (outcome && !outcome.ok) console.warn('[atlas:move] did not finish:', outcome.error);
    const err = refusal ?? (outcome as { error: unknown }).error;
    const why = problemFor(err, { doing: 'moving this world to a folder', where: 'folder', folder: 'picked', inline: true }).sentence;
    progress.textContent = lines.failed ? `${lines.failed} ${why}` : refusal ? why : `${MOVE_DID_NOT_FINISH(w.name)} ${why}`;
    cancel.disabled = false;
    cancel.textContent = 'Close';
    confirm.hidden = true;
    cancel.focus();
    return false;
  }
}
