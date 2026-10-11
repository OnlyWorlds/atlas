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
import { uploadPicture, removePicture, uploadedPictureKey, PICTURE_TYPES } from '../sync/media-upload';
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

  // An uploaded picture of this world can be removed from OnlyWorlds (Boss's
  // removal contract, h37 #2354; Keel #170).
  const key = uploadedPictureKey(el.image_url, entry.api?.world_id ?? '');
  if (key) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'atlas-picture-upload-btn atlas-picture-remove-btn';
    remove.dataset.action = 'remove-picture';
    remove.textContent = 'Remove picture';
    remove.title = 'Deletes this picture from OnlyWorlds and clears every image URL here that shows it.';
    remove.addEventListener('click', () => { void removeFlow(el, entry, key, remove, toasts); });
    value.appendChild(remove);
  }

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

/** The elements of the open world whose image URL shows the picture at `key`. */
export function elementsShowing(key: string, elements: readonly Element[]): Element[] {
  const suffix = '/' + key;
  return elements.filter(e => typeof e.image_url === 'string' && e.image_url.split(/[?#]/)[0].endsWith(suffix));
}

/**
 * Remove: the question first, counted from this browser's copy of the world
 * (keel holds a second removal ticket back for ten minutes, so the ticket is
 * asked for only after a yes); then the removal; then every image URL here
 * that showed the picture is cleared through the normal save, so it syncs.
 */
async function removeFlow(el: Element, entry: WorldRegistryEntry, key: string, btn: HTMLButtonElement, toasts: ToastManager): Promise<void> {
  const showing = elementsShowing(key, getState().data.elements);
  const others = showing.filter(e => e.id !== el.id);
  const name = el.name || 'this element';
  const lines = [
    'Remove this picture from OnlyWorlds for good?',
    'It leaves OnlyWorlds at once, but copies already loaded elsewhere can keep showing for a long time.',
    others.length === 0
      ? `The image URL of ${name} is cleared.`
      : `It is also the picture of ${others.length} other element${others.length === 1 ? '' : 's'} here (${others.slice(0, 3).map(e => e.name || 'unnamed').join(', ')}${others.length > 3 ? ', and more' : ''}). Atlas clears their image URLs too.`,
  ];
  if (!window.confirm(lines.join('\n\n'))) return;
  btn.disabled = true;
  btn.textContent = 'Removing…';
  try {
    const { referenced } = await removePicture(entry, getState().registry, key);
    if (getState().active?.worldId !== entry.id) {
      toasts.info(`The picture is removed from OnlyWorlds. Another world is open now, so Atlas did not clear the image URLs that showed it in ${entry.name || 'that world'}.`, 20_000);
      return;
    }
    // Clear from the copy as it is now (an edit may have landed meanwhile).
    const now = elementsShowing(key, getState().data.elements);
    for (const e of now) await persistFieldPatch(e, 'image_url', null).catch(() => { /* toasted in persist */ });
    const elsewhere = referenced - showing.length;
    toasts.success('Picture removed from OnlyWorlds'
      + (now.length > 0 ? ` and cleared from ${now.length === 1 ? 'its element' : `${now.length} elements`}.` : '.')
      + (elsewhere > 0 ? ` ${elsewhere} more element${elsewhere === 1 ? '' : 's'} on OnlyWorlds, not yet in this copy, use it; they will show no picture.` : ''));
  } catch (err) {
    showProblem(err, { doing: 'removing the picture', toasts });
  } finally {
    btn.disabled = false;
    btn.textContent = 'Remove picture';
  }
}
