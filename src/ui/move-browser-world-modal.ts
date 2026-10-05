/**
 * Move to a folder (1.17 bout 4, contract §4.2): say what happens, then a
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
import { completeWaypoint } from '../core/waypoints';

function appRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.atlas-shell');
}

/** Step 1, inside the click: the home folder, writable. `null`: the user did not give one (already said). */
async function readyHome(toasts: ToastManager): Promise<{ home: FileSystemDirectoryHandle; hint: string } | null> {
  if (!getState().atlasRoot) {
    const ok = await ensureAtlasRoot(toasts, 'move this world to a folder on your drive', { worldPicked: 'refuse' });
    if (!ok) return null;
  }
  const home = await loadHandle(ATLAS_ROOT_HANDLE_KEY).catch(() => undefined);
  if (!home || !(await ensureWritable(home).catch(() => false))) {
    toasts.info('Atlas needs to be allowed to change your OnlyWorlds folder to move the world there.');
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
    const { overlay, body } = this.buildModalShell({ title: `Move "${w.name}" to a folder?`, dataModal: 'move-browser-world' });
    body.innerHTML = `
      <p class="atlas-modal-hint">Atlas copies the world into ${root ? `your OnlyWorlds folder, <code>${escapeText(root.pathHint ?? root.folderName)}</code>` : 'a folder on your drive'}, checks the copy, then removes it from this browser. In the folder, your AI and other tools can work on it.</p>
      ${root ? '' : '<p class="atlas-modal-hint">You pick that folder once; Atlas keeps your worlds in it as plain files.</p>'}
      <div class="atlas-modal-progress" data-role="move-progress" hidden></div>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
        <button type="button" class="atlas-btn-primary" data-action="move-confirm">Move it</button>
      </div>`;
    this.modal = overlay;
    this.show();
    const cancel = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const confirm = body.querySelector<HTMLButtonElement>('[data-action="move-confirm"]')!;
    const progress = body.querySelector<HTMLElement>('[data-role="move-progress"]')!;
    confirm.focus();
    const unlock = (): void => { appRoot()?.removeAttribute('inert'); };
    const observer = new MutationObserver(() => {
      if (!overlay.isConnected) { observer.disconnect(); unlock(); }
    });
    observer.observe(document.body, { childList: true });
    cancel.addEventListener('click', () => this.hide());
    confirm.addEventListener('click', async () => {
      // Locked from the click (S373 gate F9): readying the home folder can
      // take a dialog, a picker and a permission prompt, and a dialog closed
      // meanwhile must not leave a move running with nothing on screen.
      confirm.disabled = true;
      cancel.disabled = true;
      this.dismissLocked = true;
      const ready = await readyHome(this.toasts);
      if (!overlay.isConnected) return;
      if (!ready) { confirm.disabled = false; cancel.disabled = false; this.dismissLocked = false; return; }
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
      unlock();
      this.dismissLocked = false;
      if (outcome?.ok) {
        this.hide();
        completeWaypoint('keep-copy');
        this.toasts.success(`"${w.name}" now lives in a folder on your drive: ${outcome.pathHint}.`
          + (outcome.leftBrowserCopy ? ' Its old copy in this browser is removed the next time Atlas starts.' : ''));
        return;
      }
      if (outcome && !outcome.ok) console.warn('[atlas:move] did not finish:', outcome.error);
      const err = refusal ?? (outcome as { error: unknown }).error;
      const why = problemFor(err, { doing: 'moving this world to a folder', where: 'folder', folder: 'picked', inline: true }).sentence;
      progress.textContent = refusal ? why : `${MOVE_DID_NOT_FINISH(w.name)} ${why}`;
      cancel.disabled = false;
      cancel.textContent = 'Close';
      confirm.hidden = true;
      cancel.focus();
    });
  }
}
