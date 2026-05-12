/**
 * Map Index tab — pinned as tab 0 on the right pane.
 *
 * Uses legacy `.atlas-list` / `.atlas-row` markup. Lists all maps for the
 * active world. Click a row → opens (or focuses) its map tab.
 *
 * Maps and pin counts come from `state.data.elements` filtered by type.
 */

import { getState, patchSlice, subscribe, type RightTabRef } from '../../core/state';
import type { WorldMap, Pin } from '../../core/types';
import { ToastManager } from '../../ui/toast-manager';
import { createMapDialog } from '../../ui/map-create-modal';
import { navigate, mapHash } from '../../core/router';
import { getActiveStore } from '../../ui/create-world-modal';

export function mountMapIndexTab(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-pane atlas-map-index-pane';
  target.appendChild(root);

  function render(): void {
    const state = getState();
    if (!state.active) {
      root.innerHTML = `<div class="atlas-pane-empty">no active world.</div>`;
      return;
    }
    root.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'atlas-section atlas-map-index-header';
    const title = document.createElement('div');
    title.className = 'atlas-section-title';
    title.textContent = 'maps';
    header.appendChild(title);

    const newBtn = document.createElement('button');
    newBtn.className = 'atlas-btn-ghost';
    newBtn.setAttribute('data-action', 'new-map');
    newBtn.textContent = '+ new map';
    newBtn.title = 'create a new map';
    newBtn.addEventListener('click', async () => {
      const result = await createMapDialog(toasts);
      if (result) openMapTab(result.map);
    });
    header.appendChild(newBtn);
    root.appendChild(header);

    const maps = state.data.elements.filter((e): e is WorldMap => e.type === 'map');
    const pins = state.data.elements.filter((e): e is Pin => e.type === 'pin');
    const pinCounts = new Map<string, number>();
    for (const p of pins) pinCounts.set(p.map_id, (pinCounts.get(p.map_id) ?? 0) + 1);

    const list = document.createElement('div');
    list.className = 'atlas-list';
    root.appendChild(list);

    if (maps.length === 0) {
      list.innerHTML = `
        <div class="atlas-pane-empty">
          <div style="max-width:340px">
            <div style="margin-bottom:10px">no maps yet.</div>
            <div style="color:var(--atlas-text-muted);font-size:11px;line-height:1.5">
              click <b>+ new map</b> to create one. attach an image as the base canvas, or start blank.
            </div>
          </div>
        </div>
      `;
      return;
    }

    const active = state.ui.rightTabs[state.ui.rightActiveIndex];
    const activeMapId = active && active.kind === 'map' ? active.mapId : null;
    const sorted = [...maps].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    sorted.forEach(m => list.appendChild(renderRow(m, m.id === activeMapId, pinCounts.get(m.id) ?? 0, toasts)));
  }

  const unsubState = subscribe(render);
  render();
  return unsubState;
}

function renderRow(m: WorldMap, isActive: boolean, pinCount: number, toasts: ToastManager): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-row' + (isActive ? ' selected' : '');
  row.setAttribute('data-map-id', m.id);
  row.setAttribute('role', 'button');
  row.tabIndex = 0;

  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined';
  icon.textContent = 'map';
  row.appendChild(icon);

  const main = document.createElement('span');
  main.className = 'atlas-row-main';
  main.textContent = m.name || '(untitled map)';
  row.appendChild(main);

  if (pinCount > 0) {
    const badge = document.createElement('span');
    badge.className = 'atlas-row-meta';
    badge.title = `${pinCount} pin${pinCount === 1 ? '' : 's'}`;
    badge.textContent = `${pinCount}`;
    row.appendChild(badge);
  }

  if (m.image_media_id || m.image_url) {
    const tag = document.createElement('span');
    tag.className = 'material-symbols-outlined atlas-map-row-imgtag';
    tag.title = m.image_media_id ? 'has local image' : 'has image url';
    tag.textContent = 'image';
    row.appendChild(tag);
  }

  const actions = document.createElement('span');
  actions.className = 'atlas-inline-actions';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'atlas-icon-btn-sm';
  del.setAttribute('data-action', 'delete-map');
  del.title = 'delete map';
  del.innerHTML = '<span class="material-symbols-outlined">delete</span>';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    void handleMapDelete(m, pinCount, toasts);
  });
  actions.appendChild(del);
  row.appendChild(actions);

  row.addEventListener('click', () => openMapTab(m));
  return row;
}

async function handleMapDelete(m: WorldMap, pinCount: number, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  const cascadeNote = pinCount > 0 ? ` this will also remove ${pinCount} pin${pinCount === 1 ? '' : 's'} on this map.` : '';
  if (!confirm(`delete map "${m.name}"?${cascadeNote}`)) return;
  try {
    await store.deleteMap(m.id);
    const elements = await store.listElements();
    patchSlice('data', { elements });

    const ui = getState().ui;
    const tabIdx = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === m.id);
    if (tabIdx >= 0) {
      const next = [...ui.rightTabs];
      next.splice(tabIdx, 1);
      const active = ui.rightActiveIndex >= tabIdx ? Math.max(0, ui.rightActiveIndex - 1) : ui.rightActiveIndex;
      patchSlice('ui', { ...getState().ui, rightTabs: next, rightActiveIndex: active });
    }
    toasts.success(`deleted map "${m.name}"`);
  } catch (err) {
    console.error('[map-index] delete failed:', err);
    toasts.error(err instanceof Error ? err.message : String(err));
  }
}

/** Open (or focus) a map tab on the right. */
export function openMapTab(m: WorldMap): void {
  const ui = getState().ui;
  const existingIndex = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === m.id);
  if (existingIndex >= 0) {
    patchSlice('ui', { ...ui, rightActiveIndex: existingIndex });
  } else {
    const newTab: RightTabRef = { kind: 'map', mapId: m.id, label: m.name || '(untitled)' };
    const nextTabs = [...ui.rightTabs, newTab];
    patchSlice('ui', { ...ui, rightTabs: nextTabs, rightActiveIndex: nextTabs.length - 1 });
  }
  const worldId = getState().active?.worldId;
  if (worldId) navigate(mapHash(worldId, m.id));
}
