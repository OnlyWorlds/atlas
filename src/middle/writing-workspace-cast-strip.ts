/**
 * Character-cast strip for the writing workspace.
 *
 * Mounted between the breadcrumb and the prose host. Shows a 5-tab pivot
 * (characters / locations / objects / events / creatures) with chips for
 * the elements of the selected type that the narrative currently has linked
 * via its relation field. Clicking a chip inserts an ow:// chip at the
 * current cursor position in the editor.
 *
 * The five types are the prose-relevant subset of OW's 22 — the schema-y
 * types (Relation, Trait, etc.) aren't useful to inline-mention while drafting.
 * Use the `@` picker for everything else.
 *
 * Persistence: last-selected tab is kept on `WorldRegistryEntry.writing_cast_tab`.
 * Visibility: hidden in reading mode + focus mode (CSS rules in atlas.css).
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry } from '../registry/registry';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../core/constants';
import type { Element, ElementType, WorldRegistryEntry } from '../core/types';
import { escapeText } from '../core/dom-utils';
import type { Editor } from '@tiptap/core';

const CAST_TYPES = ['characters', 'locations', 'objects', 'events', 'creatures'] as const;
export type CastTab = typeof CAST_TYPES[number];

/** Map plural relation-field name → singular element type. */
const TAB_TO_TYPE: Record<CastTab, ElementType> = {
  characters: 'character',
  locations: 'location',
  objects: 'object',
  events: 'event',
  creatures: 'creature',
};

export interface CastStripOpts {
  narrative: Element;
  worldId: string;
  /** Live editor — chip insertion target. May be null briefly during mount. */
  getEditor: () => Editor | null;
}

export function renderCastStrip(opts: CastStripOpts): HTMLElement {
  const { narrative, worldId, getEditor } = opts;
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  const activeTab: CastTab = (entry?.writing_cast_tab ?? 'characters') as CastTab;

  const strip = document.createElement('div');
  strip.className = 'atlas-writing-workspace-cast';
  strip.dataset.activeTab = activeTab;

  // Tabs row.
  const tabsRow = document.createElement('div');
  tabsRow.className = 'atlas-writing-workspace-cast-tabs';
  for (const tab of CAST_TYPES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-writing-workspace-cast-tab';
    btn.dataset.tab = tab;
    if (tab === activeTab) btn.classList.add('is-active');
    btn.textContent = tab; // already lowercase plural
    btn.addEventListener('click', () => {
      persistTab(worldId, tab);
      strip.dataset.activeTab = tab;
      tabsRow.querySelectorAll('.atlas-writing-workspace-cast-tab').forEach(t => {
        t.classList.toggle('is-active', (t as HTMLElement).dataset.tab === tab);
      });
      renderChipsInto(chipsRow, narrative, tab, getEditor);
    });
    tabsRow.appendChild(btn);
  }
  strip.appendChild(tabsRow);

  // Chips row.
  const chipsRow = document.createElement('div');
  chipsRow.className = 'atlas-writing-workspace-cast-chips';
  renderChipsInto(chipsRow, narrative, activeTab, getEditor);
  strip.appendChild(chipsRow);

  return strip;
}

function persistTab(worldId: string, tab: CastTab): void {
  const reg = getState().registry;
  const idx = reg.worlds.findIndex(w => w.id === worldId);
  if (idx < 0) return;
  if (reg.worlds[idx].writing_cast_tab === tab) return;
  const updated: WorldRegistryEntry = { ...reg.worlds[idx], writing_cast_tab: tab };
  const next = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
  saveRegistry(next);
  patchSlice('registry', next);
}

function renderChipsInto(
  chipsRow: HTMLElement,
  narrative: Element,
  tab: CastTab,
  getEditor: () => Editor | null,
): void {
  chipsRow.innerHTML = '';
  const elementType = TAB_TO_TYPE[tab];
  const fieldName = tab; // multi-link relation field name is the plural tab name
  const linkedIds = readMultiLink(narrative, fieldName);

  if (linkedIds.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'atlas-writing-workspace-cast-empty';
    const label = ELEMENT_LABELS[elementType]?.plural ?? tab;
    empty.textContent = `No ${label} linked yet — type @ to link.`;
    chipsRow.appendChild(empty);
    return;
  }

  // Resolve linked elements; skip any whose id doesn't resolve (stale link).
  const byId = new Map<string, Element>();
  for (const el of getState().data.elements) byId.set(el.id, el);

  const resolved = linkedIds
    .map(id => byId.get(id))
    .filter((el): el is Element => Boolean(el) && el!.type === elementType)
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  for (const el of resolved) {
    chipsRow.appendChild(buildCastChip(el, getEditor));
  }
}

function buildCastChip(el: Element, getEditor: () => Editor | null): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'atlas-writing-workspace-cast-chip';
  chip.title = `Insert ${el.name} as a link`;
  chip.dataset.elementId = el.id;
  chip.dataset.elementType = el.type;

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined atlas-writing-workspace-cast-chip-icon';
  icon.textContent = ELEMENT_ICONS[el.type] ?? 'category';
  chip.appendChild(icon);

  const name = document.createElement('span');
  name.className = 'atlas-writing-workspace-cast-chip-name';
  name.textContent = el.name || '(unnamed)';
  chip.appendChild(name);

  chip.addEventListener('click', () => {
    const editor = getEditor();
    if (!editor) return;
    editor
      .chain()
      .focus()
      .insertContent([
        { type: 'elementChip', attrs: { id: el.id, type: el.type, label: el.name || '' } },
        { type: 'text', text: ' ' },
      ])
      .run();
  });

  return chip;
}

function readMultiLink(narrative: Element, field: string): string[] {
  const raw = (narrative as Record<string, unknown>)[field];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object' && typeof (item as { id?: string }).id === 'string') {
      out.push((item as { id: string }).id);
    }
  }
  return out;
}
