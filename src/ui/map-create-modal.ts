/**
 * MapCreateModal — create a map for the active world via FolderStore.
 *
 * Collects: name, optional location (via element picker), optional image url,
 * optional local image file (stored in media via addMedia).
 *
 * On submit: createMap → if file, addMedia → update map.image_media_id →
 * refresh data.elements → return the created map.
 */

import { BaseModal } from './modal-base';
import { pickElement } from './element-picker-modal';
import { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { getActiveStore } from './create-world-modal';
import type { WorldMap } from '../core/types';

export interface MapCreateResult {
  map: WorldMap;
}

export function createMapDialog(toasts: ToastManager): Promise<MapCreateResult | null> {
  return new Promise((resolve) => {
    const modal = new MapCreateModal(toasts, (result) => resolve(result));
    modal.open();
  });
}

class MapCreateModal extends BaseModal {
  private onDone: (result: MapCreateResult | null) => void;
  private toasts: ToastManager;
  private resolved = false;
  private locationPreview: { id: string; name: string } | null = null;

  constructor(toasts: ToastManager, onDone: (result: MapCreateResult | null) => void) {
    super('atlas-modal-overlay');
    this.toasts = toasts;
    this.onDone = onDone;
  }

  open(): void {
    if (!getState().active || !getActiveStore()) {
      this.toasts.error('no active world');
      this.onDone(null);
      return;
    }
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      this.modal?.querySelector<HTMLInputElement>('input[name="map-name"]')?.focus();
    });
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        this.cancel();
        document.removeEventListener('keydown', onEsc);
      }
    };
    document.addEventListener('keydown', onEsc);
    this.modal?.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.cancel();
        document.removeEventListener('keydown', onEsc);
      }
    });
  }

  private cancel(): void {
    if (!this.resolved) {
      this.resolved = true;
      this.onDone(null);
    }
    this.hide();
  }

  private buildModal(): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'atlas-modal-overlay';

    const panel = document.createElement('div');
    panel.className = 'atlas-modal-panel atlas-map-create-panel';
    panel.setAttribute('data-modal', 'create-map');

    panel.innerHTML = `
      <div class="atlas-modal-title">new map</div>
      <form data-form="create-map">
        <label class="atlas-modal-field">
          <span>name</span>
          <input class="atlas-input" type="text" name="map-name" placeholder="map name..." autocomplete="off" />
        </label>
        <div class="atlas-modal-field">
          <span>location (optional)</span>
          <div class="atlas-map-create-location" data-role="location-row"></div>
        </div>
        <label class="atlas-modal-field">
          <span>image URL (optional)</span>
          <input class="atlas-input" type="text" name="map-image-url" placeholder="https://..." autocomplete="off" spellcheck="false" />
        </label>
        <label class="atlas-modal-field">
          <span>local image (optional)</span>
          <input type="file" name="map-image-file" accept="image/*" />
          <span class="atlas-modal-hint">stored locally only — never uploaded. if blank, the map opens with a grid canvas.</span>
        </label>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="create">create</button>
        </div>
      </form>
    `;
    overlay.appendChild(panel);

    const locationRow = panel.querySelector<HTMLElement>('[data-role="location-row"]')!;
    this.renderLocationChip(locationRow);

    const cancelBtn = panel.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.cancel(); });

    const form = panel.querySelector<HTMLFormElement>('form')!;
    const errorBox = panel.querySelector<HTMLElement>('[data-role="error"]')!;
    const submitBtn = panel.querySelector<HTMLButtonElement>('[data-action="create"]')!;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const nameInput = form.querySelector<HTMLInputElement>('input[name="map-name"]')!;
      const urlInput = form.querySelector<HTMLInputElement>('input[name="map-image-url"]')!;
      const fileInput = form.querySelector<HTMLInputElement>('input[name="map-image-file"]')!;
      const name = nameInput.value.trim();
      if (!name) {
        errorBox.textContent = 'name is required';
        errorBox.hidden = false;
        nameInput.focus();
        return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'creating...';
      try {
        const store = getActiveStore()!;
        const url = urlInput.value.trim();
        const file = fileInput.files?.[0];

        // Decode dimensions BEFORE create so the initial record carries them.
        let initialDims: { w: number; h: number } | null = null;
        if (file) initialDims = await readImageDims(file);
        else if (url) initialDims = await readImageDimsFromUrl(url);

        const createPatch: Partial<WorldMap> = {
          name,
          location: this.locationPreview?.id,
          image_url: url || undefined,
        };
        if (initialDims) {
          createPatch.width = initialDims.w;
          createPatch.height = initialDims.h;
        }
        let map = await store.createMap(createPatch);

        if (file) {
          const media = await store.addMedia(map.id, file, 'base-image');
          map = await store.updateMap(map.id, { image_media_id: media.id });
        }

        const elements = await store.listElements();
        patchSlice('data', { elements });

        this.toasts.success(`created map "${name}"`);
        this.resolved = true;
        this.onDone({ map });
        this.hide();
      } catch (err) {
        console.error('[map-create] failed:', err);
        errorBox.textContent = err instanceof Error ? err.message : String(err);
        errorBox.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'create';
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
    pickBtn.textContent = this.locationPreview ? 'change' : '+ pick location';
    pickBtn.addEventListener('click', async () => {
      const picked = await pickElement({
        restrictToType: 'location',
        title: 'pick a location for this map',
      });
      if (!picked) return;
      this.locationPreview = { id: picked.id, name: picked.name };
      this.renderLocationChip(row);
    });
    row.appendChild(pickBtn);
  }
}

async function readImageDims(file: File): Promise<{ w: number; h: number } | null> {
  try {
    const bmp = await createImageBitmap(file);
    const dims = { w: bmp.width, h: bmp.height };
    bmp.close?.();
    return dims;
  } catch {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(url); };
      img.onerror = () => { resolve(null); URL.revokeObjectURL(url); };
      img.src = url;
    });
  }
}

async function readImageDimsFromUrl(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
