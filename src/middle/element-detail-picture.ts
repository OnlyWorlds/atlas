/**
 * The "Upload picture" row (Atlas #154): under the image_url row, for an
 * element of an online world this browser can write to. A picked file goes
 * up through a keel ticket to the media edge (`sync/media-upload.ts`), and
 * its public URL becomes the element's `image_url` through the same save a
 * typed URL takes (`persistFieldPatch`: the push, and a map's dims).
 *
 * The write is aimed at the world the upload started in: if the person
 * moved to another world meanwhile, the picture's address is said instead of
 * written into whatever world is open (craft: capture the target).
 */

import type { ToastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { getState } from '../core/state';
import { uploadPicture, PICTURE_TYPES } from '../sync/media-upload';
import { persistFieldPatch } from './element-detail-fields';
import type { Element, WorldRegistryEntry } from '../core/types';

export const PICTURE_PUBLIC_LINE = 'Anyone with its link can see an uploaded picture, even in a private world.';

/** The open world's entry when it can take an uploaded picture, else null. */
export function pictureWorld(): WorldRegistryEntry | null {
  const id = getState().active?.worldId;
  const entry = id ? getState().registry.worlds.find(w => w.id === id) : undefined;
  return entry?.state === 'api-linked' && entry.api && !entry.api.read_only ? entry : null;
}

export function buildPictureUploadRow(el: Element, entry: WorldRegistryEntry, toasts: ToastManager): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-field atlas-picture-upload';
  wrap.dataset.field = 'upload_picture';

  const label = document.createElement('div');
  label.className = 'atlas-field-label';
  label.textContent = 'Upload picture';
  label.title = 'Puts a picture on OnlyWorlds and sets it as the image URL.';
  wrap.appendChild(label);

  const value = document.createElement('div');
  value.className = 'atlas-field-value atlas-picture-upload-value';
  wrap.appendChild(value);

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = PICTURE_TYPES.join(',');
  input.hidden = true;
  wrap.appendChild(input);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-picture-upload-btn';
  btn.dataset.action = 'upload-picture';
  btn.textContent = 'Choose a picture';
  btn.addEventListener('click', () => input.click());
  value.appendChild(btn);

  const hint = document.createElement('span');
  hint.className = 'atlas-picture-upload-hint';
  hint.textContent = PICTURE_PUBLIC_LINE;
  value.appendChild(hint);

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    btn.disabled = true;
    btn.textContent = 'Uploading…';
    try {
      const url = await uploadPicture(entry, getState().registry, file);
      if (getState().active?.worldId !== entry.id) {
        toasts.info(`The picture is on OnlyWorlds at ${url}, but another world is open now, so Atlas did not set it. Paste that address into the image URL of ${el.name || 'the element'}.`, 20_000);
        return;
      }
      await persistFieldPatch(el, 'image_url', url).catch(() => { /* toasted in persist */ });
      toasts.success('Picture uploaded and set as the image URL.');
    } catch (err) {
      showProblem(err, { doing: 'uploading the picture', toasts });
    } finally {
      btn.disabled = false;
      btn.textContent = 'Choose a picture';
    }
  });
  return wrap;
}
