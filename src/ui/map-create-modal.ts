/**
 * MapCreateModal — create or configure a map for the active world.
 *
 * Two modes:
 *   - create (default): fresh map. Submit → store.createMap(...).
 *   - configure-existing: existing map (typically just created via the
 *     element-create grid). Pre-fills name/location/image_url from current
 *     state. Submit → store.updateMap(existingId, ...). Cancel = no changes.
 *
 * Collects: name, optional location (via element picker), optional image url,
 * optional local image file (stored in media via addMedia).
 *
 * On submit:
 *   create flow      → createMap → if file, addMedia → updateMap(image_media_id) → refresh → return map
 *   configure flow   → updateMap → if file, addMedia → updateMap(image_media_id) → refresh → return map
 */

import { BaseModal } from './modal-base';
import { pickElement } from './element-picker-modal';
import { ToastManager } from './toast-manager';
import { problemFor } from '../core/problems';
import { getState, patchSlice } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { readImageDimsFromFile, readImageDimsFromUrl, IMAGELESS_MAP_SIZE, smallMapImageHint } from './image-dims';
import { openMapTab } from '../tabs/right/map-index-tab';
import type { WorldMap } from '../core/types';
import { escapeText, escapeAttr } from '../core/dom-utils';
// view-only-ok: opened only from +map and New map, both closed on a view-only world (conv. 149).

export interface MapCreateResult {
  map: WorldMap;
}

export interface MapModalOptions {
  /** When set, the modal runs in configure-existing mode against this id. */
  existingMapId?: string;
  /** Pre-fill the name field (used when invoked from element-create grid). */
  initialName?: string;
  /**
   * Pre-fill the location chip with this Location element id. Used by the
   * `[+map]` button on the element-detail top bar for Locations — clicking
   * jumps straight into a map create form already anchored to that place.
   * DESIGN_MAPS.md §3.5.
   */
  initialLocationId?: string;
}

export function createMapDialog(
  toasts: ToastManager,
  opts: { initialName?: string; initialLocationId?: string } = {},
): Promise<MapCreateResult | null> {
  return new Promise((resolve) => {
    const modal = new MapCreateModal(toasts, (result) => {
      // Auto-open the new map's tab — the create flow is "name (+ image) →
      // see it." Imageless maps open too: their flat canvas is a
      // real working surface (place pins now, add art later).
      if (result?.map) openMapTab(result.map);
      resolve(result);
    }, {
      initialName: opts.initialName,
      initialLocationId: opts.initialLocationId,
    });
    modal.open();
  });
}

class MapCreateModal extends BaseModal {
  private onDone: (result: MapCreateResult | null) => void;
  private toasts: ToastManager;
  private opts: MapModalOptions;
  private resolved = false;
  private locationPreview: { id: string; name: string } | null = null;
  private parentMapPreview: { id: string; name: string } | null = null;
  private existingMap: WorldMap | null = null;
  private advancedOpen = false;

  constructor(
    toasts: ToastManager,
    onDone: (result: MapCreateResult | null) => void,
    opts: MapModalOptions,
  ) {
    super();
    this.toasts = toasts;
    this.onDone = onDone;
    this.opts = opts;
  }

  open(): void {
    if (!getState().active || !getActiveStore()) {
      this.toasts.error('This world is not open. Open it from the sidebar, then try again.');
      this.onDone(null);
      return;
    }
    // Create mode + initialLocationId → pre-fill the location chip so the
    // user lands inside an already-anchored map create form. The chip is
    // editable; user can clear it via × if they change their mind.
    if (!this.opts.existingMapId && this.opts.initialLocationId) {
      const loc = getState().data.elements.find(e => e.id === this.opts.initialLocationId);
      if (loc) {
        this.locationPreview = { id: loc.id, name: loc.name ?? '(unnamed)' };
      }
    }
    if (this.opts.existingMapId) {
      const found = getState().data.elements.find(
        (e): e is WorldMap => e.type === 'map' && e.id === this.opts.existingMapId,
      );
      if (!found) {
        this.toasts.error('That map is not in this world any more.');
        this.onDone(null);
        return;
      }
      this.existingMap = found;
      // Pre-fill the location chip from the existing map's location, looking
      // up the location's name from state.
      if (found.location) {
        const loc = getState().data.elements.find(e => e.id === found.location);
        this.locationPreview = { id: found.location, name: loc?.name ?? '(unknown)' };
      }
      if (typeof found.parent_map === 'string' && found.parent_map) {
        const parent = getState().data.elements.find(
          (e): e is WorldMap => e.type === 'map' && e.id === found.parent_map,
        );
        this.parentMapPreview = { id: found.parent_map, name: parent?.name ?? '(unknown)' };
      }
      // Reveal the advanced section by default when any advanced field is
      // already populated — saves a click and signals "there's stuff here."
      if (
        this.parentMapPreview ||
        typeof found.hierarchy === 'number' ||
        (typeof found.background_color === 'string' && found.background_color)
      ) {
        this.advancedOpen = true;
      }
    }
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      const input = this.modal?.querySelector<HTMLInputElement>('input[name="map-name"]');
      if (!input) return;
      input.focus();
      // Place cursor at the END of the pre-filled name. Without this, focus()
      // on a pre-populated input lands the caret at start in most browsers,
      // and the user typing right after open prepends to the name instead of
      // continuing it. Important for the element-create → createMapDialog
      // hand-off where the name field arrives already filled.
      const len = input.value.length;
      input.setSelectionRange(len, len);
    });
    // Escape and the full outside click are BaseModal's; `hide` below
    // settles the promise however the modal closed (gate F4).
  }

  private cancel(): void {
    this.hide();
  }

  /** Every close path settles `createMapDialog()` (gate F4: Escape and
   *  the overlay click both left it pending; the pin-prompt idiom). */
  protected override hide(): void {
    super.hide();
    if (!this.resolved) {
      this.resolved = true;
      this.onDone(null);
    }
  }

  private buildModal(): HTMLElement {
    const isConfigure = !!this.opts.existingMapId;
    const initialName = isConfigure ? (this.existingMap?.name ?? '') : (this.opts.initialName ?? '');
    const initialUrl = isConfigure ? (this.existingMap?.image_url ?? '') : '';
    const initialHierarchy = isConfigure && typeof this.existingMap?.hierarchy === 'number'
      ? String(this.existingMap.hierarchy)
      : '';
    const initialBgColor = isConfigure ? (this.existingMap?.background_color ?? '') : '';

    const { overlay, body } = this.buildModalShell({
      title: isConfigure ? 'Configure map' : 'New map',
      panelClass: 'atlas-map-create-panel',
      dataModal: isConfigure ? 'configure-map' : 'create-map',
    });

    body.innerHTML = `
      <form data-form="${isConfigure ? 'configure-map' : 'create-map'}">
        <label class="atlas-modal-field">
          <span>Name</span>
          <input class="atlas-input" type="text" name="map-name" placeholder="Map name…" autocomplete="off" value="${escapeAttr(initialName)}" />
        </label>
        <div class="atlas-modal-field">
          <span>Location (optional)</span>
          <div class="atlas-map-create-location" data-role="location-row"></div>
        </div>
        <label class="atlas-modal-field">
          <span>Image URL (optional)</span>
          <input class="atlas-input" type="text" name="map-image-url" placeholder="https://..." autocomplete="off" spellcheck="false" value="${escapeAttr(initialUrl)}" />
        </label>
        <div class="atlas-modal-field">
          <span>Local image (optional)</span>
          <div class="atlas-file-picker">
            <button type="button" class="atlas-btn-ghost atlas-file-picker-btn" data-role="file-pick-btn">
              <span class="material-symbols-outlined">attach_file</span>
              <span>Choose file</span>
            </button>
            <span class="atlas-file-picker-name" data-role="file-pick-name">No file chosen</span>
            <input type="file" name="map-image-file" accept="image/*" hidden />
          </div>
          <span class="atlas-modal-hint" data-role="local-image-hint">Used as fallback when image URL is empty. Stored locally, never uploaded.</span>
        </div>

        <button type="button" class="atlas-modal-advanced-toggle" data-role="advanced-toggle" aria-expanded="${this.advancedOpen}">
          <span class="material-symbols-outlined atlas-modal-advanced-chevron">${this.advancedOpen ? 'expand_more' : 'chevron_right'}</span>
          <span>Advanced</span>
        </button>
        <div class="atlas-modal-advanced" data-role="advanced-body" ${this.advancedOpen ? '' : 'hidden'}>
          <div class="atlas-modal-field">
            <span>Parent map (override)</span>
            <div class="atlas-map-create-parent" data-role="parent-map-row"></div>
            <span class="atlas-modal-hint">Explicit nesting. By default, location-based maps are placed under the nearest ancestor location's map automatically.</span>
          </div>
          <label class="atlas-modal-field">
            <span>Hierarchy (sibling order)</span>
            <input class="atlas-input" type="number" name="map-hierarchy" placeholder="0" autocomplete="off" value="${escapeAttr(initialHierarchy)}" />
            <span class="atlas-modal-hint">Lower comes first. Only matters when 2+ maps share the same parent or location.</span>
          </label>
          <label class="atlas-modal-field">
            <span>Background color (optional)</span>
            <input class="atlas-input" type="text" name="map-bg-color" placeholder="#000000 or rgb(...)" autocomplete="off" spellcheck="false" value="${escapeAttr(initialBgColor)}" />
            <span class="atlas-modal-hint">Canvas fallback color. Atlas auto-extracts an edge color from the image when one is set.</span>
          </label>
        </div>

        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="submit">${isConfigure ? 'Save' : 'Create'}</button>
        </div>
      </form>
    `;

    const locationRow = body.querySelector<HTMLElement>('[data-role="location-row"]')!;
    this.renderLocationChip(locationRow);

    const parentRow = body.querySelector<HTMLElement>('[data-role="parent-map-row"]')!;
    this.renderParentMapChip(parentRow);

    // Advanced toggle — show/hide the section.
    const advancedToggle = body.querySelector<HTMLButtonElement>('[data-role="advanced-toggle"]')!;
    const advancedBody = body.querySelector<HTMLElement>('[data-role="advanced-body"]')!;
    const advancedChevron = body.querySelector<HTMLElement>('.atlas-modal-advanced-chevron')!;
    advancedToggle.addEventListener('click', (e) => {
      e.preventDefault();
      this.advancedOpen = !this.advancedOpen;
      advancedBody.hidden = !this.advancedOpen;
      advancedToggle.setAttribute('aria-expanded', String(this.advancedOpen));
      advancedChevron.textContent = this.advancedOpen ? 'expand_more' : 'chevron_right';
    });

    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.cancel(); });

    // Dynamic hint: the warning only fires when BOTH a local image was
    // uploaded AND a URL was typed — that's the only case where the local
    // file gets stored as silent fallback. URL-only is the canonical path
    // and shouldn't trigger any warning.
    const urlField = body.querySelector<HTMLInputElement>('input[name="map-image-url"]')!;
    const fileField = body.querySelector<HTMLInputElement>('input[name="map-image-file"]')!;
    const filePickBtn = body.querySelector<HTMLButtonElement>('[data-role="file-pick-btn"]')!;
    const filePickName = body.querySelector<HTMLElement>('[data-role="file-pick-name"]')!;
    const hintEl = body.querySelector<HTMLElement>('[data-role="local-image-hint"]')!;
    filePickBtn.addEventListener('click', () => fileField.click());
    const updateFilePickName = (): void => {
      const f = fileField.files?.[0];
      if (f) {
        filePickName.textContent = f.name;
        filePickName.classList.add('atlas-file-picker-name-set');
      } else {
        filePickName.textContent = 'No file chosen';
        filePickName.classList.remove('atlas-file-picker-name-set');
      }
    };
    const updateHint = (): void => {
      const hasFile = !!fileField.files?.length;
      const hasUrl = !!urlField.value.trim();
      if (hasFile && hasUrl) {
        hintEl.textContent = 'Image URL is set; your uploaded file is stored as fallback but the URL displays.';
        hintEl.classList.add('atlas-modal-hint-warn');
      } else {
        hintEl.textContent = 'Used as fallback when image URL is empty. Stored locally, never uploaded.';
        hintEl.classList.remove('atlas-modal-hint-warn');
      }
    };
    urlField.addEventListener('input', updateHint);
    fileField.addEventListener('change', () => { updateFilePickName(); updateHint(); });
    updateFilePickName();
    updateHint();

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="submit"]')!;

    // Set once createMap succeeds, so pressing Create again after a later
    // step failed (the image file, the refresh) does not make a second map.
    let createdMapId: string | null = null;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const nameInput = form.querySelector<HTMLInputElement>('input[name="map-name"]')!;
      const urlInput = form.querySelector<HTMLInputElement>('input[name="map-image-url"]')!;
      const fileInput = form.querySelector<HTMLInputElement>('input[name="map-image-file"]')!;
      const hierarchyInput = form.querySelector<HTMLInputElement>('input[name="map-hierarchy"]')!;
      const bgColorInput = form.querySelector<HTMLInputElement>('input[name="map-bg-color"]')!;
      const name = nameInput.value.trim();
      if (!name) {
        errorBox.textContent = 'Name is required';
        errorBox.hidden = false;
        nameInput.focus();
        return;
      }
      // Validate hierarchy if provided — must be a finite number.
      let hierarchyValue: number | undefined;
      const hierarchyRaw = hierarchyInput.value.trim();
      if (hierarchyRaw) {
        const parsed = Number(hierarchyRaw);
        if (!Number.isFinite(parsed)) {
          errorBox.textContent = 'Hierarchy must be a number';
          errorBox.hidden = false;
          hierarchyInput.focus();
          return;
        }
        hierarchyValue = parsed;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = isConfigure ? 'Saving…' : 'Creating…';
      cancelBtn.hidden = true;
      try {
        const store = getActiveStore()!;
        const url = urlInput.value.trim();
        const file = fileInput.files?.[0];
        const bgColor = bgColorInput.value.trim();

        // Decode dimensions BEFORE persisting so the record carries them.
        let initialDims: { w: number; h: number } | null = null;
        if (file) initialDims = await readImageDimsFromFile(file);
        else if (url) initialDims = await readImageDimsFromUrl(url);

        const patch: Partial<WorldMap> = {
          name,
          location: this.locationPreview?.id,
          image_url: url || undefined,
          parent_map: this.parentMapPreview?.id,
          hierarchy: hierarchyValue,
          background_color: bgColor || undefined,
        };
        if (initialDims) {
          patch.width = initialDims.w;
          patch.height = initialDims.h;
        } else if (!isConfigure && !url && !file) {
          // Imageless create → stamp the square flat-canvas dims so the
          // coordinate space is durable across devices (DESIGN_MAPS.md §4.2).
          patch.width = IMAGELESS_MAP_SIZE;
          patch.height = IMAGELESS_MAP_SIZE;
        }
        // Soft smallness hint (never a block): a tiny image makes pin
        // placement coarse — say so once, at attach time.
        if (initialDims) {
          const hint = smallMapImageHint(initialDims);
          if (hint) this.toasts.info(hint);
        }

        let map: WorldMap;
        if (isConfigure && this.opts.existingMapId) {
          map = await store.updateMap(this.opts.existingMapId, patch);
        } else if (createdMapId) {
          // A later step failed after the create last time: finish that map
          // rather than make a second one.
          map = await store.updateMap(createdMapId, patch);
        } else {
          map = await store.createMap(patch);
          createdMapId = map.id;
        }

        if (file) {
          const media = await store.addMedia(map.id, file, 'base-image');
          map = await store.updateMap(map.id, { image_media_id: media.id });
        }

        const elements = await refreshElementsAfterWrite(store);

        this.toasts.success(isConfigure ? `Updated map "${name}"` : `Created map "${name}"`);
        this.resolved = true;
        this.onDone({ map });
        this.hide();
      } catch (err) {
        console.error(isConfigure ? '[map-configure] failed:' : '[map-create] failed:', err);
        errorBox.textContent = problemFor(err, { inline: true, doing: isConfigure ? 'saving the map' : 'creating the map' }).sentence;
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = isConfigure ? 'Save' : 'Create';
        cancelBtn.hidden = false;
      }
    });
    return overlay;
  }

  private renderLocationChip(row: HTMLElement): void {
    row.innerHTML = '';
    if (this.locationPreview) {
      const chip = document.createElement('span');
      chip.className = 'atlas-link-chip';
      chip.innerHTML = `<span>${escapeText(this.locationPreview.name || '(unnamed)')}</span><span class="material-symbols-outlined atlas-link-chip-remove" data-remove="1">close</span>`;
      row.appendChild(chip);
      chip.querySelector<HTMLElement>('.atlas-link-chip-remove')!.addEventListener('click', () => {
        this.locationPreview = null;
        this.renderLocationChip(row);
      });
    }
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'atlas-btn-ghost';
    pickBtn.textContent = this.locationPreview ? 'Change' : '+ Pick location';
    pickBtn.addEventListener('click', async () => {
      const picked = await pickElement({
        restrictToType: 'location',
        title: 'Pick a location for this map',
      });
      if (!picked) return;
      this.locationPreview = { id: picked.id, name: picked.name };
      this.renderLocationChip(row);
    });
    row.appendChild(pickBtn);
  }

  private renderParentMapChip(row: HTMLElement): void {
    row.innerHTML = '';
    if (this.parentMapPreview) {
      const chip = document.createElement('span');
      chip.className = 'atlas-link-chip';
      chip.innerHTML = `<span>${escapeText(this.parentMapPreview.name || '(unnamed)')}</span><span class="material-symbols-outlined atlas-link-chip-remove" data-remove="1">close</span>`;
      row.appendChild(chip);
      chip.querySelector<HTMLElement>('.atlas-link-chip-remove')!.addEventListener('click', () => {
        this.parentMapPreview = null;
        this.renderParentMapChip(row);
      });
    }
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'atlas-btn-ghost';
    pickBtn.textContent = this.parentMapPreview ? 'Change' : '+ Pick parent map';
    pickBtn.addEventListener('click', async () => {
      // In configure-existing mode, exclude self to prevent the obvious cycle.
      // Deeper cycle prevention (descendants of self) is delegated to the
      // tree-builder's wouldCreateCycle defense; if a user picks a descendant
      // anyway, the tree surfaces it with a brokenParent chip rather than
      // mis-rendering.
      const excludeIds = this.opts.existingMapId ? [this.opts.existingMapId] : [];
      const picked = await pickElement({
        restrictToType: 'map',
        excludeIds,
        title: 'Pick a parent map',
      });
      if (!picked) return;
      this.parentMapPreview = { id: picked.id, name: picked.name };
      this.renderParentMapChip(row);
    });
    row.appendChild(pickBtn);
  }
}

// Image-dim helpers live in ui/image-dims.ts (shared with element-detail's
// image_url field-edit hook). Import below.


