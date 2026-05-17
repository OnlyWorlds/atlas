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
        title: 'new zone',
        dataModal: 'zone-create',
      });

      const shapeIcon = opts.shape === 'line' ? 'show_chart' : 'hexagon';

      body.innerHTML = `
        <div class="atlas-zone-create-shape-badge" data-role="zone-create-shape-badge">
          <span class="material-symbols-outlined">${shapeIcon}</span>
          <span>${opts.shape}</span>
        </div>

        <div class="atlas-modal-field">
          <label class="atlas-modal-label" for="zone-create-name">name</label>
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
          <label class="atlas-modal-label" for="zone-create-supertype">supertype <span class="atlas-modal-label-hint">(optional)</span></label>
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
          <label class="atlas-modal-label" for="zone-create-subtype">subtype <span class="atlas-modal-label-hint">(optional)</span></label>
          <input
            type="text"
            id="zone-create-subtype"
            class="atlas-input"
            data-role="zone-create-subtype"
            placeholder="e.g. forest, road, plaza…"
            autocomplete="off"
          />
        </div>

        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">cancel</button>
          <button type="button" class="atlas-btn-primary" data-action="create">create zone</button>
        </div>
      `;

      const nameInput = body.querySelector<HTMLInputElement>('[data-role="zone-create-name"]')!;
      const supertypeInput = body.querySelector<HTMLInputElement>('[data-role="zone-create-supertype"]')!;
      const subtypeInput = body.querySelector<HTMLInputElement>('[data-role="zone-create-subtype"]')!;

      const submit = () => {
        const name = nameInput.value.trim();
        if (!name) {
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

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
