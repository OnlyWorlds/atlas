/**
 * Map Index tab — pinned as tab 0 on the right pane.
 *
 * Renders the world's maps as a NESTED TREE built by `buildMapTree`. Tree
 * structure follows: explicit parent_map > location-inferred via Location
 * parent chain > root with location chip. Siblings sort by hierarchy then
 * alpha. See DESIGN_MAPS.md §2 / §3.1 for the full model.
 *
 * Click a row → open or focus its map tab. Delete affordance on hover.
 *
 * TODO (later bout): collapse/expand affordance per node with children,
 * persisted per-world in the registry. For now all nodes render expanded.
 */

import { getState, patchSlice, subscribe, type RightTabRef } from '../../core/state';
import type { WorldMap, Pin, Element } from '../../core/types';
import { ToastManager } from '../../ui/toast-manager';
import { createMapDialog } from '../../ui/map-create-modal';
import { navigate, mapHash, elementHash } from '../../core/router';
import { getActiveStore } from '../../ui/create-world-modal';
import { requestPushIfLinked } from '../../sync/sync-attach';
import { buildMapTree, type MapTreeNode, type LocationLike } from './map-tree';

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
    newBtn.textContent = '+ New map';
    newBtn.title = 'create a new map';
    newBtn.addEventListener('click', async () => {
      const result = await createMapDialog(toasts);
      if (result) openMapTab(result.map);
    });
    header.appendChild(newBtn);
    root.appendChild(header);

    const maps = state.data.elements.filter((e): e is WorldMap => e.type === 'map');
    const pins = state.data.elements.filter((e): e is Pin => e.type === 'pin');
    const locations: LocationLike[] = state.data.elements
      .filter((e): e is Element => e.type === 'location')
      .map(e => {
        // Element's index signature is `[field: string]: unknown` — read
        // parent_location via the bracketed access to avoid a cast.
        const raw = e['parent_location'];
        return {
          id: e.id,
          parent_location: typeof raw === 'string' ? raw : undefined,
        };
      });

    const pinCounts = new Map<string, number>();
    for (const p of pins) pinCounts.set(p.map_id, (pinCounts.get(p.map_id) ?? 0) + 1);

    const locationNames = new Map<string, string>();
    for (const e of state.data.elements) {
      if (e.type === 'location') locationNames.set(e.id, e.name || '(unnamed location)');
    }

    const list = document.createElement('div');
    list.className = 'atlas-list atlas-map-tree';
    root.appendChild(list);

    if (maps.length === 0) {
      list.innerHTML = `
        <div class="atlas-pane-empty">
          <div style="max-width:340px">
            <div style="margin-bottom:10px">No maps yet.</div>
            <div style="color:var(--atlas-text-muted);font-size:11px;line-height:1.5">
              Click <b>+ New map</b> to create one. Attach an image as the base canvas, or start blank.
            </div>
          </div>
        </div>
      `;
      return;
    }

    const active = state.ui.rightTabs[state.ui.rightActiveIndex];
    const activeMapId = active && active.kind === 'map' ? active.mapId : null;
    const tree = buildMapTree(maps, locations);

    renderTree(list, tree, 0, {
      activeMapId,
      pinCounts,
      locationNames,
      toasts,
    });
  }

  const unsubState = subscribe(render);
  render();
  return unsubState;
}

interface RenderCtx {
  activeMapId: string | null;
  pinCounts: Map<string, number>;
  locationNames: Map<string, string>;
  toasts: ToastManager;
}

function renderTree(list: HTMLElement, nodes: MapTreeNode[], depth: number, ctx: RenderCtx): void {
  for (const node of nodes) {
    list.appendChild(renderRow(node, depth, ctx));
    if (node.children.length > 0) {
      renderTree(list, node.children, depth + 1, ctx);
    }
  }
}

function renderRow(node: MapTreeNode, depth: number, ctx: RenderCtx): HTMLElement {
  const m = node.map;
  const row = document.createElement('div');
  row.className = 'atlas-row atlas-map-tree-row' + (m.id === ctx.activeMapId ? ' selected' : '');
  row.setAttribute('data-map-id', m.id);
  if (depth > 0) row.setAttribute('data-depth', String(depth));
  row.style.setProperty('--atlas-map-tree-depth', String(depth));
  row.setAttribute('role', 'button');
  row.tabIndex = 0;

  // Indent spacer — purely visual; CSS uses the custom property too.
  if (depth > 0) {
    const spacer = document.createElement('span');
    spacer.className = 'atlas-map-tree-indent';
    spacer.style.width = `${depth * 14}px`;
    row.appendChild(spacer);
  }

  const hasImage = !!(m.image_url || m.image_media_id);
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined' + (hasImage ? ' atlas-map-tree-icon-has-image' : '');
  icon.textContent = 'map';
  if (hasImage) {
    if (m.image_url && m.image_media_id) {
      icon.title = 'has image (URL shown, local file kept as fallback)';
    } else if (m.image_url) {
      icon.title = 'has image (URL)';
    } else {
      icon.title = 'has image (local file)';
    }
  }
  row.appendChild(icon);

  const main = document.createElement('span');
  main.className = 'atlas-row-main';
  main.textContent = m.name || '(untitled map)';
  row.appendChild(main);

  // Location chip — surfaces loc-bound maps and lets users click through to
  // the location's element-detail. Material icon prefix disambiguates from
  // the image badge (both used to be unlabeled glyphs side by side, which
  // read as one cluster).
  if (typeof m.location === 'string' && m.location) {
    const locName = ctx.locationNames.get(m.location);
    if (locName) {
      const chip = document.createElement('span');
      chip.className = 'atlas-row-chip atlas-row-chip-location';
      chip.title = `Location: ${locName} (click to open)`;
      chip.setAttribute('role', 'button');
      chip.tabIndex = 0;
      const icon = document.createElement('span');
      icon.className = 'material-symbols-outlined atlas-row-chip-icon';
      icon.textContent = 'location_on';
      chip.appendChild(icon);
      const label = document.createElement('span');
      label.textContent = locName;
      chip.appendChild(label);
      const locationId = m.location;
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        const worldId = getState().active?.worldId;
        if (!worldId) return;
        patchSlice('ui', { ...getState().ui, selectedElementId: locationId, sidebarMode: 'elements' });
        navigate(elementHash(worldId, locationId));
      });
      row.appendChild(chip);
    }
  }

  if (node.brokenParent) {
    const chip = document.createElement('span');
    chip.className = 'atlas-row-chip atlas-row-chip-warn';
    chip.title = 'parent_map references a missing map (or would create a cycle) — surfaced at root';
    chip.textContent = 'broken parent';
    row.appendChild(chip);
  }

  // Metadata zone — pin count always renders (including 0) so labels align
  // across the list. Zero-count gets a muted variant via data-empty so it
  // visually recedes vs counts > 0.
  const pinCount = ctx.pinCounts.get(m.id) ?? 0;
  const meta = document.createElement('span');
  meta.className = 'atlas-row-meta';
  const badge = document.createElement('span');
  badge.className = 'atlas-pin-count-badge';
  if (pinCount === 0) badge.setAttribute('data-empty', 'true');
  badge.title = `${pinCount} pin${pinCount === 1 ? '' : 's'}`;
  badge.textContent = `${pinCount}`;
  meta.appendChild(badge);
  row.appendChild(meta);

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
    void handleMapDelete(m, pinCount, ctx.toasts);
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
    requestPushIfLinked();

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
  const activeWorldId = getState().active?.worldId;
  const existingIndex = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === m.id);
  if (existingIndex >= 0) {
    patchSlice('ui', { ...ui, rightActiveIndex: existingIndex });
  } else {
    const newTab: RightTabRef = {
      kind: 'map',
      mapId: m.id,
      label: m.name || '(untitled)',
      worldId: activeWorldId,
    };
    const nextTabs = [...ui.rightTabs, newTab];
    patchSlice('ui', { ...ui, rightTabs: nextTabs, rightActiveIndex: nextTabs.length - 1 });
  }
  if (activeWorldId) navigate(mapHash(activeWorldId, m.id));
}
