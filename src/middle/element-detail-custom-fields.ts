/**
 * Custom fields section for element detail (D9).
 *
 * Renders every user-editable extension field on the element (x_/shadow_/
 * non-machinery atlas_ keys) as normal field rows via the shared
 * `renderSection` machinery — click-to-edit, autosave, sync push all work
 * unchanged. Adds:
 *   - a quiet `+ add field` row (always visible but on a view-only world, the feature's discoverability)
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
import { isCustomEditableField, isPopulatedCustomValue, isProfileField, PROFILE_FIELD_PREFIXES } from '../core/constants';
import { getActiveStore } from '../core/active-store';
import { worldIsViewOnly } from '../core/view-only';
import { refreshElementsAfterWrite } from '../sync/sync-attach';
import { knownFieldsFor, type FieldMeta, type WidgetKind, type SectionLayout } from '../editor/field-schema';
import { renderSection, humanizeFieldName } from './element-detail-fields';
import { customFieldNameSuggestions } from '../core/taxonomy';
import { toastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import { TANGLE_CARD_RENDERERS } from './tangle-cards';
import { WORLD_NOT_OPEN } from './element-detail-fields';

const SECTION_NAME = 'Custom fields';
const MAX_FIELD_NAME_LEN = 60;

/**
 * When set, the next render of the custom section for this element opens the
 * value editor on this field — the add-flow's "name then value in one
 * gesture" (same pattern as element-detail-header's pending inline name edit).
 */
let pendingEdit: { elementId: string; fieldName: string } | null = null;

/** The pending edit, for the page's rebuild gate: a request is an input to the next render. */
export function pendingCustomFieldEdit(): string | null {
  return pendingEdit ? `${pendingEdit.elementId}|${pendingEdit.fieldName}` : null;
}

/**
 * Custom-field rows for an element: non-machinery extension keys, null =
 * deleted (hidden). SCALAR values only — object/array values are STRUCTURED
 * data written by other tools (tangle battle records, magelet sidecars) and
 * must never render as an editable text row: `String(value)` shows
 * "[object Object]" and one save destroys the structure (gate A13, the
 * extension-edit hazard). Those render via structuredFieldEntriesFor.
 */
export function customFieldMetasFor(el: Element): FieldMeta[] {
  const out: FieldMeta[] = [];
  for (const [k, v] of Object.entries(el)) {
    if (!isCustomEditableField(k)) continue;
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') continue; // structured — read-only row below
    out.push({ name: k, widget: inferWidget(v) });
  }
  return out;
}

/** Object/array-valued extension fields: shown read-only, deletable, never editable. */
export function structuredFieldEntriesFor(el: Element): Array<{ name: string; value: unknown }> {
  const out: Array<{ name: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(el)) {
    if (!isCustomEditableField(k)) continue;
    if (v === null || v === undefined || typeof v !== 'object') continue;
    out.push({ name: k, value: v });
  }
  return out;
}

/** Published profile keys (`x_identity_key`): shown read-only, never editable or deletable here. */
export function profileFieldEntriesFor(el: Element): Array<{ name: string; value: unknown }> {
  const out: Array<{ name: string; value: unknown }> = [];
  for (const [k, v] of Object.entries(el)) {
    if (!isProfileField(k)) continue;
    if (v === null || v === undefined || v === '') continue;
    out.push({ name: k, value: v });
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
  if (input_is_atlas_namespace(key)) return 'Atlas keeps atlas_ names for itself';
  // Named from the list itself: a hand-typed copy fell a prefix behind (x_review_, S450).
  if (isProfileField(key)) return `That name is kept for a shared field other tools read (${PROFILE_FIELD_PREFIXES.join(', ')}). Pick another.`;
  const bare = key.startsWith('x_') ? key.slice(2) : key.startsWith('shadow_') ? key.slice(7) : key;
  if (knownFieldsFor(el.type).has(bare)) {
    return `"${humanizeFieldName(bare)}" is a built-in field for this type: use that field instead`;
  }
  if (!isCustomEditableField(key)) return 'Atlas uses that name itself. Pick another.';
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
 * A view-only world gets the rows alone: no add row, no ×, and no section at
 * all when the element has none (the store would refuse the write; S435's
 * read-key walk). Null then.
 */
export function buildCustomFieldsSection(el: Element): HTMLElement | null {
  const viewOnly = worldIsViewOnly();
  const fields = customFieldMetasFor(el);
  const structured = structuredFieldEntriesFor(el);
  const profiles = profileFieldEntriesFor(el);
  if (viewOnly && fields.length === 0 && structured.length === 0 && profiles.length === 0) return null;
  const layout: SectionLayout = { name: SECTION_NAME, order: 999, fields };
  const section = renderSection(layout, el, false, viewOnly ? { allowEmpty: structured.length + profiles.length > 0 } : {
    allowEmpty: true,
    onRemoveField: (fieldName) => { void removeField(el, fieldName); },
  });
  if (!section) return null;
  section.classList.add('atlas-custom-fields-section');

  // Concise how-it-works on hover (Captain's ask, 2026-07-12). Voice: plain
  // statements, no em-dashes.
  const headerLabel = section.querySelector<HTMLElement>('.atlas-detail-section-header span');
  if (headerLabel) {
    headerLabel.title = viewOnly
      ? 'Fields of its own on this element. They sync, import, and export like any other data.'
      : 'Your own fields for this element. They sync, import, and export like any other data.';
  }

  // The add row lives inside the section body (collapsed section hides it too).
  const body = section.querySelector<HTMLElement>('.atlas-detail-section-body');
  if (body) {
    // Structured (object/array) extension fields: read-only rows ABOVE the
    // add row. Label + pretty JSON in a quiet mono block; deletable with the
    // same confirm as scalar rows, never editable (the destruction class).
    for (const entry of structured) {
      // Known tool records get a real card (tangle battles, tropaia) —
      // still read-only, still deletable below via the same confirmed ×.
      const renderCard = TANGLE_CARD_RENDERERS[entry.name];
      const cardEl = renderCard ? renderCard(entry.value) : null;
      if (cardEl) {
        const wrap = document.createElement('div');
        wrap.className = 'atlas-custom-structured-row atlas-custom-structured-card';
        if (!viewOnly) wrap.appendChild(structuredRemoveButton(el, entry.name));
        wrap.appendChild(cardEl);
        body.appendChild(wrap);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'atlas-custom-structured-row';
      const label = document.createElement('div');
      label.className = 'atlas-custom-structured-label';
      label.textContent = humanizeFieldName(entry.name);
      label.title = `${entry.name}: structured data written by another tool. Atlas shows it read-only so it cannot be damaged here.`;
      const pre = document.createElement('pre');
      pre.className = 'atlas-custom-structured-value';
      let text: string;
      try { text = JSON.stringify(entry.value, null, 2); } catch { text = String(entry.value); }
      pre.textContent = text;
      row.appendChild(label);
      if (!viewOnly) row.appendChild(structuredRemoveButton(el, entry.name));
      row.appendChild(pre);
      body.appendChild(row);
    }
    // A published profile's key: its value, read only, with no ×. Changing or
    // removing it would merge or split a being for every tool that reads it.
    for (const entry of profiles) {
      const row = document.createElement('div');
      row.className = 'atlas-custom-structured-row';
      row.dataset.profileField = entry.name;
      const label = document.createElement('div');
      label.className = 'atlas-custom-structured-label';
      label.textContent = humanizeFieldName(entry.name);
      label.title = `${entry.name}: says which elements, in this world or others, are the same being. Atlas shows it read-only.`;
      const value = document.createElement('pre');
      value.className = 'atlas-custom-structured-value';
      value.textContent = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
      row.appendChild(label);
      row.appendChild(value);
      body.appendChild(row);
    }
    if (!viewOnly) body.appendChild(buildAddRow(el));
  }

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

function structuredRemoveButton(el: Element, fieldName: string): HTMLButtonElement {
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'atlas-custom-structured-remove';
  del.title = `Remove ${humanizeFieldName(fieldName)} from this element`;
  del.textContent = '×';
  del.addEventListener('click', () => { void removeField(el, fieldName, { alwaysConfirm: true }); });
  return del;
}

async function removeField(el: Element, fieldName: string, opts?: { alwaysConfirm?: boolean }): Promise<void> {
  const value = (el as Record<string, unknown>)[fieldName];
  // alwaysConfirm: structured (object) values return FALSE from
  // isPopulatedCustomValue, which silently skipped the confirm on exactly
  // the data the read-only row exists to protect (close-gate BLOCKER,
  // 2026-07-19). The structured × passes it explicitly.
  if (isPopulatedCustomValue(value) || opts?.alwaysConfirm) {
    const ok = window.confirm(`Remove "${humanizeFieldName(fieldName)}" and its value from this element?`);
    if (!ok) return;
  }
  await removeFieldNow(el.id, fieldName);
}

/** The write itself, after any confirm. "Retry now" reruns it: the same null again is safe. */
async function removeFieldNow(elementId: string, fieldName: string): Promise<void> {
  const store = getActiveStore();
  if (!store) { toastManager.error(WORLD_NOT_OPEN); return; }
  try {
    // null (not key-removal) — the push must carry an explicit clear or the
    // server keeps the old value and the next pull resurrects the field.
    await store.updateElement(elementId, { [fieldName]: null } as Partial<Element>);
    await refreshElementsAfterWrite(store);
  } catch (err) {
    console.error('[custom-fields] remove failed:', err);
    // No retry (gate B L1): the field may have been added again since.
    showProblem(err, { doing: 'removing this field' });
  }
}

async function createField(el: Element, key: string): Promise<void> {
  const store = getActiveStore();
  if (!store) { toastManager.error(WORLD_NOT_OPEN); return; }
  try {
    pendingEdit = { elementId: el.id, fieldName: key };
    await store.updateElement(el.id, { [key]: '' } as Partial<Element>);
    await refreshElementsAfterWrite(store);
  } catch (err) {
    pendingEdit = null;
    console.error('[custom-fields] create failed:', err);
    showProblem(err, { doing: 'adding this field' });
  }
}

function buildAddRow(el: Element): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-custom-add-row';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-custom-add-btn';
  btn.textContent = '+ Add field';
  btn.title = 'Name a field, then fill in its value. Names you have used elsewhere in this world are suggested. Stored with an x_ prefix so it never collides with OnlyWorlds fields.';
  row.appendChild(btn);

  btn.addEventListener('click', () => {
    btn.style.display = 'none';

    const form = document.createElement('div');
    form.className = 'atlas-custom-add-form';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'atlas-custom-add-input';
    input.placeholder = 'Field name';
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
