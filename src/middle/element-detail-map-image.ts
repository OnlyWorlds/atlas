/**
 * Map-only "Local image" field row for the element editor — sits directly
 * under the schema image_url row (Captain's ask, session 253: existing maps
 * had no way to attach a local file; only the create modal offered it).
 *
 * Uses the SAME primitives as the map-create flow (addMedia 'base-image' →
 * updateMap image_media_id → refreshElementsAfterWrite), not the modal's
 * never-wired configure mode. image_media_id is atlas-local (never pushed);
 * image_url stays canonical and wins display when set (DESIGN_MAPS).
 */

import { ToastManager } from '../ui/toast-manager';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { escapeText } from '../core/dom-utils';
import type { WorldMap } from '../core/types';

export function buildMapLocalImageRow(m: WorldMap, toasts: ToastManager): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-field atlas-map-localimage';
  wrap.dataset.field = 'local_image';
  if (!m.image_media_id) wrap.classList.add('atlas-field-empty-row');

  const label = document.createElement('div');
  label.className = 'atlas-field-label';
  label.textContent = 'Local image';
  label.title = 'An image file stored in this world folder. Used as the map background when no image URL is set.';
  wrap.appendChild(label);

  const value = document.createElement('div');
  value.className = 'atlas-field-value atlas-map-localimage-value';
  wrap.appendChild(value);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.hidden = true;
  wrap.appendChild(input);

  const render = (filename: string | null) => {
    value.innerHTML = '';
    if (filename) {
      const chip = document.createElement('span');
      chip.className = 'atlas-map-localimage-chip';
      chip.innerHTML = `<span class="material-symbols-outlined">image</span><span>${escapeText(filename)}</span>`;
      value.appendChild(chip);
      value.appendChild(actionBtn('Replace', () => input.click()));
      value.appendChild(actionBtn('Clear', () => clearImage()));
    } else {
      const empty = document.createElement('span');
      empty.className = 'atlas-map-localimage-empty';
      empty.textContent = 'none';
      value.appendChild(empty);
      value.appendChild(actionBtn('Choose file', () => input.click()));
    }
  };

  const actionBtn = (text: string, onClick: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-map-localimage-btn';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };

  const clearImage = async () => {
    const store = getActiveStore();
    if (!store) return;
    try {
      // Convention #21: relation/reference fields clear with null.
      await store.updateMap(m.id, { image_media_id: null } as unknown as Partial<WorldMap>);
      await refreshElementsAfterWrite(store);
      toasts.success('Local image cleared');
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const store = getActiveStore();
    if (!store) return;
    try {
      const media = await store.addMedia(m.id, file, 'base-image');
      await store.updateMap(m.id, { image_media_id: media.id });
      await refreshElementsAfterWrite(store);
      toasts.success(`Map image set: ${file.name}`);
    } catch (err) {
      toasts.error(err instanceof Error ? err.message : String(err));
    }
  });

  // Resolve the current media filename asynchronously; the row renders
  // immediately with a placeholder so layout never waits on the FS.
  render(null);
  if (m.image_media_id) {
    const store = getActiveStore();
    if (store) {
      void store.listMedia(m.id).then(items => {
        const item = items.find(i => i.id === m.image_media_id);
        render(item ? item.filename : '(missing file)');
      }).catch(() => render('(unreadable)'));
    }
  }

  return wrap;
}
