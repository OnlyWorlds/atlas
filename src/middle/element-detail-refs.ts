/**
 * "Referenced By" section for element-detail.
 *
 * Scans `state.data.elements` for any element whose fields point back at the
 * target element's id. SDK-shape-agnostic (convention #5): walks all property
 * values whose item shape resembles an id (string, array of strings, array of
 * objects with an `id`, object with an `id`).
 *
 * Pure rendering + the reverse-link scan. No state mutation beyond the
 * navigation click handler.
 */

import { getState, patchSlice } from '../core/state';
import { navigate, elementHash } from '../core/router';
import type { Element, ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';

export function renderReferencedBy(el: Element): HTMLElement | null {
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

/**
 * Find all elements in `state.data.elements` that reference `targetId` somewhere
 * in their field values. Scans every property that looks like an id or array of
 * ids — no hardcoded field-name suffix detection (convention #5).
 *
 * Excludes the target itself. Exported for unit testing.
 */
export function findIncomingReferences(targetId: string): Element[] {
  const all = getState().data.elements;
  const hits: Element[] = [];
  for (const el of all) {
    if (el.id === targetId) continue;
    if (refersTo(el, targetId)) hits.push(el);
  }
  return hits;
}

/** True iff any field on `el` references `targetId`. Exported for unit testing. */
export function refersTo(el: Element, targetId: string): boolean {
  for (const [key, value] of Object.entries(el)) {
    // Skip the obvious non-id metadata.
    if (key === 'id' || key === 'name' || key === 'description' || key === 'type'
      || key === 'local_updated_at' || key === 'server_updated_at') continue;
    if (typeof value === 'string') {
      if (value === targetId) return true;
    } else if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' && item === targetId) return true;
        if (item && typeof item === 'object' && (item as { id?: string }).id === targetId) return true;
      }
    } else if (value && typeof value === 'object') {
      if ((value as { id?: string }).id === targetId) return true;
    }
  }
  return false;
}
