/**
 * Settings → Editing tab (extracted from settings-panel session 233). Two
 * sections: element field-edit mode (modal / inline-single / inline-multi)
 * plus element-detail display toggles ("Referenced by" grouping,
 * confirm-before-delete), and the Maps header-label toggles.
 */

import { getState, patchSlice } from '../core/state';
import {
  saveRegistry,
  setMapsSettings,
  setEditorSettings,
  getEditorSettings,
  type FieldEditMode,
} from '../registry/registry';
import { ToastManager } from '../ui/toast-manager';
import { CONTENT_ELEMENT_TYPES, type ElementType, type WorldsRegistry } from '../core/types';
import { ELEMENT_LABELS } from '../core/constants';
import { loadUiPrefs, setDefaultCreateTypePref } from '../core/ui-prefs';

/** Types the create modal can default to — content types plus 'map'. */
const CREATABLE_TYPES: ElementType[] = [...CONTENT_ELEMENT_TYPES, 'map'];

export function renderEditingTab(reg: WorldsRegistry): string {
  return `
    ${renderEditingFieldModeSection()}
    ${renderMapsSection(reg)}
  `;
}

export function wireEditingTab(toasts: ToastManager): void {
  wireEditingFieldMode(toasts);
  wireMapsSection();
}

// ---- Element editing (field edit mode + element-detail display) ----

function renderEditingFieldModeSection(): string {
  const editor = getEditorSettings(getState().registry);
  const fieldMode = editor.field_edit_mode;
  const refsByField = editor.refs_group_by_field;
  const confirmDelete = editor.confirm_before_delete;
  const showImages = editor.show_element_images;
  const defaultCreateType = loadUiPrefs().defaultCreateType;
  const createTypeOptions = CREATABLE_TYPES
    .map((t) => `<option value="${t}" ${t === defaultCreateType ? 'selected' : ''}>${ELEMENT_LABELS[t].singular}</option>`)
    .join('');
  return `
    <section class="atlas-settings-section">
      <h3>Element editing</h3>
      <p class="atlas-settings-hint">How clicking a field's value opens the editor. Text selection (dragging across text) never opens the editor regardless of mode.</p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Default new-element type</label>
        <select class="atlas-select" name="default-create-type">${createTypeOptions}</select>
      </div>
      <p class="atlas-settings-hint">The category the "New element" dialog preselects (sidebar +, home, hotkey). You can still pick any type in the dialog.</p>
      <fieldset class="atlas-settings-fieldset">
        <legend>Field edit mode</legend>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="modal" ${fieldMode === 'modal' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Modal popover <span class="atlas-settings-default-tag">default</span></strong>
            <em>Floating panel anchored near the field. Enter to save, Esc to cancel.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="inline-single" ${fieldMode === 'inline-single' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Inline (single line)</strong>
            <em>Row transforms into a one-line input in place. Click away to save, Esc to cancel.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="field-edit-mode" value="inline-multi" ${fieldMode === 'inline-multi' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Inline (multi-line, ~4 rows)</strong>
            <em>Row transforms into a textarea in place. Ctrl+Enter to save, Esc to cancel.</em>
          </span>
        </label>
      </fieldset>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="refs-group-by-field" ${refsByField ? 'checked' : ''} />
        <span>Group "Referenced by" by relationship ("Rival of…", "Birthplace of…") instead of by element type</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="confirm-before-delete" ${confirmDelete ? 'checked' : ''} />
        <span>Ask for confirmation before deleting an element</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-element-images" ${showImages ? 'checked' : ''} />
        <span>Show element images (detail view banner + context pane thumbnail)</span>
      </label>
    </section>
  `;
}

function wireEditingFieldMode(toasts: ToastManager): void {
  // Field edit mode radio (session 219). Persists to registry.editor_settings.
  // The element-detail click handler reads this on every click — no reload
  // needed; the next field click uses the new mode immediately.
  const editModeInputs = document.querySelectorAll<HTMLInputElement>(
    '.atlas-settings input[name="field-edit-mode"]'
  );
  editModeInputs.forEach((inp) => {
    inp.addEventListener('change', () => {
      if (!inp.checked) return;
      const mode = inp.value as FieldEditMode;
      const next = setEditorSettings(getState().registry, { field_edit_mode: mode });
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.info(`Field edit mode: ${mode}`);
    });
  });

  // "Referenced by" grouping — type (default) vs relationship field. The
  // element-detail refs section reads this on each render, so flipping it
  // updates the open element live via the registry-slice subscription.
  const refsToggle = document.querySelector<HTMLInputElement>('.atlas-settings input[name="refs-group-by-field"]');
  refsToggle?.addEventListener('change', () => {
    const next = setEditorSettings(getState().registry, { refs_group_by_field: refsToggle.checked });
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(`References grouped by ${refsToggle.checked ? 'relationship' : 'type'}`);
  });

  const confirmDeleteToggle = document.querySelector<HTMLInputElement>('.atlas-settings input[name="confirm-before-delete"]');
  confirmDeleteToggle?.addEventListener('change', () => {
    const next = setEditorSettings(getState().registry, { confirm_before_delete: confirmDeleteToggle.checked });
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(`Delete confirmation ${confirmDeleteToggle.checked ? 'on' : 'off'}`);
  });

  // Element images toggle — also reachable from the detail banner's × and the
  // header icon-thumbnail, which flip the same registry setting.
  const showImagesToggle = document.querySelector<HTMLInputElement>('.atlas-settings input[name="show-element-images"]');
  showImagesToggle?.addEventListener('change', () => {
    const next = setEditorSettings(getState().registry, { show_element_images: showImagesToggle.checked });
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(`Element images ${showImagesToggle.checked ? 'shown' : 'hidden'}`);
  });

  // Default new-element type — an app-level UI pref (localStorage), read by
  // ElementCreateModal when opened without an explicit type. No registry write.
  const createTypeSel = document.querySelector<HTMLSelectElement>('.atlas-settings select[name="default-create-type"]');
  createTypeSel?.addEventListener('change', () => {
    const t = createTypeSel.value as ElementType;
    if (!CREATABLE_TYPES.includes(t)) return;
    setDefaultCreateTypePref(t);
    toasts.info(`Default new-element type: ${ELEMENT_LABELS[t].singular}`);
  });
}

// ---- Maps subsystem settings (DESIGN_MAPS.md §3.5) ----

function renderMapsSection(reg: WorldsRegistry): string {
  const s = reg.maps_settings ?? {};
  const showMaps = !!s.show_map_names_in_header;
  const showPinMaps = !!s.show_pin_map_names_in_header;
  const showPinnedEls = !!s.show_pinned_element_names_in_header;
  return `
    <section class="atlas-settings-section">
      <h3>Maps</h3>
      <p class="atlas-settings-hint">How atlas renders maps and map affordances across the UI. Label toggles default off — tighter icon-only layout. Flip on for explicit names.</p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-map-names-in-header" ${showMaps ? 'checked' : ''} />
        <span>Show map names alongside map icons in element header</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-pin-map-names-in-header" ${showPinMaps ? 'checked' : ''} />
        <span>Show map names alongside pin icons in element header</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-pinned-element-names-in-header" ${showPinnedEls ? 'checked' : ''} />
        <span>Show element names alongside category icons on Map detail</span>
      </label>
    </section>
  `;
}

function wireMapsSection(): void {
  // Three independent toggles all stored on registry.maps_settings via the
  // partial-merge setMapsSettings helper. No info toasts — the visible state
  // change in element-detail headers is its own feedback.
  const wireToggle = (
    name: string,
    key: 'show_map_names_in_header' | 'show_pin_map_names_in_header' | 'show_pinned_element_names_in_header',
  ): void => {
    const el = document.querySelector<HTMLInputElement>(`.atlas-settings input[name="${name}"]`);
    el?.addEventListener('change', () => {
      const next = setMapsSettings(getState().registry, { [key]: el.checked });
      saveRegistry(next);
      patchSlice('registry', next);
    });
  };
  wireToggle('show-map-names-in-header', 'show_map_names_in_header');
  wireToggle('show-pin-map-names-in-header', 'show_pin_map_names_in_header');
  wireToggle('show-pinned-element-names-in-header', 'show_pinned_element_names_in_header');
}
