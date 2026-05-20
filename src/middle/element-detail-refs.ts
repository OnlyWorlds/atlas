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
import { navigate, elementHash, writingHash } from '../core/router';
import type { Element, ElementType } from '../core/types';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';

/**
 * Render the "incoming references" panel for an element.
 *
 * Narratives are surfaced separately as "Mentioned in" — they're the highest-
 * signal incoming reference for writers ("what scenes does this character
 * appear in?") and they route to the writing room on click (not element-detail),
 * matching the writer's intent. Other element types render in the standard
 * "Referenced by" section below.
 *
 * Auto-derive (convention #50) pushes every prose `ow://` mention into the
 * narrative's relation fields on save, so this single reverse-scan catches
 * prose-linked AND manually-linked narratives uniformly. See DESIGN_WRITING.md.
 */
export function renderReferencedBy(el: Element): HTMLElement | null {
  const incoming = findIncomingReferences(el.id);
  if (incoming.length === 0) return null;

  const narratives = incoming.filter(src => src.type === 'narrative');
  const others = incoming.filter(src => src.type !== 'narrative');

  const wrap = document.createElement('div');
  wrap.className = 'atlas-detail-refs-wrap';

  if (narratives.length > 0) {
    wrap.appendChild(buildSection({
      headerLabel: 'Mentioned in',
      count: narratives.length,
      sources: narratives,
      // Narratives have their own room — open the writing surface so the
      // reader can drop into the prose context, not the schema editor.
      navigateTo: 'writing',
      sectionClass: 'atlas-detail-section atlas-detail-refs-mentioned',
    }));
  }

  if (others.length > 0) {
    wrap.appendChild(buildSection({
      headerLabel: 'Referenced by',
      count: others.length,
      sources: others,
      navigateTo: 'element',
      sectionClass: 'atlas-detail-section',
    }));
  }

  return wrap;
}

interface SectionOpts {
  headerLabel: string;
  count: number;
  sources: Element[];
  navigateTo: 'element' | 'writing';
  sectionClass: string;
}

function buildSection(opts: SectionOpts): HTMLElement {
  const { headerLabel, count, sources, navigateTo, sectionClass } = opts;
  const section = document.createElement('div');
  section.className = sectionClass;

  const header = document.createElement('div');
  header.className = 'atlas-detail-section-header no-toggle';
  header.innerHTML = `<span>${headerLabel}</span><span class="atlas-refs-count">${count}</span>`;
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'atlas-detail-section-body atlas-detail-refs';
  section.appendChild(body);

  // Group by source type for readability. (For the Mentioned-in section this
  // always single-type — narrative — but the by-type grouping is harmless.)
  const byType = new Map<ElementType, Element[]>();
  for (const src of sources) {
    const arr = byType.get(src.type) ?? [];
    arr.push(src);
    byType.set(src.type, arr);
  }

  for (const [type, group] of byType.entries()) {
    const wrap = document.createElement('div');
    wrap.className = 'atlas-field';
    const label = document.createElement('div');
    label.className = 'atlas-field-label';
    label.textContent = ELEMENT_LABELS[type]?.plural ?? type;
    wrap.appendChild(label);
    const chips = document.createElement('div');
    chips.className = 'atlas-link-row';
    group.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
    for (const src of group) {
      chips.appendChild(buildRefChip(src, navigateTo));
    }
    wrap.appendChild(chips);
    body.appendChild(wrap);
  }
  return section;
}

function buildRefChip(src: Element, navigateTo: 'element' | 'writing'): HTMLElement {
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
    if (!worldId) return;
    if (navigateTo === 'writing') {
      // Don't mirror selectedElementId — writing room's URL is the source of
      // truth (convention #46). The global selection stays where it was.
      navigate(writingHash(worldId, src.id));
    } else {
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
