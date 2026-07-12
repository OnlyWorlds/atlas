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
import { navigate, elementHash } from '../core/router';
import { getWritingLabels } from './writing-helpers';
import type { Element, ElementType } from '../core/types';
import { ELEMENT_ICONS, EXTENSION_FIELD_NAMESPACES, isExtensionField, isCustomEditableField } from '../core/constants';
import { getActiveStore } from '../core/active-store';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { openFieldEditInline } from '../ui/field-edit-inline';
import { AliasesEditModal } from '../ui/aliases-edit-modal';
import { toastManager } from '../ui/toast-manager';
import type { FieldMeta, SectionLayout } from '../editor/field-schema';
import { relationFieldsFor } from '../editor/field-schema';
import { completeWaypoint, completeTaxonomyHalf } from '../core/waypoints';
import { getFieldDescription } from '../editor/field-descriptions';
import { pickElement } from '../ui/element-picker-modal';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { readImageDimsFromUrl } from '../ui/image-dims';
import { getEditorSettings } from '../registry/registry';
import { suggestionsForField, reservedValueHint } from '../core/taxonomy';

/** Known acronyms uppercased in labels: "image_url" → "Image URL". */
const ACRONYMS = new Set(['url', 'id', 'api', 'ui', 'ip', 'html', 'http', 'dns', 'uuid', 'sdk', 'pin', 'gps']);

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

  // T-E1 (Bout E): sparse elements read as a wall of placeholder rows — dim
  // whole empty rows a step further. Hover restores full strength so the
  // edit affordance survives (see atlas.css .atlas-field-empty-row).
  const rowRaw = (el as Record<string, unknown>)[meta.name];
  const rowEmpty = Array.isArray(rowRaw) ? rowRaw.length === 0 : !formatValue(rowRaw);
  if (rowEmpty) wrap.classList.add('atlas-field-empty-row');

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
  // Clicking the label triggers the same edit affordance as clicking the
  // value — opens the popover for text/number, opens the picker for links.
  // The actual click handlers live on the value/pick button below; we just
  // forward the click here.
  label.classList.add('atlas-field-label-clickable');
  label.addEventListener('click', (e) => {
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
    wrap.appendChild(renderSingleLink(meta, el));
    return wrap;
  }
  if (meta.widget === 'multi-link') {
    wrap.appendChild(renderMultiLink(meta, el));
    return wrap;
  }
  if (meta.name === 'atlas_aliases') {
    // Custom widget — chip strip + dedicated modal (one row per alias).
    // The CSV-in-a-text-input approach was unintuitive (Captain feedback).
    wrap.appendChild(renderAliasesRow(el));
    return wrap;
  }

  const raw = (el as Record<string, unknown>)[meta.name];
  const valueText = formatValue(raw);
  const isEmpty = !valueText;
  const valueEl = document.createElement('div');
  valueEl.className = 'atlas-field-value' + (isEmpty ? ' empty' : '');
  if (isEmpty) {
    // Widget-aware empty placeholder via CSS ::before (see atlas.css). Number
    // shows '#', text fields show a thin line. Avoids putting the placeholder
    // glyph in textContent so copy/select doesn't pick up sentinel chars.
    valueEl.dataset.widget = meta.widget;
  }
  valueEl.textContent = valueText;
  // Selection-vs-click discriminator: if the user is dragging to select
  // text, suppress the editor open. mousedown records start coords; on
  // mouseup we check whether the cursor moved (drag = selection intent)
  // or whether a non-empty selection now exists. The click handler then
  // gates on a flag set by mouseup. Fixes the bug where text selection
  // (especially left→right) opened the modal instead of leaving the user
  // with their highlight.
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
    // Resolve dispatch mode from registry editor settings (session 219).
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
    openFieldEditPopover({
      anchor: valueEl,
      label: humanizeFieldName(meta.name),
      value: initialValue,
      widget: editWidget,
      ...(suggestions ? { suggestions } : {}),
      onSave: async (nextValue) => {
        await persistFieldPatch(el, meta.name, nextValue);
      },
    });
  });
  wrap.appendChild(valueEl);
  return wrap;
}

/**
 * Render the atlas_aliases row: a chip strip showing each alias, plus an
 * inline edit button that opens the dedicated AliasesEditModal. Clicking
 * anywhere on the empty value also opens the modal (matches the rest of
 * the row-click affordances in element-detail).
 */
function renderAliasesRow(el: Element): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-aliases-display';
  row.title = 'Click to edit aliases';

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
  row.addEventListener('click', openModal);

  return row;
}

function renderSingleLink(meta: FieldMeta, el: Element): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-link-row';
  const raw = (el as Record<string, unknown>)[meta.name];

  if (raw) {
    row.appendChild(buildLinkChip(String(raw), meta, async () => {
      // Use `null`, not `undefined`. undefined gets dropped by JSON.stringify
      // at disk-write AND by the adapter's wire serializer, so the PATCH
      // body omits the field and the server keeps its old value. See
      // sync-engine.fieldClear.test.ts. Convention #21.
      await persistFieldPatch(el, meta.name, null);
    }));
  } else {
    row.classList.add('atlas-link-row-empty');
  }

  const pickBtn = document.createElement('button');
  pickBtn.type = 'button';
  pickBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
  if (!raw) pickBtn.classList.add('atlas-link-pick-empty');
  pickBtn.title = raw ? 'Change link' : `Pick a ${meta.target ?? 'link'}`;
  // ALWAYS show the type-specific icon so users see at a glance what kind of
  // element this field links to — even before any link exists. Empty state
  // still uses the `atlas-link-pick-empty` class for muted styling (was a
  // generic `+` before, which hid which category the field targeted).
  pickBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
  pickBtn.addEventListener('click', async () => {
    // Exclude the current element itself and any value already linked here.
    // Self-linking is never meaningful — a Character pointing at itself via
    // `friends`, a Location pointing at itself via `parent_location_id`, etc.
    const exclude = new Set<string>();
    exclude.add(el.id);
    if (raw) exclude.add(String(raw));
    const picked = await pickElement({
      restrictToType: meta.target,
      excludeIds: [...exclude],
      title: `Pick a ${meta.target ?? 'link'} for ${humanizeFieldName(meta.name)}`,
    });
    if (!picked) return;
    await persistFieldPatch(el, meta.name, picked.id);
  });
  row.appendChild(pickBtn);
  return row;
}

function renderMultiLink(meta: FieldMeta, el: Element): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-link-row';

  const raw = (el as Record<string, unknown>)[meta.name];
  const ids: string[] = Array.isArray(raw) ? raw.map(String) : [];

  ids.forEach(id => {
    wrap.appendChild(buildLinkChip(id, meta, async () => {
      const next = ids.filter(x => x !== id);
      await persistFieldPatch(el, meta.name, next);
    }));
  });

  if (ids.length === 0) wrap.classList.add('atlas-link-row-empty');
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
  if (ids.length === 0) addBtn.classList.add('atlas-link-pick-empty');
  addBtn.title = ids.length === 0 ? `Pick a ${meta.target ?? 'link'}` : `Add another ${meta.target ?? 'link'}`;
  // Always show the type-specific icon so users see WHICH category this
  // multi-link field targets at a glance. `margin-left: auto` keeps the
  // button anchored right past any existing chips.
  addBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
  addBtn.addEventListener('click', async () => {
    // Exclude the current element + everything already in the list. Same
    // self-link rule as renderSingleLink — A Character's `friends` shouldn't
    // include the character itself.
    const picked = await pickElement({
      restrictToType: meta.target,
      excludeIds: [el.id, ...ids],
      title: `Add a ${meta.target ?? 'link'} to ${humanizeFieldName(meta.name)}`,
    });
    if (!picked) return;
    const next = [...ids, picked.id];
    await persistFieldPatch(el, meta.name, next);
  });
  wrap.appendChild(addBtn);
  return wrap;
}

function buildLinkChip(id: string, meta: FieldMeta, onRemove: () => void): HTMLElement {
  const linked = getState().data.elements.find(e => e.id === id);
  const chip = document.createElement('span');
  chip.className = 'atlas-link-chip' + (linked ? '' : ' atlas-link-chip-unresolved');

  const name = document.createElement('span');
  if (linked) {
    name.textContent = linked.name || '(unnamed)';
    chip.title = `${linked.type} · id ${id}`;
  } else {
    name.textContent = id;
    chip.title = `Unresolved ID (target type: ${meta.target ?? 'unknown'})`;
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

async function persistFieldPatch(el: Element, fieldName: string, nextValue: unknown): Promise<void> {
  const store = getActiveStore();
  if (!store) {
    toastManager.error('No active store');
    return;
  }
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

    // Waypoint hooks (Bout OW). This function is GESTURE-ONLY — every caller
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

    // Map.image_url auto-detect (DESIGN_MAPS.md §4 + session 211 bout ID):
    // when a Map element's image_url changes to a non-empty value, fetch
    // the image's natural dims and update the map's width/height so the
    // canvas matches the new image. Without this, the stored dims stay
    // pinned to whatever the prior image was (or the 2000-default), and
    // pins end up off-image when image dimensions change.
    if (el.type === 'map' && fieldName === 'image_url' && typeof nextValue === 'string' && nextValue.trim()) {
      void autoUpdateMapDims(el.id, nextValue.trim());
    }
  } catch (err) {
    console.error('[element-detail] update failed:', err);
    toastManager.error(err instanceof Error ? err.message : String(err));
    throw err;
  }
}

/**
 * Fire-and-forget: decode an image URL's natural dimensions and patch the
 * map's width/height. Silent on failure (CORS, 404, etc.) — pins keep
 * working with stale dims; user can manually edit width/height fields
 * if the auto-detect can't reach the image.
 */
async function autoUpdateMapDims(mapId: string, url: string): Promise<void> {
  const dims = await readImageDimsFromUrl(url);
  if (!dims) return;
  const store = getActiveStore();
  if (!store) return;
  try {
    await store.updateMap(mapId, { width: dims.w, height: dims.h });
    const elements = await refreshElementsAfterWrite(store);
    toastManager.info(`Map dimensions updated to ${dims.w}×${dims.h}`);
  } catch (err) {
    console.error('[element-detail] map dim auto-update failed:', err);
  }
}

// ====== Pure helpers (exported for unit testing) ======

/** "image_url" → "Image URL" via the ACRONYMS set. */
export function humanizeFieldName(name: string): string {
  // Drop extension-namespace prefixes (atlas_/x_/shadow_) when surfacing
  // fields in the UI — keeps labels clean ("x_mood" → "Mood"). The on-disk
  // field name still uses the prefix; the row tooltip discloses it (D9).
  const ns = EXTENSION_FIELD_NAMESPACES.find(p => name.startsWith(p));
  const cleaned = ns ? name.slice(ns.length) : name;
  return cleaned
    .split('_')
    .map(word => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
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
