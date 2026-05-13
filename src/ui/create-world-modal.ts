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
import { FsFolderStore } from '../store/folder-store-fs';
import { nowIso } from '../store/folder-store';
import { getState } from '../core/state';
import { navigate, worldHash } from '../core/router';
import { createWorldInRoot } from '../setup/atlas-root-flow';
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
      title: 'create local world',
      dataModal: 'create-world',
    });

    const atlasRoot = getState().atlasRoot;
    const rootDisplay = atlasRoot?.pathHint ?? atlasRoot?.folderName;
    body.innerHTML = `
      <form data-form="create-world">
        <label class="atlas-modal-field">
          <span>name</span>
          <input class="atlas-input" type="text" name="world-name" placeholder="untitled world" autocomplete="off" />
        </label>
        <p class="atlas-modal-hint">
          ${rootDisplay
            ? `creates a new world folder inside your atlas folder (<code>${escapeText(rootDisplay)}</code>). you can move it online (sync with onlyworlds api) later.`
            : 'atlas needs an atlas folder before creating worlds. set one up from the welcome panel.'}
        </p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="pick" ${rootDisplay ? '' : 'disabled'}>create</button>
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
      const name = nameInput.value.trim() || 'untitled world';

      submitBtn.disabled = true;
      submitBtn.textContent = 'creating…';
      try {
        const { entry } = await createWorldInRoot(name);
        this.toasts.success(`created ${entry.name}`);
        this.hide();
        this.onCreated?.({ entry });
        navigate(worldHash(entry.id));
      } catch (err) {
        this.showError(errorBox, err instanceof Error ? err.message : String(err));
        submitBtn.disabled = false;
        submitBtn.textContent = 'create';
      }
    });

    return overlay;
  }

  private showError(box: HTMLElement, message: string): void {
    box.textContent = message;
    box.hidden = false;
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---- Active-store cache (avoid re-opening per render) ----

let activeStore: FsFolderStore | null = null;
export function setActiveStore(store: FsFolderStore | null): void { activeStore = store; }
export function getActiveStore(): FsFolderStore | null { return activeStore; }

// Re-exported timestamp helper for test code paths.
export { nowIso };
