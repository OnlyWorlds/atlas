/**
 * Delete a world kept in this browser (1.17):
 * a modal, not `window.confirm`, saying what goes and what stays. The work is
 * `deleteBrowserWorld` (close first, removal retried, the entry kept on any
 * failure); a failure reopens the world and says nothing was removed.
 * "Download it first" downloads the whole world and keeps the dialog open.
 */

import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';
import { navigate } from '../core/router';
import { deleteBrowserWorld, BROWSER_DELETE_FAILED } from '../setup/browser-world-delete';
import { downloadWorldFromClick } from './download-world';
import type { WorldRegistryEntry } from '../core/types';

export class DeleteBrowserWorldModal extends BaseModal {
  constructor(private readonly world: WorldRegistryEntry, private readonly toasts: ToastManager) {
    super();
  }

  open(): void {
    const w = this.world;
    const { overlay, body } = this.buildModalShell({ title: `Delete "${w.name}"?`, dataModal: 'delete-browser-world' });
    body.innerHTML = `
      <p class="atlas-modal-hint">This removes the world from Atlas and deletes it from this browser: elements, maps and media. There is no undo.</p>
      ${w.state === 'api-linked' ? '<p class="atlas-modal-hint" data-role="linked-line">The world on onlyworlds.com is not deleted.</p>' : ''}
      <div class="atlas-modal-error" data-role="error" hidden></div>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
        <button type="button" class="atlas-btn-ghost" data-action="download-first">Download it first</button>
        <button type="button" class="atlas-btn-ghost atlas-btn-danger" data-action="delete">Delete</button>
      </div>`;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const deleteBtn = body.querySelector<HTMLButtonElement>('[data-action="delete"]')!;
    cancelBtn.addEventListener('click', () => this.hide());
    const downloadBtn = body.querySelector<HTMLButtonElement>('[data-action="download-first"]')!;
    downloadBtn.addEventListener('click', () => {
      // The dialog stays: the user deletes once the file is theirs.
      errorBox.hidden = true;
      void downloadWorldFromClick(w, this.toasts, on => {
        downloadBtn.disabled = on;
        deleteBtn.disabled = on;
        downloadBtn.textContent = on ? 'Saving…' : 'Download it first';
      }).then(ok => {
        // Said here, beside Delete, not only in a toast.
        if (ok === false && this.modal?.isConnected) {
          errorBox.textContent = 'The download did not finish, so no copy was saved. Deleting now removes the world for good.';
          errorBox.hidden = false;
        }
      });
    });
    deleteBtn.addEventListener('click', async () => {
      errorBox.hidden = true;
      deleteBtn.disabled = true;
      cancelBtn.hidden = true;
      deleteBtn.textContent = 'Deleting…';
      this.dismissLocked = true;
      const result = await deleteBrowserWorld(w);
      this.dismissLocked = false;
      if (result.ok) {
        this.hide();
        if (result.listSaved) this.toasts.success(`Deleted ${w.name}`);
        else this.toasts.info(`Deleted ${w.name}. Atlas could not save your list of worlds, so after a reload it may show as cleared by this browser: remove it from the list then.`, 10_000);
        navigate('#/');
        return;
      }
      console.warn('[delete-browser-world] removal failed:', result.error);
      // Nothing was removed: the world opens again where the user left it.
      if (result.wasActive) {
        const { activateWorld } = await import('../sidebar/worlds-sidebar');
        await activateWorld(w.id, this.toasts).catch(() => false);
      }
      errorBox.textContent = BROWSER_DELETE_FAILED(w.name);
      errorBox.hidden = false;
      deleteBtn.disabled = false;
      deleteBtn.textContent = 'Delete';
      cancelBtn.hidden = false;
    });
    this.modal = overlay;
    this.show();
    queueMicrotask(() => cancelBtn.focus());
  }
}
