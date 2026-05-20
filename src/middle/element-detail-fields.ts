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
import { ELEMENT_ICONS } from '../core/constants';
import { getActiveStore } from '../core/active-store';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { openFieldEditInline } from '../ui/field-edit-inline';
import { toastManager } from '../ui/toast-manager';
import type { FieldMeta, SectionLayout } from '../editor/field-schema';
import { getFieldDescription } from '../editor/field-descriptions';
import { pickElement } from '../ui/element-picker-modal';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { readImageDimsFromUrl } from '../ui/image-dims';
import { getEditorSettings } from '../registry/registry';

/** Known acronyms uppercased in labels: "image_url" → "Image URL". */
const ACRONYMS = new Set(['url', 'id', 'api', 'ui', 'ip', 'html', 'http', 'dns', 'uuid', 'sdk', 'pin', 'gps']);

/** Set of `${type}::${section}` keys currently collapsed. Module-level (survives re-render). */
const collapsedSections = new Set<string>();

// ====== Public API ======

export function renderSection(section: SectionLayout, el: Element, alwaysExpanded: boolean): HTMLElement | null {
  if (section.fields.length === 0) return null;

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
    section.fields.forEach(meta => body.appendChild(renderField(meta, el)));
    wrap.appendChild(body);
  }
  return wrap;
}

// ====== Field rendering ======

function renderField(meta: FieldMeta, el: Element): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-field';

  const label = document.createElement('div');
  label.className = 'atlas-field-label';
  // SDK-sourced field description shown as a tooltip on label hover. Falls
  // back silently when no description exists for this (type, field) pair.
  const description = getFieldDescription(el.type, meta.name);
  if (description) label.title = description;
  const labelText = document.createElement('span');
  labelText.textContent = humanizeFieldName(meta.name);
  label.appendChild(labelText);
  if (meta.required) {
    const req = document.createElement('span');
    req.className = 'field-required';
    req.textContent = '*';
    label.appendChild(req);
  }
  // Clicking the label triggers the same edit affordance as clicking the
  // value — opens the popover for text/number, opens the picker for links.
  // The actual click handlers live on the value/pick button below; we just
  // forward the click here.
  label.classList.add('atlas-field-label-clickable');
  label.addEventListener('click', (e) => {
    // Don't double-fire if user clicked the value (would bubble up otherwise).
    if ((e.target as HTMLElement).closest('.atlas-field-value, .atlas-link-pick, .atlas-link-chip')) return;
    // Forward to whichever affordance lives in this row.
    const target = wrap.querySelector<HTMLElement>(
      '.atlas-field-value, .atlas-link-pick'
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
  try {
    await store.updateElement(el.id, { [fieldName]: nextValue } as Partial<Element>);
    const elements = await store.listElements();
    patchSlice('data', { elements });
    // Local write succeeded — schedule a debounced push. No-op for local-only.
    requestPushIfLinked();

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
  return name
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

/**
 * Suggestion strings to surface in the field-edit popover for the given
 * element + field. Returns null if no suggestions apply.
 *
 * Currently used for `supertype` on Narratives — surfaces the four writing
 * tier labels so users can drop a narrative in/out of the writing tree with
 * tab-to-complete instead of typing the exact label.
 */
function suggestionsForField(el: Element, fieldName: string): string[] | null {
  if (el.type !== 'narrative') return null;
  if (fieldName !== 'supertype') return null;
  const active = getState().active;
  if (!active) return null;
  const labels = getWritingLabels(active.worldId);
  return [labels.l1, labels.l2, labels.l3, labels.l4];
}
