/**
 * Create-Local-World modal.
 *
 * When the atlas root IS set: name-only flow. Atlas creates a subfolder under
 * the root. No file picker — the location is implied by the root.
 *
 * When the atlas root is NOT set: this modal is not shown — the sidebar
 * shows a "set up atlas" button first.
 *
 * Test seam: directory-picker.pickDirectory() is overridable via
 * `window.__atlasTestApi.pickDirectory` so Playwright can inject an OPFS handle
 * without needing a real user-gesture file picker.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { nowIso } from '../store/folder-store';
import { getState } from '../core/state';
import { navigate, worldHash } from '../core/router';
import { createWorldInRoot } from '../setup/atlas-root-flow';
import { completeWaypoint } from '../core/waypoints';
import { escapeText } from '../core/dom-utils';
import type { WorldRegistryEntry } from '../core/types';

export interface CreateWorldResult {
  entry: WorldRegistryEntry;
}

export class CreateWorldModal extends BaseModal {
  private onCreated?: (result: CreateWorldResult) => void;
  private toasts: ToastManager;

  constructor(toasts: ToastManager, onCreated?: (r: CreateWorldResult) => void) {
    super();
    this.toasts = toasts;
    this.onCreated = onCreated;
  }

  open(): void {
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      const input = this.modal?.querySelector<HTMLInputElement>('input[name="world-name"]');
      input?.focus();
    });
  }

  private buildModal(): HTMLElement {
    const { overlay, body } = this.buildModalShell({
      title: 'Create local world',
      dataModal: 'create-world',
    });

    const atlasRoot = getState().atlasRoot;
    const rootDisplay = atlasRoot?.pathHint ?? atlasRoot?.folderName;
    body.innerHTML = `
      <form data-form="create-world">
        <label class="atlas-modal-field">
          <span>Name</span>
          <input class="atlas-input" type="text" name="world-name" placeholder="Untitled world" autocomplete="off" />
        </label>
        <p class="atlas-modal-hint">
          ${rootDisplay
            ? `Creates a new world folder inside your atlas folder (<code>${escapeText(rootDisplay)}</code>). You can move it online (sync with OnlyWorlds API) later.`
            : 'Atlas needs an atlas folder before creating worlds. Set one up from the welcome panel.'}
        </p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="pick" ${rootDisplay ? '' : 'disabled'}>Create</button>
        </div>
      </form>
    `;

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="pick"]')!;

    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const nameInput = form.querySelector<HTMLInputElement>('input[name="world-name"]')!;
      const name = nameInput.value.trim() || 'Untitled world';

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
      // Hide cancel during the in-flight operation so the user can't cancel
      // mid-creation (the FS work isn't safely interruptable). Restored on
      // failure below; not needed on success since the modal closes.
      cancelBtn.hidden = true;
      try {
        const { entry } = await createWorldInRoot(name);
        // Waypoint: the created world is non-demo by construction — ungated
        // even when the sample world is active at click time (hookmap wp1).
        completeWaypoint('first-world');
        this.toasts.success(`Created ${entry.name}`);
        this.hide();
        this.onCreated?.({ entry });
        navigate(worldHash(entry.id));
      } catch (err) {
        this.showError(errorBox, err instanceof Error ? err.message : String(err));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
        cancelBtn.hidden = false;
      }
    });

    return overlay;
  }

  private showError(box: HTMLElement, message: string): void {
    box.textContent = message;
    box.hidden = false;
  }
}

// Re-exported timestamp helper for test code paths.
export { nowIso };
