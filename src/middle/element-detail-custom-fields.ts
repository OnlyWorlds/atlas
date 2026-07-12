/**
 * Custom fields section for element detail (D9).
 *
 * Renders every user-editable extension field on the element (x_/shadow_/
 * non-machinery atlas_ keys) as normal field rows via the shared
 * `renderSection` machinery — click-to-edit, autosave, sync push all work
 * unchanged. Adds:
 *   - a quiet `+ add field` row (always visible, the feature's discoverability)
 *     with a datalist over custom names already used across the world;
 *   - a per-row × that deletes the field by persisting `null` (the wire's
 *     clear semantics — keel keeps null-valued extension keys, probed
 *     2026-07-12; render skips null so the row disappears).
 *
 * Naming contract: the user types `mood`, disk gets `x_mood`. Labels hide the
 * prefix (humanizeFieldName); the row tooltip discloses the stored key.
 * Explicit `x_`/`shadow_` prefixes typed by the user are respected; `atlas_`
 * is rejected (machinery namespace).
 */

import type { Element } from '../core/types';
import { isCustomEditableField, isPopulatedCustomValue } from '../core/constants';
import { getActiveStore } from '../core/active-store';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { knownFieldsFor, type FieldMeta, type WidgetKind, type SectionLayout } from '../editor/field-schema';
import { renderSection, humanizeFieldName } from './element-detail-fields';
import { customFieldNameSuggestions } from '../core/taxonomy';
import { toastManager } from '../ui/toast-manager';

const SECTION_NAME = 'Custom fields';
const MAX_FIELD_NAME_LEN = 60;

/**
 * When set, the next render of the custom section for this element opens the
 * value editor on this field — the add-flow's "name then value in one
 * gesture" (same pattern as element-detail-header's pending inline name edit).
 */
let pendingEdit: { elementId: string; fieldName: string } | null = null;

/** Custom-field rows for an element: non-machinery extension keys, null = deleted (hidden). */
export function customFieldMetasFor(el: Element): FieldMeta[] {
  const out: FieldMeta[] = [];
  for (const [k, v] of Object.entries(el)) {
    if (!isCustomEditableField(k)) continue;
    if (v === null || v === undefined) continue;
    out.push({ name: k, widget: inferWidget(v) });
  }
  return out;
}

function inferWidget(value: unknown): WidgetKind {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string' && value.length > 120) return 'text-long';
  return 'text-short';
}

/**
 * Normalize a typed field name to its stored key. Lowercases, folds runs of
 * non-letter/number characters to `_` (unicode-aware — keel accepts unicode
 * names, probed), trims underscores, caps length, prefixes `x_` unless the
 * user typed an explicit x_/shadow_ prefix.
 */
export function normalizeCustomFieldName(input: string): string {
  let raw = input.trim().toLowerCase();
  let prefix = 'x_';
  if (raw.startsWith('x_')) { raw = raw.slice(2); }
  else if (raw.startsWith('shadow_')) { prefix = 'shadow_'; raw = raw.slice(7); }
  // atlas_ keeps its prefix so customFieldNameProblem rejects it as reserved
  // (silently minting x_atlas_* would mangle instead of teaching).
  else if (raw.startsWith('atlas_')) { prefix = 'atlas_'; raw = raw.slice(6); }
  const slug = raw
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_FIELD_NAME_LEN);
  return slug ? prefix + slug : '';
}

/** Reject reason for a candidate stored key on this element, or null when fine. */
export function customFieldNameProblem(el: Element, key: string): string | null {
  if (!key) return 'Enter a field name';
  if (input_is_atlas_namespace(key)) return 'The atlas_ namespace is reserved';
  const bare = key.startsWith('x_') ? key.slice(2) : key.startsWith('shadow_') ? key.slice(7) : key;
  if (knownFieldsFor(el.type).has(bare)) {
    return `"${humanizeFieldName(bare)}" is a built-in field for this type — use that field instead`;
  }
  if (!isCustomEditableField(key)) return 'That name is reserved for atlas machinery';
  const current = (el as Record<string, unknown>)[key];
  if (current !== undefined && current !== null) {
    return `"${humanizeFieldName(key)}" already exists on this element`;
  }
  return null;
}

function input_is_atlas_namespace(key: string): boolean {
  return key.startsWith('atlas_');
}

/**
 * Build the whole custom-fields section (section shell + rows + add row).
 * Returns the section element; re-renders happen through the normal
 * element-detail subscription (persist → new elements array → render).
 */
export function buildCustomFieldsSection(el: Element): HTMLElement {
  const layout: SectionLayout = { name: SECTION_NAME, order: 999, fields: customFieldMetasFor(el) };
  const section = renderSection(layout, el, false, {
    allowEmpty: true,
    onRemoveField: (fieldName) => { void removeField(el, fieldName); },
  })!;
  section.classList.add('atlas-custom-fields-section');

  // Concise how-it-works on hover (Captain's ask, 2026-07-12). Voice: plain
  // statements, no em-dashes.
  const headerLabel = section.querySelector<HTMLElement>('.atlas-detail-section-header span');
  if (headerLabel) {
    headerLabel.title = 'Your own fields for this element. They sync, import, and export like any other data.';
  }

  // The add row lives inside the section body (collapsed section hides it too).
  const body = section.querySelector<HTMLElement>('.atlas-detail-section-body');
  if (body) body.appendChild(buildAddRow(el));

  // Add-flow continuation: open the value editor on the just-created row.
  // Timing matters: element-detail restores the pane's scrollTop in a
  // queueMicrotask AFTER this section is built — a microtask click here
  // would measure the anchor's rect against the UNSCROLLED layout and the
  // popover would land at the bottom of the page (Captain's live find,
  // 2026-07-12). rAF runs after all microtasks (scroll restored) and before
  // paint; scrollIntoView pins the row on-screen so the anchor rect is real.
  if (pendingEdit && pendingEdit.elementId === el.id) {
    const field = pendingEdit.fieldName;
    pendingEdit = null;
    requestAnimationFrame(() => {
      const value = section.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"] .atlas-field-value`);
      if (!value) return;
      value.scrollIntoView({ block: 'nearest' });
      value.click();
    });
  }
  return section;
}

async function removeField(el: Element, fieldName: string): Promise<void> {
  const value = (el as Record<string, unknown>)[fieldName];
  if (isPopulatedCustomValue(value)) {
    const ok = window.confirm(`Remove "${humanizeFieldName(fieldName)}" and its value from this element?`);
    if (!ok) return;
  }
  const store = getActiveStore();
  if (!store) { toastManager.error('No active store'); return; }
  try {
    // null (not key-removal) — the push must carry an explicit clear or the
    // server keeps the old value and the next pull resurrects the field.
    await store.updateElement(el.id, { [fieldName]: null } as Partial<Element>);
    await refreshElementsAfterWrite(store);
  } catch (err) {
    console.error('[custom-fields] remove failed:', err);
    toastManager.error(err instanceof Error ? err.message : String(err));
  }
}

async function createField(el: Element, key: string): Promise<void> {
  const store = getActiveStore();
  if (!store) { toastManager.error('No active store'); return; }
  try {
    pendingEdit = { elementId: el.id, fieldName: key };
    await store.updateElement(el.id, { [key]: '' } as Partial<Element>);
    await refreshElementsAfterWrite(store);
  } catch (err) {
    pendingEdit = null;
    console.error('[custom-fields] create failed:', err);
    toastManager.error(err instanceof Error ? err.message : String(err));
  }
}

function buildAddRow(el: Element): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-custom-add-row';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-custom-add-btn';
  btn.textContent = '+ add field';
  btn.title = 'Name a field, then fill in its value. Names you have used elsewhere in this world are suggested. Stored with an x_ prefix so it never collides with OnlyWorlds fields.';
  row.appendChild(btn);

  btn.addEventListener('click', () => {
    btn.style.display = 'none';

    const form = document.createElement('div');
    form.className = 'atlas-custom-add-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atlas-custom-add-input';
    input.placeholder = 'field name';
    input.setAttribute('list', 'atlas-custom-field-names');
    input.maxLength = MAX_FIELD_NAME_LEN + 8;

    const datalist = document.createElement('datalist');
    datalist.id = 'atlas-custom-field-names';
    for (const name of customFieldNameSuggestions()) {
      const opt = document.createElement('option');
      opt.value = name;
      datalist.appendChild(opt);
    }

    const hint = document.createElement('div');
    hint.className = 'atlas-custom-add-hint';

    form.appendChild(input);
    form.appendChild(datalist);
    form.appendChild(hint);
    row.appendChild(form);
    input.focus();

    const close = () => { form.remove(); btn.style.display = ''; };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Enter') { hint.textContent = ''; return; }
      const key = normalizeCustomFieldName(input.value);
      const problem = customFieldNameProblem(el, key);
      if (problem) { hint.textContent = problem; return; }
      close();
      void createField(el, key);
    });
    input.addEventListener('blur', () => {
      // Give a datalist click a beat to land before folding the form away.
      setTimeout(() => { if (!input.value.trim() && form.isConnected) close(); }, 150);
    });
  });

  return row;
}
