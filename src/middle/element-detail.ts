/**
 * Middle pane — element detail view (Bout B: schema-driven editor).
 *
 * Reads schema sections from `field-schema.ts` (SDK FIELD_SCHEMA + ELEMENT_SECTIONS).
 * Each field renders by widget:
 *   - text-short / text-long / number → click value → popover edit
 *   - single-link → chip + pick button (opens picker modal)
 *   - multi-link → chips + add button
 *
 * Reads element data from `state.data.elements` (cached from FolderStore).
 * Writes go through `FolderStore.updateElement` then refresh the cache with
 * a new array reference (force-rerender; convention #2).
 *
 * "Referenced By" section at the bottom: scans `data.elements` for any
 * element whose fields point back at this element's id — SDK-shape-agnostic
 * (scan all array fields whose items have `id` + all scalar id-like fields).
 */

import { getState, patchSlice, subscribe } from '../core/state';
import { onHashChange, parseHash, navigate, elementsHash, elementHash } from '../core/router';
import type { Element, ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { getActiveStore } from '../ui/create-world-modal';
import { openFieldEditPopover } from '../ui/field-edit-popover';
import { toastManager } from '../ui/toast-manager';
import { sectionsFor, type FieldMeta, type SectionLayout } from '../editor/field-schema';
import { pickElement } from '../ui/element-picker-modal';
import { requestPushIfLinked } from '../sync/sync-attach';

/** Known acronyms uppercased in labels: "image_url" → "Image URL". */
const ACRONYMS = new Set(['url', 'id', 'api', 'ui', 'ip', 'html', 'http', 'dns', 'uuid', 'sdk', 'pin', 'gps']);

/** Set of `${type}::${section}` keys currently collapsed. Module-level (survives re-render). */
const collapsedSections = new Set<string>();

/**
 * Per-element scroll position memory. Survives re-renders (field edits, link
 * toggles, picker resolves all cause re-renders that would otherwise reset
 * scroll to 0) and back-navigation (A → B → back to A returns to A's saved
 * scrollTop).
 *
 * Key = element id. Cleared lazily on world switch via `resetElementDetailScrollMemory()`.
 * See atlas-deprecated/src/middle/element-detail.ts and craft #104 for rationale.
 */
const scrollMemory = new Map<string, number>();

/** Drop scroll memory — call on world switch so stale ids don't accumulate. */
export function resetElementDetailScrollMemory(): void {
  scrollMemory.clear();
}

export function mountElementDetail(target: HTMLElement): () => void {
  target.innerHTML = '';

  function getSelectedElement(): Element | null {
    const state = getState();
    const route = parseHash(window.location.hash);
    const id = route.elementId ?? state.ui.selectedElementId;
    if (!id) return null;
    return state.data.elements.find(e => e.id === id) ?? null;
  }

  /**
   * Capture the current body's scrollTop BEFORE we wipe target.innerHTML.
   * Without this, every re-render (field edit, link toggle) would lose the
   * scroll position before the live listener has a chance to save it.
   */
  function captureScrollBeforeRender(): void {
    const prevBody = target.querySelector<HTMLElement>('.atlas-middle-body');
    if (!prevBody) return;
    const prevId = prevBody.dataset.elementId;
    if (prevId && prevBody.scrollTop > 0) {
      scrollMemory.set(prevId, prevBody.scrollTop);
    }
  }

  function render(): void {
    captureScrollBeforeRender();
    target.innerHTML = '';
    const state = getState();
    const route = parseHash(window.location.hash);
    const el = getSelectedElement();

    if (!state.active) {
      target.innerHTML = `<div class="atlas-pane-empty">no active world.</div>`;
      return;
    }
    if (!el) {
      const msg = route.elementId
        ? `element <code>${escapeText(route.elementId)}</code> not found in this world.`
        : 'no element selected. pick one from the <b>elements</b> sidebar.';
      target.innerHTML = `<div class="atlas-pane-empty">${msg}</div>`;
      return;
    }
    renderDetail(el);
  }

  function renderDetail(el: Element): void {
    target.appendChild(renderHeader(el));

    const body = document.createElement('div');
    body.className = 'atlas-middle-body';
    body.dataset.elementId = el.id;
    target.appendChild(body);

    // Live-track scroll position so even partial scrolls survive re-renders.
    body.addEventListener(
      'scroll',
      () => { scrollMemory.set(el.id, body.scrollTop); },
      { passive: true }
    );

    const detail = document.createElement('div');
    detail.className = 'atlas-detail';
    body.appendChild(detail);

    const sections = sectionsFor(el.type);
    sections.forEach((section, idx) => {
      const sectionEl = renderSection(section, el, idx === 0);
      if (sectionEl) detail.appendChild(sectionEl);
    });

    const refs = renderReferencedBy(el);
    if (refs) detail.appendChild(refs);

    detail.appendChild(renderFooter(el));

    // Restore previous scrollTop after the body has laid out. scrollTop set on
    // an empty/unrendered body is silently dropped, hence queueMicrotask.
    const restoreTop = scrollMemory.get(el.id);
    if (typeof restoreTop === 'number' && restoreTop > 0) {
      queueMicrotask(() => { body.scrollTop = restoreTop; });
    }
  }

  // ====== Header ======

  function renderHeader(el: Element): HTMLElement {
    const header = document.createElement('div');
    header.className = 'atlas-middle-header';

    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined';
    icon.textContent = ELEMENT_ICONS[el.type] ?? 'category';
    icon.title = ELEMENT_LABELS[el.type].singular;
    header.appendChild(icon);

    const title = document.createElement('h2');
    title.dataset.role = 'element-name';
    title.textContent = el.name || '(unnamed)';
    header.appendChild(title);

    const spacer = document.createElement('div');
    spacer.className = 'atlas-middle-spacer';
    header.appendChild(spacer);

    // Pin button — only shown when a map tab is currently active.
    const ui = getState().ui;
    const active = ui.rightTabs[ui.rightActiveIndex];
    const activeMapId = active && active.kind === 'map' ? active.mapId : null;
    if (activeMapId) {
      const placing = ui.pinPlacement?.elementId === el.id;
      const pinBtn = document.createElement('button');
      pinBtn.type = 'button';
      pinBtn.className = 'atlas-icon-btn-sm' + (placing ? ' active' : '');
      pinBtn.setAttribute('data-action', 'pin-element');
      pinBtn.title = placing ? 'cancel pin placement' : 'place pin on active map';
      pinBtn.innerHTML = '<span class="material-symbols-outlined">push_pin</span>';
      pinBtn.addEventListener('click', () => {
        const placement = getState().ui.pinPlacement;
        if (placement?.elementId === el.id) {
          patchSlice('ui', { ...getState().ui, pinPlacement: null });
        } else {
          patchSlice('ui', { ...getState().ui, pinPlacement: { elementId: el.id } });
          toastManager.info('click on the map to place the pin');
        }
      });
      header.appendChild(pinBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'atlas-icon-btn-sm danger';
    delBtn.setAttribute('data-action', 'delete-element');
    delBtn.title = 'delete element';
    delBtn.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    delBtn.addEventListener('click', () => onDelete(el));
    header.appendChild(delBtn);

    return header;
  }

  // ====== Sections ======

  function renderSection(section: SectionLayout, el: Element, alwaysExpanded: boolean): HTMLElement | null {
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
        // Force a re-render of the detail by re-emitting data.elements.
        forceRerender();
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
    const labelText = document.createElement('span');
    labelText.textContent = humanizeFieldName(meta.name);
    label.appendChild(labelText);
    if (meta.required) {
      const req = document.createElement('span');
      req.className = 'field-required';
      req.textContent = '*';
      label.appendChild(req);
    }
    wrap.appendChild(label);

    if (meta.widget === 'single-link') {
      wrap.appendChild(renderSingleLink(meta, el));
      return wrap;
    }
    if (meta.widget === 'multi-link') {
      wrap.appendChild(renderMultiLink(meta, el));
      return wrap;
    }

    const raw = (el as any)[meta.name];
    const valueText = formatValue(raw);
    const valueEl = document.createElement('div');
    valueEl.className = 'atlas-field-value' + (valueText ? '' : ' empty');
    valueEl.textContent = valueText || '—';
    valueEl.addEventListener('click', () => {
      openFieldEditPopover({
        anchor: valueEl,
        label: humanizeFieldName(meta.name),
        value: raw === undefined || raw === null ? '' : String(raw),
        widget: meta.widget === 'number' ? 'number' : (meta.widget === 'text-long' ? 'text-long' : 'text-short'),
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

    const raw = (el as any)[meta.name];
    if (raw) {
      row.appendChild(buildLinkChip(String(raw), meta, async () => {
        // Use `null`, not `undefined`. undefined gets dropped by JSON.stringify
        // at disk-write AND by the adapter's wire serializer, so the PATCH
        // body omits the field entirely and the server keeps its old value
        // (real PATCH treats missing keys as "no change"). `null` survives
        // both layers; the SDK's prepareRelations maps it to `<field>_id: null`
        // and the server clears the relation. See sync-engine.fieldClear.test.ts
        // for the rule. Convention #21 in DESIGN.md.
        await persistFieldPatch(el, meta.name, null);
      }));
    } else {
      const empty = document.createElement('div');
      empty.className = 'atlas-field-value empty';
      empty.style.flex = '1';
      empty.textContent = '—';
      row.appendChild(empty);
    }

    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
    pickBtn.title = raw ? `change link` : `pick a ${meta.target ?? 'link'}`;
    pickBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
    pickBtn.addEventListener('click', async () => {
      const picked = await pickElement({
        restrictToType: meta.target,
        excludeIds: raw ? [String(raw)] : undefined,
        title: `pick a ${meta.target ?? 'link'} for ${humanizeFieldName(meta.name)}`,
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

    const raw = (el as any)[meta.name];
    const ids: string[] = Array.isArray(raw) ? raw.map(String) : [];

    ids.forEach(id => {
      wrap.appendChild(buildLinkChip(id, meta, async () => {
        const next = ids.filter(x => x !== id);
        await persistFieldPatch(el, meta.name, next);
      }));
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'atlas-icon-btn-sm atlas-link-pick';
    addBtn.title = ids.length === 0 ? `pick a ${meta.target ?? 'link'}` : `add another ${meta.target ?? 'link'}`;
    addBtn.innerHTML = `<span class="material-symbols-outlined">${pickIconFor(meta.target)}</span>`;
    addBtn.addEventListener('click', async () => {
      const picked = await pickElement({
        restrictToType: meta.target,
        excludeIds: ids,
        title: `add a ${meta.target ?? 'link'} to ${humanizeFieldName(meta.name)}`,
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
      chip.title = `unresolved id (target type: ${meta.target ?? 'unknown'})`;
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

  // ====== Referenced By ======

  function renderReferencedBy(el: Element): HTMLElement | null {
    const incoming = findIncomingReferences(el.id);
    if (incoming.length === 0) return null;

    const wrap = document.createElement('div');
    wrap.className = 'atlas-detail-section';

    const header = document.createElement('div');
    header.className = 'atlas-detail-section-header no-toggle';
    header.innerHTML = `<span>Referenced By</span><span class="atlas-refs-count">${incoming.length}</span>`;
    wrap.appendChild(header);

    const body = document.createElement('div');
    body.className = 'atlas-detail-section-body atlas-detail-refs';
    wrap.appendChild(body);

    // Group by source type for readability.
    const byType = new Map<ElementType, Element[]>();
    for (const src of incoming) {
      const arr = byType.get(src.type) ?? [];
      arr.push(src);
      byType.set(src.type, arr);
    }

    for (const [type, sources] of byType.entries()) {
      const group = document.createElement('div');
      group.className = 'atlas-field';
      const label = document.createElement('div');
      label.className = 'atlas-field-label';
      label.textContent = ELEMENT_LABELS[type]?.plural ?? type;
      group.appendChild(label);
      const chips = document.createElement('div');
      chips.className = 'atlas-link-row';
      sources.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
      for (const src of sources) {
        chips.appendChild(buildRefChip(src));
      }
      group.appendChild(chips);
      body.appendChild(group);
    }
    return wrap;
  }

  function buildRefChip(src: Element): HTMLElement {
    const chip = document.createElement('span');
    chip.className = 'atlas-link-chip';
    chip.title = `${src.type} · id ${src.id}`;
    const icon = document.createElement('span');
    icon.className = 'material-symbols-outlined atlas-link-chip-icon';
    icon.textContent = ELEMENT_ICONS[src.type];
    chip.appendChild(icon);
    const name = document.createElement('span');
    name.textContent = src.name || '(unnamed)';
    chip.appendChild(name);
    chip.addEventListener('click', () => {
      const worldId = getState().active?.worldId;
      if (worldId) {
        patchSlice('ui', { ...getState().ui, selectedElementId: src.id });
        navigate(elementHash(worldId, src.id));
      }
    });
    return chip;
  }

  // ====== Footer ======

  function renderFooter(el: Element): HTMLElement {
    const meta = document.createElement('div');
    meta.className = 'atlas-detail-meta';
    const updated = el.local_updated_at ? new Date(el.local_updated_at).toLocaleString() : '—';
    const synced = el.server_updated_at ? new Date(el.server_updated_at).toLocaleString() : 'not synced';
    meta.innerHTML = `
      <div>ID: <code>${escapeText(el.id)}</code></div>
      <div>Updated locally: ${escapeText(updated)}</div>
      <div>Server: ${escapeText(synced)}</div>
    `;
    return meta;
  }

  // ====== Persistence helpers ======

  async function persistFieldPatch(el: Element, fieldName: string, nextValue: unknown): Promise<void> {
    const store = getActiveStore();
    if (!store) {
      toastManager.error('no active store');
      return;
    }
    try {
      await store.updateElement(el.id, { [fieldName]: nextValue } as Partial<Element>);
      const elements = await store.listElements();
      patchSlice('data', { elements });
      // Local write succeeded — schedule a debounced push. No-op for local-only.
      requestPushIfLinked();
    } catch (err) {
      console.error('[element-detail] update failed:', err);
      toastManager.error(err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  async function onDelete(el: Element): Promise<void> {
    const store = getActiveStore();
    if (!store) return;
    let dependentCount = 0;
    try {
      const dependents = await store.findDependents(el.id);
      dependentCount = dependents.length;
    } catch { /* fall through with 0 */ }
    const extra = dependentCount > 0 ? ` this will also remove ${dependentCount} dependent element${dependentCount === 1 ? '' : 's'}.` : '';
    const ok = window.confirm(`delete "${el.name || el.id}"?${extra}`);
    if (!ok) return;
    try {
      await store.deleteElement(el.id);
      const elements = await store.listElements();
      patchSlice('data', { elements });
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
      // Local delete + tombstones written — schedule a push to DELETE on server.
      requestPushIfLinked();
      toastManager.success(`deleted ${el.name || 'element'}`);
      const worldId = getState().active?.worldId;
      if (worldId) navigate(elementsHash(worldId));
    } catch (err) {
      console.error('[element-detail] delete failed:', err);
      toastManager.error(err instanceof Error ? err.message : String(err));
    }
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

// ============================================================
// Reverse-link scan (SDK-shape-agnostic — convention #5)
// ============================================================

/**
 * Find all elements in `state.data.elements` that reference `targetId` somewhere
 * in their field values. Scans every property that looks like an id or array of
 * ids — no hardcoded field-name suffix detection.
 *
 * Excludes the target itself.
 */
function findIncomingReferences(targetId: string): Element[] {
  const all = getState().data.elements;
  const hits: Element[] = [];
  for (const el of all) {
    if (el.id === targetId) continue;
    if (refersTo(el, targetId)) hits.push(el);
  }
  return hits;
}

function refersTo(el: Element, targetId: string): boolean {
  for (const [key, value] of Object.entries(el)) {
    // Skip the obvious non-id metadata.
    if (key === 'id' || key === 'name' || key === 'description' || key === 'type'
      || key === 'local_updated_at' || key === 'server_updated_at') continue;
    if (typeof value === 'string') {
      if (value === targetId) return true;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item === targetId) return true;
        if (item && typeof item === 'object' && (item as any).id === targetId) return true;
      }
    } else if (value && typeof value === 'object') {
      if ((value as any).id === targetId) return true;
    }
  }
  return false;
}

// ============================================================
// Helpers
// ============================================================

function humanizeFieldName(name: string): string {
  return name
    .split('_')
    .map(word => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

function formatValue(raw: unknown): string {
  if (raw === undefined || raw === null || raw === '') return '';
  return String(raw);
}

function pickIconFor(target: ElementType | undefined): string {
  if (target && ELEMENT_ICONS[target]) return ELEMENT_ICONS[target];
  return 'add_link';
}

function forceRerender(): void {
  // Re-emit data.elements with a new array reference so the detail subscriber re-fires.
  const data = getState().data;
  patchSlice('data', { elements: [...data.elements] });
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
