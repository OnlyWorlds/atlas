/**
 * Map-only "Local image" field row for the element editor — sits directly
 * under the schema image_url row (Titus's ask: existing maps
 * had no way to attach a local file; only the create modal offered it).
 *
 * Uses the SAME primitives as the map-create flow (addMedia 'base-image' →
 * updateMap image_media_id → refreshElementsAfterWrite), not the modal's
 * never-wired configure mode. image_media_id is atlas-local (never pushed);
 * image_url stays canonical and wins display when set (DESIGN_MAPS).
 */

import { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { escapeText } from '../core/dom-utils';
import { readImageDimsFromFile, smallMapImageHint, IMAGELESS_MAP_SIZE } from '../ui/image-dims';
import { countSpatialOnMap, spatialPhrase, rescaleSketchOntoImage } from './map-attach-scale';
import type { WorldMap } from '../core/types';
// view-only-ok: the element page builds this row only on a world that can change (element-detail.ts) (conv. 149).

export function buildMapLocalImageRow(m: WorldMap, toasts: ToastManager): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-field atlas-map-localimage';
  wrap.dataset.field = 'local_image';
  if (!m.image_media_id) wrap.classList.add('atlas-field-empty-row');

  const label = document.createElement('div');
  label.className = 'atlas-field-label';
  label.textContent = 'Local image';
  label.title = 'An image file stored with this world. Used as the map background when no image URL is set.';
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
      console.error('[map-image] clear failed:', err);
      // No retry (gate B L1): an image set since would be cleared.
      showProblem(err, { doing: 'clearing the map image', toasts });
    }
  };

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const store = getActiveStore();
    if (!store) return;
    // Blank-canvas → image (DESIGN_MAPS.md §4.2): the sketch's pins + zone
    // points SCALE proportionally onto the image (relative layout is the
    // meaning; absolute coords were only ever the arbitrary square). One
    // confirm states what will happen — no options fork (Titus's
    // call). Image→image swaps never scale (§4.1: coords are geography).
    const wasImageless = !m.image_url && !m.image_media_id;
    let spatialCounts: { pins: number; markers: number } | null = null;
    if (wasImageless) {
      spatialCounts = await countSpatialOnMap(store, m.id);
      const phrase = spatialPhrase(spatialCounts);
      if (phrase && !confirm(
        `This map's blank canvas holds ${phrase}. They will scale with the canvas onto the image. Set the image?`,
      )) return;
    }
    try {
      const media = await store.addMedia(m.id, file, 'base-image');
      const patch: Partial<WorldMap> = { image_media_id: media.id };
      // When no URL is set, this file IS the displayed background — persist
      // its natural dims so the canvas matches (mirrors the create flow and
      // the image_url auto-detect; without this, dims stamped by an imageless
      // create would stretch the file to the old canvas). URL-set maps skip:
      // dims track the URL image, the file is a hidden fallback.
      let dims: { w: number; h: number } | null = null;
      if (!m.image_url) {
        dims = await readImageDimsFromFile(file);
        if (dims) {
          patch.width = dims.w;
          patch.height = dims.h;
        }
      }
      await store.updateMap(m.id, patch);
      if (wasImageless && dims && spatialCounts && (spatialCounts.pins > 0 || spatialCounts.markers > 0)) {
        const from = {
          w: typeof m.width === 'number' && m.width > 0 ? m.width : IMAGELESS_MAP_SIZE,
          h: typeof m.height === 'number' && m.height > 0 ? m.height : IMAGELESS_MAP_SIZE,
        };
        const scaled = await rescaleSketchOntoImage(store, m.id, from, dims);
        if (scaled > 0) toasts.info(`${spatialPhrase(spatialCounts)} scaled onto the image`);
      }
      await refreshElementsAfterWrite(store);
      toasts.success(`Map image set: ${file.name}`);
      const hint = dims ? smallMapImageHint(dims) : null;
      if (hint) toasts.info(hint);
    } catch (err) {
      // No retry: the file is stored again on every attempt.
      console.error('[map-image] set image failed:', err);
      showProblem(err, { doing: 'setting the map image', toasts });
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
