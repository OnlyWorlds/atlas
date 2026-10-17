/**
 * Zone create modal (ZC10 + ZD6).
 *
 * Opens after the user clicks Finish on a draft zone. Captures intent up
 * front: name (auto-selected), supertype (free text — OW taxonomy), subtype
 * (free text — OW taxonomy). Shape (polygon vs line) is LOCKED from the
 * draft mode — not user-pickable here — and stored in the atlas-local
 * `atlas_shape` field. Captain's call: shape choice in a modal felt messy,
 * supertype/subtype should be free text for user-meaningful taxonomy
 * instead of being misused for shape.
 *
 * Submit → resolve with the values; Cancel → resolve null and the caller
 * keeps the draft active.
 */

import { BaseModal } from './modal-base';
import { escapeAttr } from '../core/dom-utils';
// The kinds a styled map draws (S423): offered, never required.
import { ZONE_KIND_WORDS } from '../core/map-ink';

export type ZoneShape = 'polygon' | 'line';

export interface ZoneCreateValues {
  name: string;
  supertype: string | undefined; // empty input → undefined
  subtype: string | undefined;   // empty input → undefined
}

export interface ZoneCreateOpts {
  /** Shape locked from the draft. Displayed as a read-only badge in the modal. */
  shape: ZoneShape;
  /** Pre-filled name (typically "new zone" or "new line" with auto-numbering). */
  defaultName: string;
}

class ZoneCreateModal extends BaseModal {
  private resolveFn: ((value: ZoneCreateValues | null) => void) | null = null;

  open(opts: ZoneCreateOpts): Promise<ZoneCreateValues | null> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;

      const { overlay, body } = this.buildModalShell({
        title: 'New zone',
        dataModal: 'zone-create',
      });

      const shapeIcon = opts.shape === 'line' ? 'show_chart' : 'hexagon';

      body.innerHTML = `
        <div class="atlas-zone-create-shape-badge" data-role="zone-create-shape-badge">
          <span class="material-symbols-outlined">${shapeIcon}</span>
          <span>${opts.shape.charAt(0).toUpperCase()}${opts.shape.slice(1)}</span>
        </div>

        <div class="atlas-modal-field">
          <label class="atlas-modal-label" for="zone-create-name">Name</label>
          <input
            type="text"
            id="zone-create-name"
            class="atlas-input"
            data-role="zone-create-name"
            value="${escapeAttr(opts.defaultName)}"
            autocomplete="off"
          />
        </div>

        <div class="atlas-modal-field">
          <label class="atlas-modal-label" for="zone-create-supertype">Supertype <span class="atlas-modal-label-hint">(optional)</span></label>
          <input
            type="text"
            id="zone-create-supertype"
            class="atlas-input"
            data-role="zone-create-supertype"
            placeholder="e.g. regions, districts, biomes…"
            autocomplete="off"
          />
        </div>

        <div class="atlas-modal-field">
          <label class="atlas-modal-label" for="zone-create-subtype">Subtype <span class="atlas-modal-label-hint">(optional)</span></label>
          <input
            type="text"
            id="zone-create-subtype"
            class="atlas-input"
            data-role="zone-create-subtype"
            placeholder="E.g. Landmass, River, Forest…"
            autocomplete="off"
            list="zone-create-kinds"
          />
          <datalist id="zone-create-kinds">${ZONE_KIND_WORDS.map(w => `<option value="${w}"></option>`).join('')}</datalist>
        </div>

        <div class="atlas-modal-error" data-role="zone-create-error" hidden></div>

        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="button" class="atlas-btn-primary" data-action="create">Create zone</button>
        </div>
      `;

      const nameInput = body.querySelector<HTMLInputElement>('[data-role="zone-create-name"]')!;
      const supertypeInput = body.querySelector<HTMLInputElement>('[data-role="zone-create-supertype"]')!;
      const subtypeInput = body.querySelector<HTMLInputElement>('[data-role="zone-create-subtype"]')!;
      const errorBox = body.querySelector<HTMLElement>('[data-role="zone-create-error"]')!;

      // B6 (S368): an empty name used to do nothing at all. Same rule and
      // same words as the element create modal: say it, clear it on typing.
      nameInput.addEventListener('input', () => {
        if (nameInput.value.trim()) errorBox.hidden = true;
      });

      const submit = () => {
        const name = nameInput.value.trim();
        if (!name) {
          errorBox.textContent = 'Name is required';
          errorBox.hidden = false;
          nameInput.focus();
          nameInput.select();
          return;
        }
        const supertype = supertypeInput.value.trim() || undefined;
        const subtype = subtypeInput.value.trim() || undefined;
        const r = this.resolveFn;
        this.resolveFn = null;
        this.hide();
        r?.({ name, supertype, subtype });
      };

      const cancel = () => {
        const r = this.resolveFn;
        this.resolveFn = null;
        this.hide();
        r?.(null);
      };

      body.querySelector('[data-action="create"]')?.addEventListener('click', submit);
      body.querySelector('[data-action="cancel"]')?.addEventListener('click', cancel);

      // Enter on any input submits.
      const enterSubmit = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
      };
      nameInput.addEventListener('keydown', enterSubmit);
      supertypeInput.addEventListener('keydown', enterSubmit);
      subtypeInput.addEventListener('keydown', enterSubmit);

      // BaseModal's Esc / overlay-click don't resolve our promise — patch
      // hide to resolve null if still pending.
      const origHide = this.hide.bind(this);
      this.hide = () => {
        const r = this.resolveFn;
        this.resolveFn = null;
        origHide();
        r?.(null);
      };

      this.modal = overlay;
      this.show();

      // Auto-focus + select the name. Modal animation runs ~one tick; defer.
      queueMicrotask(() => {
        nameInput.focus();
        nameInput.select();
      });
    });
  }
}

/** Open the modal once, return the chosen values or null on cancel. */
export function openZoneCreateModal(opts: ZoneCreateOpts): Promise<ZoneCreateValues | null> {
  return new ZoneCreateModal().open(opts);
}


