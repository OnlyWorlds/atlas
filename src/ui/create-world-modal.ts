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
import { getState, patchSlice } from '../core/state';
import { setSidebarModePref } from '../core/ui-prefs';
import { navigate, worldHash } from '../core/router';
import { createWorldInRoot } from '../setup/atlas-root-flow';
import { completeWaypoint } from '../core/waypoints';
import { escapeText } from '../core/dom-utils';
import { problemFor } from '../core/problems';
import type { WorldRegistryEntry } from '../core/types';

export interface CreateWorldResult {
  entry: WorldRegistryEntry;
}

/**
 * Tour mode: the REAL dialog shown once with the script locked — name fixed,
 * a teaching hint replacing the folder line, and Create handing off to the
 * tour engine (browser-storage world) instead of createWorldInRoot.
 */
export interface CreateWorldTourOptions {
  lockedName: string;
  hint: string;
  overrideCreate: () => Promise<void>;
}

export class CreateWorldModal extends BaseModal {
  private onCreated?: (result: CreateWorldResult) => void;
  private toasts: ToastManager;
  private tour?: CreateWorldTourOptions;

  constructor(toasts: ToastManager, onCreated?: (r: CreateWorldResult) => void, tour?: CreateWorldTourOptions) {
    super();
    this.toasts = toasts;
    this.onCreated = onCreated;
    this.tour = tour;
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
    const tour = this.tour;
    const hint = tour
      ? escapeText(tour.hint)
      : rootDisplay
        ? `Creates a new world folder inside your OnlyWorlds folder (<code>${escapeText(rootDisplay)}</code>). You can move it online (sync with OnlyWorlds API) later.`
        : 'Atlas needs an OnlyWorlds folder before creating worlds. Set one up from the welcome panel.';
    body.innerHTML = `
      <form data-form="create-world">
        <label class="atlas-modal-field">
          <span>Name</span>
          <input class="atlas-input" type="text" name="world-name" placeholder="Untitled world" autocomplete="off"
            ${tour ? `value="${escapeText(tour.lockedName)}" readonly` : ''} />
        </label>
        ${hint ? `<p class="atlas-modal-hint">${hint}</p>` : ''}
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="pick" ${(rootDisplay || tour) ? '' : 'disabled'}>Create</button>
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

      // Tour mode: hand the create to the tour engine and close. No folder,
      // no waypoint, no navigation of our own — the tour routes.
      if (this.tour) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating…';
        cancelBtn.hidden = true;
        try {
          await this.tour.overrideCreate();
          this.hide();
        } catch (err) {
          console.warn('[create-world] tour create failed:', err);
          this.showError(errorBox, problemFor(err, { inline: true, doing: 'creating the tour world' }).sentence);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create';
          cancelBtn.hidden = false;
        }
        return;
      }

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
        // Land in world view: sidebar flips to the elements list so the new
        // world's (empty) contents are the visible surface (S255v3).
        patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
        setSidebarModePref('elements');
        navigate(worldHash(entry.id));
      } catch (err) {
        // A refusal (no home folder, no permission) reads as itself; the rest
        // is worded (S369).
        console.warn('[create-world] create failed:', err);
        this.showError(errorBox, problemFor(err, { inline: true, doing: 'creating the world' }).sentence);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
        cancelBtn.hidden = false;
      }
    });

    return overlay;
  }

  private showError(box: HTMLElement, message: string): void {
    box.textContent = message;
    // A cancelled step has nothing to say (an empty problem sentence).
    box.hidden = !message;
  }
}

// Re-exported timestamp helper for test code paths.
export { nowIso };
