/**
 * Elements-mode sidebar body — legacy markup (.atlas-list / .atlas-row).
 *
 * Filter strip (one icon per type) + search input + create button + list.
 * Click a row → select element + navigate to its detail.
 *
 * Body-only — the parent sidebar driver owns the mode toggle and footer gear.
 * Reads element data from `state.data.elements` (primed on world activation
 * by `activateWorld`); mutations refresh that slice with a new array reference.
 */

import { getState, subscribe, patchSlice } from '../core/state';
import { onHashChange, navigate, elementHash } from '../core/router';
import { CONTENT_ELEMENT_TYPES, type ElementType, type Element } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import { ToastManager } from '../ui/toast-manager';
import { ElementCreateModal } from '../ui/element-create-modal';

/** Types shown in the filter strip — matches legacy: all 22 except pin/marker (placed via maps). */
const FILTER_TYPES_WITH_MAP: ElementType[] = [...CONTENT_ELEMENT_TYPES, 'map', 'zone'];

export interface ElementsBodyMount {
  content: HTMLElement;
  toasts: ToastManager;
}

export function mountElementsBody(mount: ElementsBodyMount): () => void {
  const { content, toasts } = mount;
  content.innerHTML = '';

  // ----- Filter strip -----
  const strip = document.createElement('div');
  strip.className = 'atlas-filter-strip';
  content.appendChild(strip);

  // ----- Search + create row (legacy pattern: + icon inside the search row) -----
  const searchRow = document.createElement('div');
  searchRow.className = 'atlas-search-row';
  const searchInput = document.createElement('input');
  searchInput.className = 'atlas-input';
  searchInput.type = 'text';
  searchInput.placeholder = 'search elements...';
  searchInput.setAttribute('data-role', 'elements-search');
  searchInput.style.flex = '1 1 auto';
  searchRow.appendChild(searchInput);

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'atlas-create-btn';
  createBtn.setAttribute('data-action', 'create-element');
  createBtn.title = 'new element';
  createBtn.innerHTML = '<span class="material-symbols-outlined">add</span>';
  createBtn.addEventListener('click', () => new ElementCreateModal(toasts).open());
  searchRow.appendChild(createBtn);

  content.appendChild(searchRow);

  searchInput.addEventListener('input', () => {
    patchSlice('ui', { ...getState().ui, search: searchInput.value });
  });

  // ----- List body -----
  const listEl = document.createElement('div');
  listEl.className = 'atlas-list';
  content.appendChild(listEl);

  listEl.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-element-id]');
    if (!row) return;
    const id = row.getAttribute('data-element-id')!;
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    patchSlice('ui', { ...getState().ui, selectedElementId: id });
    navigate(elementHash(worldId, id));
  });

  function renderFilters(): void {
    const state = getState();
    const elements = state.data.elements;
    const filters = state.ui.elementFilters;
    const countByType = new Map<ElementType, number>();
    for (const el of elements) countByType.set(el.type, (countByType.get(el.type) ?? 0) + 1);

    strip.innerHTML = '';
    FILTER_TYPES_WITH_MAP.forEach(type => {
      const btn = document.createElement('button');
      btn.className = 'atlas-filter-btn' + (filters.has(type) ? ' active' : '');
      btn.title = ELEMENT_LABELS[type].plural;
      btn.setAttribute('data-filter-type', type);

      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined';
      icon.textContent = ELEMENT_ICONS[type];
      btn.appendChild(icon);

      const count = countByType.get(type) ?? 0;
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'atlas-filter-count';
        badge.textContent = count > 99 ? '99+' : String(count);
        btn.appendChild(badge);
      }

      btn.addEventListener('click', () => {
        const curr = getState().ui.elementFilters;
        const next = new Set(curr);
        if (next.has(type)) next.delete(type); else next.add(type);
        patchSlice('ui', { ...getState().ui, elementFilters: next });
      });
      strip.appendChild(btn);
    });
  }

  function render(): void {
    const state = getState();

    if (!state.active) {
      strip.innerHTML = '';
      listEl.innerHTML = `<div class="atlas-pane-empty">no active world. pick one from the worlds tab.</div>`;
      return;
    }

    renderFilters();

    if (searchInput.value !== state.ui.search) searchInput.value = state.ui.search;

    const elements = state.data.elements;
    const filters = state.ui.elementFilters;
    const query = state.ui.search.trim().toLowerCase();
    const selectedId = state.ui.selectedElementId;

    const filtered = elements
      .filter(el => el.type !== 'pin' && el.type !== 'marker' && el.type !== 'zone')
      .filter(el => filters.size === 0 || filters.has(el.type))
      .filter(el => !query || el.name.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (filtered.length === 0) {
      const msg = elements.length === 0
        ? 'no elements yet — click <b>+ new element</b> to start.'
        : 'no elements match the current filter.';
      listEl.innerHTML = `<div class="atlas-pane-empty">${msg}</div>`;
      return;
    }

    listEl.innerHTML = filtered.map(el => renderElementRow(el, el.id === selectedId)).join('');
  }

  const unsubState = subscribe(render);
  const unsubHash = onHashChange(render);
  render();
  return () => { unsubState(); unsubHash(); };
}

function renderElementRow(el: Element, selected: boolean): string {
  const icon = ELEMENT_ICONS[el.type] ?? 'category';
  const cls = ['atlas-row', selected ? 'selected' : ''].filter(Boolean).join(' ');
  return `
    <div class="${cls}" data-element-id="${escapeAttr(el.id)}" data-element-type="${escapeAttr(el.type)}" role="button" tabindex="0">
      <span class="material-symbols-outlined">${icon}</span>
      <span class="atlas-row-main">${escapeText(el.name || '(unnamed)')}</span>
      <span class="atlas-row-meta">${escapeText(el.type)}</span>
    </div>
  `;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
