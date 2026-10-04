/**
 * Create-Local-World modal.
 *
 * Where the world lives (1.17, ruling 2, conv. 129): on a browser with the
 * folder picker the dialog asks, folder first and browser second; the folder
 * row is pre-selected when a home folder is set (and shows its path), else
 * the user's last pick decides. Choosing the folder with no home folder asks
 * for one inside the click (`ensureAtlasRoot`). A browser without the picker
 * makes the world in this browser and says so.
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
import { hasFolderMode, opfsUsable } from '../core/capabilities';
import { loadUiPrefs, setNewWorldWherePref } from '../core/ui-prefs';
import { requestPersistOnFirstBrowserWorld, WHERE_BROWSER_CAPTION, WHERE_BROWSER_ONLY_LINE } from '../setup/world-parent';
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
    const folderMode = hasFolderMode();
    const preselect: 'folder' | 'browser' = rootDisplay ? 'folder' : (loadUiPrefs().newWorldWhere ?? 'browser');
    const whereBlock = tour ? '' : folderMode
      ? `<fieldset class="atlas-where-choice" data-role="where">
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
        </fieldset>`
      : `<p class="atlas-modal-hint" data-role="where-browser">${WHERE_BROWSER_ONLY_LINE}</p>`;
    const hint = tour ? escapeText(tour.hint) : '';
    body.innerHTML = `
      <form data-form="create-world">
        <label class="atlas-modal-field">
          <span>Name</span>
          <input class="atlas-input" type="text" name="world-name" placeholder="Untitled world" autocomplete="off"
            ${tour ? `value="${escapeText(tour.lockedName)}" readonly` : ''} />
        </label>
        ${hint ? `<p class="atlas-modal-hint">${hint}</p>` : ''}
        ${whereBlock}
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="pick">Create</button>
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

      const picked = form.querySelector<HTMLInputElement>('input[name="where"]:checked')?.value;
      const where: 'folder' | 'browser' = folderMode ? (picked === 'folder' ? 'folder' : 'browser') : 'browser';
      // Asked synchronously, inside the click, before the first await (Firefox
      // shows a prompt and may never answer; nothing waits on it).
      if (where === 'browser') requestPersistOnFirstBrowserWorld();
      if (folderMode) setNewWorldWherePref(where);
      if (where === 'browser' && (await opfsUsable()) !== true) {
        this.showError(errorBox, 'This window does not allow browser storage, so no world can live in this browser here. If it is a private window, open Atlas in a normal one.');
        return;
      }
      if (where === 'folder' && !getState().atlasRoot) {
        const { ensureAtlasRoot } = await import('../setup/world-doors');
        if (!(await ensureAtlasRoot(this.toasts, 'A new world is a new folder.'))) return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
      // Hide cancel during the in-flight operation so the user can't cancel
      // mid-creation (the FS work isn't safely interruptable). Restored on
      // failure below; not needed on success since the modal closes.
      cancelBtn.hidden = true;
      try {
        const { entry } = await createWorldInRoot(name, { where });
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
