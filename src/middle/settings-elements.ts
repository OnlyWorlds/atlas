/**
 * Settings → Elements tab (renamed from the Editing tab 2026-07-19; the Maps
 * section it used to carry moved to settings-maps.ts). Element field-edit mode
 * (modal / inline-single / inline-multi), default new-element type, and
 * element-detail display toggles ("Referenced by" grouping,
 * confirm-before-delete, element images).
 */

import { getState, patchSlice } from '../core/state';
import {
  saveRegistry,
  setEditorSettings,
  getEditorSettings,
  type FieldEditMode,
} from '../registry/registry';
import { ToastManager } from '../ui/toast-manager';
import { CONTENT_ELEMENT_TYPES, type ElementType, type TypeStripNames } from '../core/types';
import { typeName } from '../core/type-words';
import { escapeText } from '../core/dom-utils';
import { loadUiPrefs, setDefaultCreateTypePref } from '../core/ui-prefs';

/** Types the create modal can default to — content types plus 'map'. */
const CREATABLE_TYPES: ElementType[] = [...CONTENT_ELEMENT_TYPES, 'map'];

export function renderElementsTab(): string {
  const editor = getEditorSettings(getState().registry);
  const fieldMode = editor.field_edit_mode;
  const refsByField = editor.refs_group_by_field;
  const confirmDelete = editor.confirm_before_delete;
  const showImages = editor.show_element_images;
  const hideEmpty = editor.hide_empty_fields;
  const stripNames = editor.type_strip_names;
  const defaultCreateType = loadUiPrefs().defaultCreateType;
  const createTypeOptions = CREATABLE_TYPES
    .map((t) => `<option value="${t}" ${t === defaultCreateType ? 'selected' : ''}>${escapeText(typeName(t))}</option>`)
    .join('');
  return `
    <section class="atlas-settings-section">
      <h3>Element editing</h3>
      <p class="atlas-settings-hint">How clicking a field's value opens the editor. Text selection (dragging across text) never opens the editor regardless of mode.</p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Default new-element type</label>
        <select class="atlas-select" name="default-create-type">${createTypeOptions}</select>
      </div>
      <p class="atlas-settings-hint">The type the "New element" dialog preselects (sidebar +, home, hotkey). You can still pick another in the dialog.</p>
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
        <span>Group "Linked from" by relationship ("Rival of…", "Birthplace of…") instead of by element type</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="confirm-before-delete" ${confirmDelete ? 'checked' : ''} />
        <span>Ask for confirmation before deleting an element</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-element-images" ${showImages ? 'checked' : ''} />
        <span>Show element images (detail view banner + web pane thumbnail)</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="hide-empty-fields" ${hideEmpty ? 'checked' : ''} />
        <span>Hide empty fields on element pages. An element with nothing filled in still shows its first section.</span>
      </label>
      <fieldset class="atlas-settings-fieldset">
        <legend>Type names in the sidebar</legend>
        <label class="atlas-settings-radio">
          <input type="radio" name="type-strip-names" value="icons" ${stripNames === 'icons' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Icons only <span class="atlas-settings-default-tag">default</span></strong>
            <em>The row of type icons over the element list. Hover an icon for its name.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="type-strip-names" value="held" ${stripNames === 'held' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Name the types this world has</strong>
            <em>Each with its count. The empty types stay icons below them.</em>
          </span>
        </label>
        <label class="atlas-settings-radio">
          <input type="radio" name="type-strip-names" value="all" ${stripNames === 'all' ? 'checked' : ''} />
          <span class="atlas-settings-radio-body">
            <strong>Name every type</strong>
            <em>Two columns. The element list starts further down.</em>
          </span>
        </label>
      </fieldset>
    </section>
  `;
}

export function wireElementsTab(toasts: ToastManager): void {
  // Field edit mode radio. Persists to registry.editor_settings.
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

  // Hide empty fields (#24): also flipped from the line under an element's fields.
  const hideEmptyToggle = document.querySelector<HTMLInputElement>('.atlas-settings input[name="hide-empty-fields"]');
  hideEmptyToggle?.addEventListener('change', () => {
    const next = setEditorSettings(getState().registry, { hide_empty_fields: hideEmptyToggle.checked });
    saveRegistry(next);
    patchSlice('registry', next);
    toasts.info(`Empty fields ${hideEmptyToggle.checked ? 'hidden' : 'shown'}`);
  });

  // Names on the sidebar's type strip (#24). The sidebar reads the registry on every
  // render, so the strip changes the moment the radio does.
  document.querySelectorAll<HTMLInputElement>('.atlas-settings input[name="type-strip-names"]').forEach((inp) => {
    inp.addEventListener('change', () => {
      if (!inp.checked) return;
      const value = inp.value as TypeStripNames;
      const next = setEditorSettings(getState().registry, { type_strip_names: value });
      saveRegistry(next);
      patchSlice('registry', next);
      toasts.info(value === 'icons' ? 'Type names: icons only' : value === 'held' ? 'Type names: the types this world has' : 'Type names: every type');
    });
  });

  // Default new-element type — an app-level UI pref (localStorage), read by
  // ElementCreateModal when opened without an explicit type. No registry write.
  const createTypeSel = document.querySelector<HTMLSelectElement>('.atlas-settings select[name="default-create-type"]');
  createTypeSel?.addEventListener('change', () => {
    const t = createTypeSel.value as ElementType;
    if (!CREATABLE_TYPES.includes(t)) return;
    setDefaultCreateTypePref(t);
    toasts.info(`Default new-element type: ${typeName(t)}`);
  });
}
