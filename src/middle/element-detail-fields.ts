/**
 * Schema-driven field rendering for element-detail.
 *
 * Reads sections from `field-schema.ts` (SDK FIELD_SCHEMA + ELEMENT_SECTIONS).
 * Per-widget dispatch:
 *   - text-short / text-long / number → click value → popover edit (or inline,
 *     per `editor_settings.field_edit_mode`)
 *   - single-link → chip + pick button (opens picker modal)
 *   - multi-link → chips + add button
 *
 * Field click-vs-selection discrimination (mousedown + mouseup + selection
 * check) lives in `renderField`. Persistence helpers also live here:
 * `persistFieldPatch` + Map.image_url auto-detect of natural dims.
 *
 * Pure functions where possible; module-level `collapsedSections` Set tracks
 * collapsed schema sections across re-renders.
 */

import { getState, patchSlice } from '../core/state';
import { worldIsViewOnly } from '../core/view-only';
import { isKnownOf } from '../sync/known-of';
import { navigate, elementHash } from '../core/router';
import { getWritingLabels } from './writing-helpers';
import { CONTENT_ELEMENT_TYPES, type Element, type ElementType, type WorldMap } from '../core/types';
import { ElementCreateModal } from '../ui/element-create-modal';
import { typeName, aTypeName } from '../core/type-words';
import { ELEMENT_ICONS, EXTENSION_FIELD_NAMESPACES, isExtensionField, isCustomEditableField } from '../core/constants';
import { getActiveStore } from '../core/active-store';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { openFieldEditInline } from '../ui/field-edit-inline';
import { AliasesEditModal } from '../ui/aliases-edit-modal';
import { toastManager } from '../ui/toast-manager';
import { showProblem } from '../ui/problem-fixes';
import type { FieldMeta, SectionLayout } from '../editor/field-schema';
import { relationFieldsFor } from '../editor/field-schema';
import { completeWaypoint, completeTaxonomyHalf } from '../core/waypoints';
import { getFieldDescription } from '../editor/field-descriptions';
import { unitLabelFor } from '../core/world-units';
import { pickElement } from '../ui/element-picker-modal';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { readImageDimsFromUrl, smallMapImageHint, IMAGELESS_MAP_SIZE } from '../ui/image-dims';
import { countSpatialOnMap, spatialPhrase, rescaleSketchOntoImage } from './map-attach-scale';
import { getEditorSettings } from '../registry/registry';
import { suggestionsForField, reservedValueHint } from '../core/taxonomy';
import { styleValueHint } from '../core/world-styles';
import { resolveCalendarLens, type WorldCalendar } from '../core/calendar-lens';
import { fieldLabel, formatStep } from '@onlyworlds/sdk';
import { parseTemporalValue } from '../visualization/timeline/temporal-fields';

/** Set of `${type}::${section}` keys currently collapsed. Module-level (survives re-render). */
const collapsedSections = new Set<string>();

// ====== Public API ======

export interface RenderSectionOpts {
  /** Render a × on each row that calls back with the field name (custom-fields section). */
  onRemoveField?: (fieldName: string) => void;
  /** Render the section shell even with zero fields (the custom section keeps its add-row visible). */
  allowEmpty?: boolean;
}

export function renderSection(section: SectionLayout, el: Element, alwaysExpanded: boolean, opts?: RenderSectionOpts): HTMLElement | null {
  if (section.fields.length === 0 && !opts?.allowEmpty) return null;

  const wrap = document.createElement('div');
  wrap.className = 'atlas-detail-section';
  // Stable hook for scroll/measure (the tour's scrollToSection, tests).
  wrap.dataset.section = section.name;

  const headerRow = document.createElement('div');
  headerRow.className = 'atlas-detail-section-header' + (alwaysExpanded ? ' no-toggle' : '');

  const titleSpan = document.createElement('span');
  titleSpan.textContent = section.name;
  headerRow.appendChild(titleSpan);

  const collapsedKey = `${el.type}::${section.name}`;
  const isCollapsed = !alwaysExpanded && collapsedSections.has(collapsedKey);

  if (!alwaysExpanded) {
    const chev = document.createElement('span');
    chev.className = 'material-symbols-outlined';
    chev.textContent = isCollapsed ? 'expand_more' : 'expand_less';
    headerRow.appendChild(chev);
    headerRow.addEventListener('click', () => {
      if (collapsedSections.has(collapsedKey)) collapsedSections.delete(collapsedKey);
      else collapsedSections.add(collapsedKey);
      // Re-emit data.elements with a new array reference so the detail subscriber re-fires.
      const data = getState().data;
      patchSlice('data', { elements: [...data.elements] });
    });
  }
  wrap.appendChild(headerRow);

  if (!isCollapsed) {
    const body = document.createElement('div');
    body.className = 'atlas-detail-section-body';
    section.fields.forEach(meta => {
      const row = renderField(meta, el);
      if (opts?.onRemoveField) {
        row.classList.add('atlas-field-removable');
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'atlas-field-remove';
        rm.title = `Remove ${humanizeFieldName(meta.name)}`;
        rm.textContent = '×';
        rm.addEventListener('click', (e) => {
          e.stopPropagation();
          opts.onRemoveField!(meta.name);
        });
        row.appendChild(rm);
      }
      body.appendChild(row);
    });
    wrap.appendChild(body);
  }
  return wrap;
}

// ====== Field rendering ======

function renderField(meta: FieldMeta, el: Element): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-field';
  wrap.dataset.field = meta.name;
  // A view-only world reads (conv. 149): no click-to-edit, picker, × or
  // placeholder glyph, since the store refuses every write there.
  // keel's stub reads the same way in any world (conv. 155, I5).
  const readOnly = worldIsViewOnly() || isKnownOf(el);
  if (readOnly) wrap.classList.add('atlas-field-readonly');

  // T-E1: sparse elements read as a wall of placeholder rows, so an
  // empty row's label sits a step quieter, by colour (F-43). Hover restores it
  // (see atlas.css .atlas-field-empty-row).
  const rowRaw = (el as Record<string, unknown>)[meta.name];
  const rowEmpty = Array.isArray(rowRaw) ? rowRaw.length === 0 : !formatValue(rowRaw);
  if (rowEmpty) wrap.classList.add('atlas-field-empty-row');
  // Link-field candidate awareness: an empty link field whose target
  // type has ZERO elements in the world is marked apart (there is nothing to
  // pick — clicking it offers creation instead); an empty link field WITH
  // candidates keeps the brighter baseline so "there's something to connect
  // here" is visible at a glance.
  if (rowEmpty && (meta.widget === 'single-link' || meta.widget === 'multi-link')
      && candidateCountFor(el, meta.target) === 0) {
    wrap.classList.add('atlas-field-link-none');
  }

  const label = document.createElement('div');
  label.className = 'atlas-field-label';
  // SDK-sourced field description shown as a tooltip on label hover. Falls
  // back silently when no description exists for this (type, field) pair.
  const description = getFieldDescription(el.type, meta.name);
  if (description) label.title = description;
  // Custom fields have no SDK description; the tooltip discloses the real
  // stored key (labels hide the x_ prefix — D9).
  else if (isExtensionField(meta.name)) label.title = `Custom field · stored as ${meta.name}`;
  const labelText = document.createElement('span');
  labelText.textContent = humanizeFieldName(meta.name);
  label.appendChild(labelText);
  if (meta.required) {
    const req = document.createElement('span');
    req.className = 'field-required';
    req.textContent = '*';
    label.appendChild(req);
  }
  // Reserved-value awareness (D9b): a quiet cyan mark when this taxonomy
  // value carries atlas semantics (writing tier / knowledge / page / circle).
  const reserved = reservedValueHint(el, meta.name);
  if (reserved) {
    const mark = document.createElement('span');
    mark.className = 'material-symbols-outlined atlas-field-reserved-hint';
    mark.textContent = 'auto_awesome';
    mark.title = reserved;
    label.appendChild(mark);
  }
  // World-style awareness: the same quiet mark, as a swatch, when a
  // taxonomy value carries a colour in `.atlas/styles.json` (the kinds the
  // zone panel coloured light up here too, and for any type a rule names).
  if (meta.name === 'supertype' || meta.name === 'subtype') {
    const styled = styleValueHint(getState().styles.rules, el, meta.name);
    if (styled) {
      const dot = document.createElement('span');
      dot.className = 'atlas-field-style-swatch';
      dot.style.background = styled.color;
      dot.title = styled.title;
      label.appendChild(dot);
    }
  }
  // Clicking the label triggers the same edit affordance as clicking the
  // value — opens the popover for text/number, opens the picker for links.
  // The actual click handlers live on the value/pick button below; we just
  // forward the click here.
  if (!readOnly) label.classList.add('atlas-field-label-clickable');
  if (!readOnly) label.addEventListener('click', (e) => {
    // Don't double-fire if user clicked the value (would bubble up otherwise).
    if ((e.target as HTMLElement).closest('.atlas-field-value, .atlas-link-pick, .atlas-link-chip, .atlas-aliases-display')) return;
    // Forward to whichever affordance lives in this row.
    const target = wrap.querySelector<HTMLElement>(
      '.atlas-field-value, .atlas-link-pick, .atlas-aliases-display'
    );
    target?.click();
  });
  wrap.appendChild(label);

  if (meta.widget === 'single-link') {
    wrap.appendChild(renderSingleLink(meta, el, readOnly));
    return wrap;
  }
  if (meta.widget === 'multi-link') {
    wrap.appendChild(renderMultiLink(meta, el, readOnly));
    return wrap;
  }
  if (meta.name === 'atlas_aliases') {
    // Custom widget — chip strip + dedicated modal (one row per alias).
    // The CSV-in-a-text-input approach was unintuitive (Titus feedback).
    wrap.appendChild(renderAliasesRow(el, readOnly));
    return wrap;
  }

  const raw = (el as Record<string, unknown>)[meta.name];
  // A structured (object or array) value in a scalar field, written by
  // another tool or a hand edit: show it read-only. Seeding an editor with
  // String(raw) would overwrite it with "[object Object]" on the next save
  // (custom fields have the same guard).
  if (raw !== null && typeof raw === 'object') {
    const pre = document.createElement('pre');
    pre.className = 'atlas-custom-structured-value atlas-field-structured';
    let text: string;
    try { text = JSON.stringify(raw, null, 2); } catch { text = String(raw); }
    pre.textContent = text;
    pre.title = 'Structured data written by another tool. Atlas shows it read-only so it cannot be damaged here.';
    label.classList.remove('atlas-field-label-clickable');
    wrap.appendChild(pre);
    return wrap;
  }
  const valueText = formatValue(raw);
  const isEmpty = !valueText;
  const valueEl = document.createElement('div');
  valueEl.className = 'atlas-field-value' + (isEmpty ? ' empty' : '');
  if (isEmpty && !readOnly) {
    // Widget-aware empty placeholder via CSS ::before (see atlas.css). Number
    // shows '#', text fields show a thin line. Avoids putting the placeholder
    // glyph in textContent so copy/select doesn't pick up sentinel chars.
    valueEl.dataset.widget = meta.widget;
  }
  valueEl.textContent = valueText;
  // World units (#149): the label rides a data attribute and CSS prints it,
  // so the value's text stays the bare number the editor and copy use.
  const unit = meta.widget === 'number' ? unitLabelFor(el.type, meta.name, getState().active?.meta) : '';
  if (unit) valueEl.dataset.unit = unit;
  // Selection-vs-click discriminator: if the user is dragging to select
  // text, suppress the editor open. mousedown records start coords; on
  // mouseup we check whether the cursor moved (drag = selection intent)
  // or whether a non-empty selection now exists. The click handler then
  // gates on a flag set by mouseup. Fixes the bug where text selection
  // (especially left→right) opened the modal instead of leaving the user
  // with their highlight.
  if (readOnly) return withCalendarDate(wrap, valueEl, meta, raw, isEmpty);
  let mouseDownAt: { x: number; y: number } | null = null;
  let suppressNextClick = false;
  valueEl.addEventListener('mousedown', (e) => {
    mouseDownAt = { x: e.clientX, y: e.clientY };
    suppressNextClick = false;
  });
  valueEl.addEventListener('mouseup', (e) => {
    if (!mouseDownAt) return;
    const dx = Math.abs(e.clientX - mouseDownAt.x);
    const dy = Math.abs(e.clientY - mouseDownAt.y);
    mouseDownAt = null;
    // 4px tolerance — accounts for tiny jitter on intended clicks while
    // catching deliberate drag-selection. Also check actual selection
    // state in case mouseup landed inside the same px (rapid swipe).
    const dragged = dx > 4 || dy > 4;
    const sel = window.getSelection();
    const hasSelectionInValue = !!sel && sel.toString().length > 0
      && valueEl.contains(sel.anchorNode) && valueEl.contains(sel.focusNode);
    if (dragged || hasSelectionInValue) {
      suppressNextClick = true;
    }
  });
  valueEl.addEventListener('click', () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    // Double-gate: even if the mouseup discriminator missed (mouseup outside
    // valueEl during a drag, browser timing quirks, etc.), bail if there's
    // ANY active text selection inside or overlapping valueEl at click time.
    // Without this, asymmetric drag directions can leak past the mouseup gate.
    const sel = window.getSelection();
    if (sel && sel.toString().length > 0) {
      const anchorIn = sel.anchorNode && valueEl.contains(sel.anchorNode);
      const focusIn = sel.focusNode && valueEl.contains(sel.focusNode);
      if (anchorIn || focusIn) return;
    }
    // Resolve dispatch mode from registry editor settings.
    // Default is 'modal' (back-compat with everything that shipped before).
    const editorSettings = getEditorSettings(getState().registry);
    const mode = editorSettings.field_edit_mode;
    const initialValue = raw === undefined || raw === null ? '' : String(raw);
    const editWidget = meta.widget === 'number' ? 'number' : (meta.widget === 'text-long' ? 'text-long' : 'text-short');
    if (mode === 'inline-single') {
      openFieldEditInline({
        anchor: valueEl,
        value: initialValue,
        widget: editWidget,
        mode: 'single',
        onSave: async (nextValue) => {
          await persistFieldPatch(el, meta.name, nextValue);
        },
      });
      return;
    }
    if (mode === 'inline-multi') {
      openFieldEditInline({
        anchor: valueEl,
        value: initialValue,
        widget: editWidget,
        mode: 'multi',
        onSave: async (nextValue) => {
          await persistFieldPatch(el, meta.name, nextValue);
        },
      });
      return;
    }
    // mode === 'modal' (default)
    const suggestions = suggestionsForField(el, meta.name);
    const fieldDesc = getFieldDescription(el.type, meta.name);
    openFieldEditPopover({
      anchor: valueEl,
      label: humanizeFieldName(meta.name) + (unit ? ` (${unit})` : ''),
      ...(fieldDesc ? { description: fieldDesc } : {}),
      value: initialValue,
      widget: editWidget,
      ...(suggestions ? { suggestions } : {}),
      onSave: async (nextValue) => {
        await persistFieldPatch(el, meta.name, nextValue);
      },
    });
  });
  return withCalendarDate(wrap, valueEl, meta, raw, isEmpty);
}

/**
 * A date with a calendar: the number stays the editable value; the
 * calendar's reading sits under it, read-only, in the same column. Outside
 * the value element, so editing and copying the number never touch it.
 */
function withCalendarDate(wrap: HTMLElement, valueEl: HTMLElement, meta: FieldMeta, raw: unknown, isEmpty: boolean): HTMLElement {
  const lens = isSchemaDateField(meta) && !isEmpty ? activeCalendarLens() : null;
  const dateText = calendarDateText(meta, raw, lens);
  if (lens && dateText) {
    const col = document.createElement('div');
    col.className = 'atlas-field-value-col';
    col.appendChild(valueEl);
    const dateEl = document.createElement('div');
    dateEl.className = 'atlas-row-meta atlas-field-calendar-date';
    dateEl.setAttribute('data-role', 'calendar-date');
    dateEl.textContent = dateText;
    dateEl.title = `Calendar: ${lens.name}. The stored number does not change.`;
    col.appendChild(dateEl);
    wrap.appendChild(col);
    return wrap;
  }
  wrap.appendChild(valueEl);
  return wrap;
}

/**
 * Render the atlas_aliases row: a chip strip showing each alias, plus an
 * inline edit button that opens the dedicated AliasesEditModal. Clicking
 * anywhere on the empty value also opens the modal (matches the rest of
 * the row-click affordances in element-detail).
 */
function renderAliasesRow(el: Element, readOnly: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-aliases-display';
  if (!readOnly) row.title = 'Click to edit aliases';

  const aliases: string[] = Array.isArray(el.atlas_aliases)
    ? el.atlas_aliases.filter((s): s is string => typeof s === 'string' && s.length > 0)
    : [];

  const openModal = (): void => {
    new AliasesEditModal({
      elementName: el.name || '(unnamed)',
      current: aliases,
      onSave: async (next) => {
        await persistFieldPatch(el, 'atlas_aliases', next.length === 0 ? null : next);
      },
    }).open();
  };

  if (aliases.length === 0) {
    if (readOnly) return row;
    const empty = document.createElement('span');
    empty.className = 'atlas-aliases-display-empty';
    empty.textContent = 'Add aliases…';
    row.appendChild(empty);
  } else {
    for (const alias of aliases) {
      const chip = document.createElement('span');
      chip.className = 'atlas-aliases-display-chip';
      chip.textContent = alias;
      row.appendChild(chip);
    }
  }

  // Whole-row click opens the modal — matches the row-click affordance of
  // every other field in element-detail. No separate edit button needed.
  if (!readOnly) row.addEventListener('click', openModal);

  return row;
}

/** Elements of `target` type available to link (self excluded). null = the
 *  field has no declared target (generic link) — candidate logic doesn't apply. */
function candidateCountFor(el: Element, target: ElementType | undefined): number | null {
  if (!target) return null;
  let n = 0;
  for (const e of getState().data.elements) {
    if (e.type === target && e.id !== el.id) n++;
  }
  return n;
}

/** Types the create modal can actually offer (zones/pins/markers are
 *  map-made) — gates the create-from-link-field flow. */
const LINK_CREATABLE = new Set<ElementType>([...CONTENT_ELEMENT_TYPES, 'map']);

/**
 * Create-from-link-field: a zero-candidate link field's click opens the
 * create modal LOCKED to the target type; the new element auto-links into the
 * field, and the user stays on this element (no navigation jump).
 */
function openCreateForLink(el: Element, meta: FieldMeta, existingIds: string[]): void {
  const target = meta.target!;
  const label = typeName(target);
  new ElementCreateModal(toastManager, {
    initialType: target,
    excludeTypes: [...LINK_CREATABLE].filter(t => t !== target),
    suppressNavigate: true,
    title: `New ${label} · ${humanizeFieldName(meta.name)}`,
    afterCreate: (id, type) => {
      if (type !== target) return; // grid is locked, but never link off-target
      const value = meta.widget === 'multi-link' ? [...existingIds, id] : id;
      void persistFieldPatch(el, meta.name, value).catch(() => { /* toasted in persist */ });
    },
  }).open();
}

function renderSingleLink(meta: FieldMeta, el: Element, readOnly: boolean): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-link-row';
  // A single link another tool wrote as `{id, name}` (or a one-item list)
  // reads as its id, not "[object Object]".
  const rawValue = (el as Record<string, unknown>)[meta.name];
  const raw = typeof rawValue === 'string' ? rawValue : (linkIdsOf(rawValue)[0] ?? null);
  const candidates = candidateCountFor(el, meta.target);
  const offerCreate = !raw && candidates === 0 && !!meta.target && LINK_CREATABLE.has(meta.target);

  if (raw) {
    row.appendChild(buildLinkChip(String(raw), meta, readOnly ? null : async () => {
      // Use `null`, not `undefined`. undefined gets dropped by JSON.stringify
      // at disk-write AND by the adapter's wire serializer, so the PATCH
      // body omits the field and the server keeps its old value. See
      // sync-engine.fieldClear.test.ts. Convention #21.
      await persistFieldPatch(el, meta.name, null);
    }));
  } else {
    row.classList.add('atlas-link-row-empty');
  }
  if (readOnly) return row;

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
  if (!raw) pickBtn.classList.add('atlas-link-pick-empty');
  // Candidate-aware affordance: candidates exist → the pick icon lifts
  // a notch ("there's something to connect"); none exist → the click CREATES.
  if (!raw && candidates != null && candidates > 0) pickBtn.classList.add('atlas-link-pick-ready');
  pickBtn.title = raw ? 'Change link'
    : offerCreate ? `No ${typeName(meta.target!, { many: true })} yet: create one`
    : `Pick ${meta.target ? aTypeName(meta.target) : 'a link'}`;
  // ALWAYS show the type-specific icon so users see at a glance what kind of
  // element this field links to — even before any link exists. Empty state
  // still uses the `atlas-link-pick-empty` class for muted styling (was a
  // generic `+` before, which hid which category the field targeted).
  pickBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
  const runPick = async (): Promise<void> => {
    if (offerCreate) { openCreateForLink(el, meta, []); return; }
    // Exclude the current element itself and any value already linked here.
    // Self-linking is never meaningful — a Character pointing at itself via
    // `friends`, a Location pointing at itself via `parent_location_id`, etc.
    const exclude = new Set<string>();
    exclude.add(el.id);
    if (raw) exclude.add(String(raw));
    const picked = await pickElement({
      restrictToType: meta.target,
      excludeIds: [...exclude],
      title: `Pick ${meta.target ? aTypeName(meta.target) : 'a link'} for ${humanizeFieldName(meta.name)}`,
    });
    if (!picked) return;
    await persistFieldPatch(el, meta.name, picked.id);
  };
  pickBtn.addEventListener('click', (e) => { e.stopPropagation(); void runPick(); });
  row.appendChild(pickBtn);
  // Empty link field: clicking anywhere in the row body opens the picker, not
  // only the icon (Titus — "link into empty fields by clicking the
  // body"). The button stops propagation so it never double-fires.
  if (!raw) {
    row.classList.add('atlas-link-row-clickable');
    row.addEventListener('click', () => { void runPick(); });
  }
  return row;
}

function renderMultiLink(meta: FieldMeta, el: Element, readOnly: boolean): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-link-row';

  const raw = (el as Record<string, unknown>)[meta.name];
  // Read the link list the way other writers store it: a bare id string
  // or expanded `{id, name}` objects used to render empty or as
  // "[object Object]", and the next add/remove persisted THAT over the real
  // links. Normalised to ids here, so an edit writes the schema's shape with
  // every existing link kept.
  const ids: string[] = linkIdsOf(raw);
  const candidates = candidateCountFor(el, meta.target);
  // Every candidate already linked still means "nothing left to pick" — but
  // only the fully-empty zero-candidate field reads as the create affordance.
  const offerCreate = ids.length === 0 && candidates === 0 && !!meta.target && LINK_CREATABLE.has(meta.target);

  ids.forEach(id => {
    wrap.appendChild(buildLinkChip(id, meta, readOnly ? null : async () => {
      const next = ids.filter(x => x !== id);
      await persistFieldPatch(el, meta.name, next);
    }));
  });

  if (ids.length === 0) wrap.classList.add('atlas-link-row-empty');
  if (readOnly) return wrap;
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
  if (ids.length === 0) addBtn.classList.add('atlas-link-pick-empty');
  if (ids.length === 0 && candidates != null && candidates > 0) addBtn.classList.add('atlas-link-pick-ready');
  addBtn.title = offerCreate ? `No ${typeName(meta.target!, { many: true })} yet: create one`
    : ids.length === 0 ? `Pick ${meta.target ? aTypeName(meta.target) : 'a link'}` : `Add another ${meta.target ? typeName(meta.target) : 'link'}`;
  // Always show the type-specific icon so users see WHICH category this
  // multi-link field targets at a glance. `margin-left: auto` keeps the
  // button anchored right past any existing chips.
  addBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
  const runAdd = async (): Promise<void> => {
    if (offerCreate) { openCreateForLink(el, meta, ids); return; }
    // Exclude the current element + everything already in the list. Same
    // self-link rule as renderSingleLink — A Character's `friends` shouldn't
    // include the character itself.
    const picked = await pickElement({
      restrictToType: meta.target,
      excludeIds: [el.id, ...ids],
      title: `Add ${meta.target ? aTypeName(meta.target) : 'a link'} to ${humanizeFieldName(meta.name)}`,
    });
    if (!picked) return;
    const next = [...ids, picked.id];
    await persistFieldPatch(el, meta.name, next);
  };
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); void runAdd(); });
  wrap.appendChild(addBtn);
  // Empty multi-link: clicking the row body opens the picker too (Titus's
  // ask). Only when empty — once chips exist, row clicks belong to them.
  if (ids.length === 0) {
    wrap.classList.add('atlas-link-row-clickable');
    wrap.addEventListener('click', () => { void runAdd(); });
  }
  return wrap;
}

/** `onRemove` null = no × (a view-only world, conv. 149). */
function buildLinkChip(id: string, meta: FieldMeta, onRemove: (() => void) | null): HTMLElement {
  const linked = getState().data.elements.find(e => e.id === id);
  const chip = document.createElement('span');
  chip.className = 'atlas-link-chip' + (linked ? '' : ' atlas-link-chip-unresolved');

  const name = document.createElement('span');
  if (linked) {
    name.textContent = linked.name || '(unnamed)';
    chip.title = `${typeName(linked.type, { supertype: linked.supertype })} · id ${id}`;
  } else {
    name.textContent = id;
    chip.title = `No ${meta.target ? typeName(meta.target) : 'element'} with this id in this world`;
  }
  chip.appendChild(name);

  chip.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).dataset.remove) return;
    const worldId = getState().active?.worldId;
    if (linked && worldId) {
      patchSlice('ui', { ...getState().ui, selectedElementId: linked.id });
      navigate(elementHash(worldId, linked.id));
    }
  });
  if (!onRemove) return chip;

  const rm = document.createElement('span');
  rm.className = 'material-symbols-outlined atlas-link-chip-remove';
  rm.dataset.remove = '1';
  rm.textContent = 'close';
  rm.addEventListener('click', (e) => {
    e.stopPropagation();
    onRemove();
  });
  chip.appendChild(rm);

  return chip;
}

// ====== Persistence ======

/**
 * Said when an edit lands while no world store is open (a world closing under
 * the page). Shared by the element page's writers.
 */
export const WORLD_NOT_OPEN = 'This world is not open. Open it from the sidebar, then try again.';

/**
 * The latest save started per element field: "Retry now" on a failed
 * save runs only while no later save of that field has started, so it never
 * writes an older value over a newer one.
 */
const latestFieldSave = new Map<string, number>();
let fieldSaveSeq = 0;

export async function persistFieldPatch(el: Element, fieldName: string, nextValue: unknown): Promise<void> {
  const saveKey = `${el.id}|${fieldName}`;
  const seq = ++fieldSaveSeq;
  latestFieldSave.set(saveKey, seq);
  const store = getActiveStore();
  if (!store) {
    toastManager.error(WORLD_NOT_OPEN);
    return;
  }
  // Never persist Infinity or NaN: JSON writes both as null, which clears the
  // field (and deletes a custom one). The editors refuse them first; this is
  // the backstop.
  if (typeof nextValue === 'number' && !Number.isFinite(nextValue)) return;
  // atlas_aliases edit comes in as a CSV string from the popover; parse to
  // string[] before persisting so the on-disk shape matches the type contract.
  let valueToPersist: unknown = nextValue;
  if (fieldName === 'atlas_aliases') {
    if (typeof nextValue === 'string') {
      const parts = nextValue
        .split(',')
        .map(s => s.trim())
        .filter(s => s.length > 0);
      valueToPersist = parts.length === 0 ? null : parts;
    } else if (Array.isArray(nextValue)) {
      valueToPersist = nextValue;
    } else {
      valueToPersist = null;
    }
  } else if (isCustomEditableField(fieldName)) {
    // Custom fields (D9): the editor hands back strings; preserve the value's
    // existing on-disk type so a synced/imported number stays a number, a
    // boolean stays a boolean, an array round-trips through the CSV display.
    // `null` passes through untouched — it's the field's delete tombstone
    // (keel keeps null-valued extension keys; probed 2026-07-12).
    const prev = (el as Record<string, unknown>)[fieldName];
    if (nextValue !== null && typeof nextValue === 'string') {
      if (Array.isArray(prev)) {
        valueToPersist = nextValue.split(',').map(s => s.trim()).filter(s => s.length > 0);
      } else if (typeof prev === 'boolean' && (nextValue === 'true' || nextValue === 'false')) {
        valueToPersist = nextValue === 'true';
      } else if (typeof prev === 'number' && nextValue.trim() !== '' && !Number.isNaN(Number(nextValue))) {
        valueToPersist = Number(nextValue);
      }
    }
  }
  try {
    await store.updateElement(el.id, { [fieldName]: valueToPersist } as Partial<Element>);
    const elements = await store.listElements();
    patchSlice('data', { elements });
    // Local write succeeded — schedule a debounced push. No-op for local-only.
    requestPushIfLinked();

    // Waypoint hooks. This function is GESTURE-ONLY — every caller
    // is a field-widget commit handler in this file; do not call it from
    // sync/import/derive paths or these hooks would leak (hookmap wp3/wp4).
    if ((fieldName === 'supertype' || fieldName === 'subtype')
        && typeof valueToPersist === 'string' && valueToPersist.trim()) {
      completeTaxonomyHalf(fieldName);
    }
    const nonEmpty = Array.isArray(valueToPersist) ? valueToPersist.length > 0
      : typeof valueToPersist === 'string' ? valueToPersist.trim().length > 0
      : false;
    if (nonEmpty && relationFieldsFor(el.type).some(f => f.diskField === fieldName)) {
      completeWaypoint('links');
    }

    // Map.image_url auto-detect (DESIGN_MAPS.md §4):
    // when a Map element's image_url changes to a non-empty value, fetch
    // the image's natural dims and update the map's width/height so the
    // canvas matches the new image. Without this, the stored dims stay
    // pinned to whatever the prior image was (or the 2000-default), and
    // pins end up off-image when image dimensions change.
    if (el.type === 'map' && fieldName === 'image_url' && typeof nextValue === 'string' && nextValue.trim()) {
      // Blank-canvas → image via the URL field: the write is already
      // committed (field popovers save-then-notify), so no veto here — the
      // sketch's pins/zone points scale onto the image once the URL's dims
      // decode (DESIGN_MAPS.md §4.2; the local-image row, which CAN veto
      // pre-write, confirms first). `el` is the pre-edit snapshot, so its
      // empty image fields + old dims are exactly the blank-canvas state.
      const prior = el as WorldMap;
      const wasImageless = !prior.image_url && !prior.image_media_id;
      const fromDims = wasImageless
        ? {
            w: typeof prior.width === 'number' && prior.width > 0 ? prior.width : IMAGELESS_MAP_SIZE,
            h: typeof prior.height === 'number' && prior.height > 0 ? prior.height : IMAGELESS_MAP_SIZE,
          }
        : null;
      void autoUpdateMapDims(el.id, nextValue.trim(), fromDims);
    }
  } catch (err) {
    console.error('[element-detail] update failed:', err);
    // This toast is the one: the field popover sees the error as shown
    // and stays quiet. Callers still get the rejection.
    showProblem(err, {
      doing: 'saving this field',
      retry: () => {
        if (latestFieldSave.get(saveKey) !== seq) return;
        void persistFieldPatch(el, fieldName, nextValue).catch(() => { /* toasted in persist */ });
      },
    });
    throw err;
  }
}

/**
 * Fire-and-forget: decode an image URL's natural dimensions and patch the
 * map's width/height. Silent on failure (CORS, 404, etc.) — pins keep
 * working with stale dims; user can manually edit width/height fields
 * if the auto-detect can't reach the image.
 *
 * `sketchFrom` set = this attach came from a BLANK canvas (§4.2): after the
 * dims persist, every pin/zone point scales proportionally from the old
 * square into the image space, then one refresh carries both.
 */
async function autoUpdateMapDims(
  mapId: string,
  url: string,
  sketchFrom: { w: number; h: number } | null = null,
): Promise<void> {
  const dims = await readImageDimsFromUrl(url);
  if (!dims) return;
  const store = getActiveStore();
  if (!store) return;
  try {
    await store.updateMap(mapId, { width: dims.w, height: dims.h });
    if (sketchFrom) {
      const counts = await countSpatialOnMap(store, mapId);
      const scaled = await rescaleSketchOntoImage(store, mapId, sketchFrom, dims);
      if (scaled > 0) toastManager.info(`${spatialPhrase(counts)} scaled onto the image`);
    }
    const elements = await refreshElementsAfterWrite(store);
    toastManager.info(`Map dimensions updated to ${dims.w}×${dims.h}`);
    const hint = smallMapImageHint(dims);
    if (hint) toastManager.info(hint);
  } catch (err) {
    console.error('[element-detail] map dim auto-update failed:', err);
  }
}

// ====== Pure helpers (exported for unit testing) ======

/**
 * The schema's date fields: integer fields named `date` or `*_date`
 * (birth_date, founding_date, start_date, grant_date...). Custom fields are
 * not schema dates, whatever their name.
 */
export function isSchemaDateField(meta: Pick<FieldMeta, 'name' | 'widget'>): boolean {
  if (meta.widget !== 'number' || isExtensionField(meta.name)) return false;
  return meta.name === 'date' || /^[a-z]+(?:_[a-z]+)*_date$/.test(meta.name);
}

/**
 * A stored date as the world's calendar says it, shown beside the
 * number, read-only: the stored integer never changes. Null when there is no
 * calendar, the field is not a date, or the value is not a whole number.
 */
export function calendarDateText(
  meta: Pick<FieldMeta, 'name' | 'widget'>,
  raw: unknown,
  lens: WorldCalendar | null,
): string | null {
  if (!lens || !isSchemaDateField(meta)) return null;
  const n = parseTemporalValue(raw);
  if (n === null || !Number.isInteger(n)) return null;
  return formatStep(lens.config, n);
}

/** The calendar the element page speaks: the world's active one, as the charts room and home resolve it. */
function activeCalendarLens(): WorldCalendar | null {
  const s = getState();
  const worldId = s.active?.worldId;
  const entry = worldId ? s.registry.worlds.find(w => w.id === worldId) : undefined;
  return resolveCalendarLens(s.data.elements, entry?.active_calendar_id, { fallbackToOnly: true });
}

/** "image_url" → "Image URL": the SDK's `fieldLabel` after the prefix step. */
export function humanizeFieldName(name: string): string {
  // Drop extension-namespace prefixes (atlas_/x_/shadow_) when surfacing
  // fields in the UI — keeps labels clean ("x_mood" → "Mood"). The on-disk
  // field name still uses the prefix; the row tooltip discloses it (D9).
  const ns = EXTENSION_FIELD_NAMESPACES.find(p => name.startsWith(p));
  const cleaned = ns ? name.slice(ns.length) : name;
  // Sentence case, acronyms kept ("Birth date", "Image URL"): the house rule
  // (Titus, 2026-10-20), one copy for every tool since SDK 4.34
  // (seeded from this function, Kael 2026-10-20); a word in capitals is
  // kept as written since 4.36 ("STR", Kael 2026-10-20).
  return fieldLabel(cleaned);
}

/** Stringify a field value for display; null/undefined/'' become empty string. */
export function formatValue(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  return String(raw);
}

/** Icon to render on a link picker button for the given target element type. */
function pickIconFor(target: ElementType | undefined): string {
  if (target && ELEMENT_ICONS[target]) return ELEMENT_ICONS[target];
  return 'add_link';
}

// D9b taxonomy helpers moved to core/taxonomy.ts (the sidebar consumes them
// too — a UI-domain-neutral home). Re-exported so tests + callers keep working.
export { suggestionsForField, reservedValueHint } from '../core/taxonomy';

// The tolerant link reader moved to core/link-ids.ts (#281: the date
// continuity check reads links too). Re-exported so callers keep working.
import { linkIdsOf } from '../core/link-ids';
export { linkIdsOf };
