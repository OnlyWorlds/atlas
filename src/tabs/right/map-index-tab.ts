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
 * Disclosure: nodes with children get a
 * chevron prefix; click toggles. Collapsed state lives in localStorage per
 * world (key `atlas_map_tree_collapsed_v1`), independent of registry — pure
 * UI pref that doesn't merit a cross-machine sync surface.
 */

import { getState, patchSlice, subscribe, type RightTabRef } from '../../core/state';
import type { WorldMap, Pin, Element } from '../../core/types';
import { ToastManager, toastManager } from '../../ui/toast-manager';
import { showProblem } from '../../ui/problem-fixes';
import { createMapDialog } from '../../ui/map-create-modal';
import { navigate, mapHash, elementHash } from '../../core/router';
import { getActiveStore } from '../../core/active-store';
import { worldIsViewOnly } from '../../core/view-only';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import { buildMapTree, filterTreeByName, type MapTreeNode, type LocationLike } from './map-tree';
import { clearCameraState } from '../../core/map-camera-persist';
import { escapeText, installRowKeydownActivation } from '../../core/dom-utils';
import { renderGate, keepingFocus } from '../../ui/render-gate';

// ---- Collapsed tree-node state ----

const COLLAPSED_STORAGE_KEY = 'atlas_map_tree_collapsed_v1';

/** worldId → set of collapsed map ids. Lazy-loaded from localStorage. */
let collapsedByWorld: Map<string, Set<string>> | null = null;

function loadCollapsed(): Map<string, Set<string>> {
  if (collapsedByWorld) return collapsedByWorld;
  collapsedByWorld = new Map();
  try {
    const raw = localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [wid, ids] of Object.entries(parsed)) {
        if (Array.isArray(ids)) {
          collapsedByWorld.set(wid, new Set(ids.filter((s): s is string => typeof s === 'string')));
        }
      }
    }
  } catch {
    // Corrupted store — start fresh, not worth a warning.
  }
  return collapsedByWorld;
}

function saveCollapsed(): void {
  if (!collapsedByWorld) return;
  const dump: Record<string, string[]> = {};
  for (const [wid, ids] of collapsedByWorld.entries()) {
    if (ids.size > 0) dump[wid] = [...ids];
  }
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(dump));
  } catch {
    /* localStorage quota / disabled — non-fatal */
  }
}

function isNodeCollapsed(worldId: string, mapId: string): boolean {
  const all = loadCollapsed();
  return all.get(worldId)?.has(mapId) ?? false;
}

/**
 * The re-key moves ids; stored state follows. Remaps a world's
 * collapsed map ids in the in-memory shadow AND storage, so a later toggle
 * cannot write the old ids back. Loading first makes memory the truth.
 */
export function remapCollapsedMapIds(worldId: string, map: ReadonlyMap<string, string>): void {
  const set = loadCollapsed().get(worldId);
  if (!set) return;
  let changed = false;
  for (const [oldId, newId] of map) {
    if (!set.has(oldId)) continue;
    set.delete(oldId);
    set.add(newId);
    changed = true;
  }
  if (changed) saveCollapsed();
}

// Exported for the re-key test (toggle after remap must keep the new ids).
export function toggleNodeCollapsed(worldId: string, mapId: string): void {
  const all = loadCollapsed();
  let set = all.get(worldId);
  if (!set) {
    set = new Set();
    all.set(worldId, set);
  }
  if (set.has(mapId)) set.delete(mapId);
  else set.add(mapId);
  saveCollapsed();
}

export function mountMapIndexTab(target: HTMLElement, toasts: ToastManager): () => void {
  target.innerHTML = '';
  const root = document.createElement('div');
  root.className = 'atlas-pane atlas-map-index-pane';
  target.appendChild(root);

  // Search state — closure-local so each tab instance has its own. Cleared
  // when the tab unmounts. Not persisted across page reloads (transient UX
  // pref, like a sidebar filter chip).
  let searchTerm = '';

  // ---- Drag-to-reorder (same-sibling-group only) ----
  //
  // Rows are draggable=true. On drop, the source's `data-parent-id` must
  // match the target's (same rendered-tree group). Cross-parent drag is
  // refused with a toast — reparenting via this gesture would conflate two
  // distinct mutations (changing the parent_map link AND the sibling order).
  // The map-create modal's parent_map override handles reparenting.
  //
  // Algorithm: compute the new visual order, then re-stamp `hierarchy` as
  // 0,1,2,... on every sibling whose value changed. Multiple writes but the
  // siblings count is usually small; one requestPushIfLinked at the end so
  // sync sees a single autosave window.
  let dragSourceMapId: string | null = null;

  function clearDragHighlight(): void {
    root.querySelectorAll<HTMLElement>('.atlas-map-tree-row[data-drop-pos]').forEach(el => {
      el.removeAttribute('data-drop-pos');
    });
  }

  function dropPositionFor(row: HTMLElement, clientY: number): 'before' | 'after' {
    const rect = row.getBoundingClientRect();
    return clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  installRowKeydownActivation(root);

  root.addEventListener('dragstart', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.atlas-map-tree-row');
    if (!row) return;
    const mapId = row.getAttribute('data-map-id');
    if (!mapId) return;
    dragSourceMapId = mapId;
    e.dataTransfer?.setData('application/x-atlas-map', mapId);
    e.dataTransfer!.effectAllowed = 'move';
    row.classList.add('atlas-row-dragging');
  });
  root.addEventListener('dragend', () => {
    root.querySelectorAll<HTMLElement>('.atlas-row-dragging').forEach(el => el.classList.remove('atlas-row-dragging'));
    clearDragHighlight();
    dragSourceMapId = null;
  });
  root.addEventListener('dragover', (e) => {
    if (!dragSourceMapId) return;
    const row = (e.target as HTMLElement).closest<HTMLElement>('.atlas-map-tree-row');
    if (!row) return;
    const targetId = row.getAttribute('data-map-id');
    if (!targetId || targetId === dragSourceMapId) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'move';
    const pos = dropPositionFor(row, e.clientY);
    clearDragHighlight();
    row.setAttribute('data-drop-pos', pos);
  });
  root.addEventListener('dragleave', (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.atlas-map-tree-row');
    if (!row) return;
    // Only clear when leaving for a non-row target — keeps the highlight
    // stable while the cursor moves across child elements within a row.
    const related = e.relatedTarget as Node | null;
    if (related && row.contains(related)) return;
    row.removeAttribute('data-drop-pos');
  });
  root.addEventListener('drop', async (e) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.atlas-map-tree-row');
    if (!row) return;
    e.preventDefault();
    const targetId = row.getAttribute('data-map-id');
    const sourceId = dragSourceMapId;
    const pos = (row.getAttribute('data-drop-pos') ?? 'after') as 'before' | 'after';
    clearDragHighlight();
    dragSourceMapId = null;
    if (!sourceId || !targetId || sourceId === targetId) return;

    const state = getState();
    const allMaps = state.data.elements.filter((el): el is WorldMap => el.type === 'map');
    const source = allMaps.find(m => m.id === sourceId);
    const target = allMaps.find(m => m.id === targetId);
    if (!source || !target) return;

    // Same-sibling-group check via `data-parent-id` (rendered-tree parent).
    const sourceRow = root.querySelector<HTMLElement>(`.atlas-map-tree-row[data-map-id="${CSS.escape(sourceId)}"]`);
    const sourceParentId = sourceRow?.getAttribute('data-parent-id') ?? '';
    const targetParentId = row.getAttribute('data-parent-id') ?? '';
    if (sourceParentId !== targetParentId) {
      toasts.info('Drag only reorders maps under the same parent. To move a map, set its Parent map in Configure map.');
      return;
    }

    // Gather siblings in their current document order from the rendered DOM.
    // This already reflects hierarchy + alpha ordering from buildMapTree.
    const siblingRows = Array.from(
      root.querySelectorAll<HTMLElement>(`.atlas-map-tree-row[data-parent-id="${CSS.escape(sourceParentId)}"]`),
    );
    const orderedIds = siblingRows
      .map(r => r.getAttribute('data-map-id'))
      .filter((id): id is string => !!id);
    const without = orderedIds.filter(id => id !== sourceId);
    const targetIndex = without.indexOf(targetId);
    if (targetIndex < 0) return;
    const insertAt = pos === 'before' ? targetIndex : targetIndex + 1;
    const reordered = [...without.slice(0, insertAt), sourceId, ...without.slice(insertAt)];

    // Re-stamp hierarchy. Only write maps whose value actually changes.
    const store = getActiveStore();
    if (!store) return;
    const writes: Promise<unknown>[] = [];
    for (let i = 0; i < reordered.length; i++) {
      const m = allMaps.find(x => x.id === reordered[i]);
      if (!m) continue;
      if (m.hierarchy !== i) {
        writes.push(store.updateMap(m.id, { hierarchy: i }));
      }
    }
    if (writes.length === 0) return;
    try {
      await Promise.all(writes);
      const elements = await refreshElementsAfterWrite(store);
      toasts.success(`Reordered ${writes.length} map${writes.length === 1 ? '' : 's'}`);
    } catch (err) {
      console.error('[map-index] reorder failed:', err);
      showProblem(err, { doing: 'reordering the maps', toasts });
    }
  });

  // Rebuilt only when an input moved (conv. 146): a rebuild between a
  // press and its release loses the click. The parts are the slices the index
  // reads, its search box and a count of the redraws its rows ask for (the
  // collapsed maps live outside the store).
  const gate = renderGate();
  let rerenderSeq = 0;

  // The search keeps its focus and caret through every redraw, a data tick's included.
  function render(): void {
    keepingFocus(root, 'input[data-role="map-search"]', draw);
  }

  function draw(): void {
    const state = getState();
    // A view-only world gets no New map, no drag reorder and no delete
    // (conv. 149); keyed in the gate so a key change redraws.
    const viewOnly = worldIsViewOnly();
    if (!gate.changed([state.active, state.data, state.ui, searchTerm, rerenderSeq, viewOnly])) return;
    if (!state.active) {
      root.innerHTML = `<div class="atlas-pane-empty">No world open. Pick one from the sidebar.</div>`;
      return;
    }
    root.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'atlas-section atlas-map-index-header';
    const title = document.createElement('div');
    title.className = 'atlas-section-title';
    title.textContent = 'Maps';
    header.appendChild(title);
    root.appendChild(header);

    if (!viewOnly) {
      const newBtn = document.createElement('button');
      // Zero maps → the + glyph glows: the affordance IS the empty-state teaching
      // (the explainer paragraph is gone; the glow points at the action).
      const mapCount = state.data.elements.filter(e => e.type === 'map').length;
      newBtn.className = 'atlas-create-icon-btn atlas-header-add-glyph'
        + (mapCount === 0 ? ' atlas-create-glow' : '');
      newBtn.setAttribute('data-action', 'new-map');
      newBtn.innerHTML =
        '<span class="material-symbols-outlined atlas-add-glyph-plus">add</span>' +
        '<span class="material-symbols-outlined atlas-add-glyph-main">map</span>';
      newBtn.title = 'New map';
      newBtn.addEventListener('click', async () => {
        const result = await createMapDialog(toasts);
        if (result) openMapTab(result.map);
      });
      header.appendChild(newBtn);
    }

    // Search input — filters the tree by map name (case-insensitive
    // substring). Hidden when there are 0 maps (no point) and at fewer than
    // 3 maps (the tree is trivially scannable). Threshold is arbitrary;
    // erring on the side of "appears when actually useful".
    const SEARCH_MIN_MAPS = 3;
    const mapsForGate = state.data.elements.filter(e => e.type === 'map');
    if (mapsForGate.length >= SEARCH_MIN_MAPS) {
      const searchRow = document.createElement('div');
      searchRow.className = 'atlas-map-index-search';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'atlas-input atlas-map-index-search-input';
      input.placeholder = 'Search maps…';
      input.value = searchTerm;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('data-role', 'map-search');
      input.addEventListener('input', () => {
        searchTerm = input.value;
        render();
      });
      searchRow.appendChild(input);
      if (searchTerm) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'atlas-map-index-search-clear';
        clear.title = 'Clear search';
        clear.innerHTML = '<span class="material-symbols-outlined">close</span>';
        clear.addEventListener('click', () => {
          searchTerm = '';
          render();
        });
        searchRow.appendChild(clear);
      }
      root.appendChild(searchRow);
    }

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
            <div>No maps yet.</div>
          </div>
        </div>
      `;
      return;
    }

    const active = state.ui.rightTabs[state.ui.rightActiveIndex];
    const activeMapId = active && active.kind === 'map' ? active.mapId : null;
    // Any map with an open tab (active or background) — highlights the row's
    // name so users see at a glance which maps are already loaded.
    const openMapIds = new Set<string>();
    for (const t of state.ui.rightTabs) {
      if (t.kind === 'map') openMapIds.add(t.mapId);
    }
    const fullTree = buildMapTree(maps, locations);
    const worldId = state.active.worldId;
    const trimmedSearch = searchTerm.trim();
    const tree = trimmedSearch ? filterTreeByName(fullTree, trimmedSearch) : fullTree;

    if (trimmedSearch && tree.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'atlas-pane-empty';
      empty.innerHTML = `<div style="max-width:340px"><div style="margin-bottom:6px">No maps match "${escapeText(trimmedSearch)}".</div></div>`;
      list.appendChild(empty);
      return;
    }

    renderTree(list, tree, 0, null, {
      activeMapId,
      openMapIds,
      pinCounts,
      locationNames,
      toasts,
      worldId,
      requestRerender: () => { rerenderSeq++; render(); },
      // During active search, ignore collapsed state — every match is
      // visible and reachable. Clearing the search restores it.
      ignoreCollapsed: !!trimmedSearch,
      viewOnly,
    });
  }

  const unsubState = subscribe(render);
  render();
  return unsubState;
}

interface RenderCtx {
  activeMapId: string | null;
  /** Map ids that have an open right-pane tab (active or background). */
  openMapIds: Set<string>;
  pinCounts: Map<string, number>;
  locationNames: Map<string, string>;
  toasts: ToastManager;
  worldId: string;
  requestRerender: () => void;
  /** When true, collapsed state is ignored — everything renders expanded.
   *  Set during active search so matching descendants are reachable. */
  ignoreCollapsed: boolean;
  /** The world is view-only: rows open and select, never move or delete. */
  viewOnly: boolean;
}

function renderTree(list: HTMLElement, nodes: MapTreeNode[], depth: number, parentId: string | null, ctx: RenderCtx): void {
  for (const node of nodes) {
    const collapsed = !ctx.ignoreCollapsed && isNodeCollapsed(ctx.worldId, node.map.id);
    list.appendChild(renderRow(node, depth, parentId, ctx, collapsed));
    // Skip descendants when this node is collapsed.
    if (node.children.length > 0 && !collapsed) {
      renderTree(list, node.children, depth + 1, node.map.id, ctx);
    }
  }
}

function renderRow(node: MapTreeNode, depth: number, parentId: string | null, ctx: RenderCtx, collapsed: boolean): HTMLElement {
  const m = node.map;
  const hasChildren = node.children.length > 0;
  const row = document.createElement('div');
  row.className = 'atlas-row atlas-map-tree-row' + (m.id === ctx.activeMapId ? ' selected' : '');
  row.setAttribute('data-map-id', m.id);
  // Rendered-tree parent id — drives the drag-reorder same-group check. Empty
  // string for root nodes. NOT the same as `parent_map` on disk: a map without
  // an explicit `parent_map` whose tree position came from location inference
  // sits under the inferred parent's id here.
  row.setAttribute('data-parent-id', parentId ?? '');
  // Drag re-stamps `hierarchy`: no drag on a view-only world (conv. 149).
  if (!ctx.viewOnly) row.setAttribute('draggable', 'true');
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

  // Disclosure chevron — visible only for nodes with children. Leaf nodes
  // get a placeholder span of the same width so the row icons stay aligned
  // across siblings (mix of leaves + parents in one group is the common case).
  const chevron = document.createElement('span');
  if (hasChildren) {
    chevron.className = 'atlas-map-tree-chevron';
    chevron.setAttribute('role', 'button');
    chevron.setAttribute('aria-label', collapsed ? 'Expand' : 'Collapse');
    chevron.title = collapsed ? `Expand (${node.children.length} child${node.children.length === 1 ? '' : 'ren'})` : 'Collapse';
    chevron.innerHTML = `<span class="material-symbols-outlined">${collapsed ? 'chevron_right' : 'expand_more'}</span>`;
    chevron.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNodeCollapsed(ctx.worldId, m.id);
      ctx.requestRerender();
    });
  } else {
    chevron.className = 'atlas-map-tree-chevron-placeholder';
  }
  row.appendChild(chevron);

  const hasImage = !!(m.image_url || m.image_media_id);
  const icon = document.createElement('span');
  icon.className = 'material-symbols-outlined' + (hasImage ? ' atlas-map-tree-icon-has-image' : '');
  icon.textContent = 'map';
  if (hasImage) {
    if (m.image_url && m.image_media_id) {
      icon.title = 'Has image (URL shown, local file kept as fallback)';
    } else if (m.image_url) {
      icon.title = 'Has image (URL)';
    } else {
      icon.title = 'Has image (local file)';
    }
  }
  row.appendChild(icon);

  const main = document.createElement('span');
  main.className = 'atlas-row-main';
  if (ctx.openMapIds.has(m.id)) main.classList.add('atlas-map-tree-row-open');
  main.textContent = m.name || '(unnamed map)';
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
      // SDK ELEMENT_ICONS.location = 'castle' — match the Location element
      // type icon used everywhere else (sidebar rows, pin canvas glyph) so
      // the chip reads as "this is a Location" rather than "this is a pin."
      icon.textContent = 'castle';
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
    chip.title = 'Its parent map is missing (or would loop), so it shows at the top level';
    chip.textContent = 'Broken parent';
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

  // No delete on a view-only world (conv. 149).
  if (!ctx.viewOnly) {
    const actions = document.createElement('span');
    actions.className = 'atlas-inline-actions';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'atlas-icon-btn-sm';
    del.setAttribute('data-action', 'delete-map');
    del.title = 'Delete map';
    del.innerHTML = '<span class="material-symbols-outlined">delete</span>';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      void handleMapDelete(m, pinCount, ctx.toasts);
    });
    actions.appendChild(del);
    row.appendChild(actions);
  }

  row.addEventListener('click', () => openMapTab(m));
  // Right-click → select this map ELEMENT (navigate to element-detail). The
  // left-click already opens the map's tab; right-click is the "I want to
  // edit this map's fields" gesture.
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    patchSlice('ui', { ...getState().ui, selectedElementId: m.id, sidebarMode: 'elements' });
    navigate(elementHash(worldId, m.id));
  });
  return row;
}

async function handleMapDelete(m: WorldMap, pinCount: number, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  const cascadeNote = pinCount > 0 ? ` This also removes ${pinCount} pin${pinCount === 1 ? '' : 's'} on this map.` : '';
  if (!confirm(`Delete map "${m.name}"?${cascadeNote} This cannot be undone.`)) return;
  try {
    await store.deleteMap(m.id);
    // Drop the saved camera state for this map — no point retaining a view
    // for a map that no longer exists. If the map id happens to be reused
    // later (re-link of an api world), the view falls back to fit-to-image.
    clearCameraState(m.id);
    const elements = await refreshElementsAfterWrite(store);

    const ui = getState().ui;
    const tabIdx = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === m.id);
    if (tabIdx >= 0) {
      const next = [...ui.rightTabs];
      next.splice(tabIdx, 1);
      const active = ui.rightActiveIndex >= tabIdx ? Math.max(0, ui.rightActiveIndex - 1) : ui.rightActiveIndex;
      patchSlice('ui', { ...getState().ui, rightTabs: next, rightActiveIndex: active });
    }
    toasts.success(`Deleted map "${m.name}"`);
  } catch (err) {
    console.error('[map-index] delete failed:', err);
    showProblem(err, { doing: 'deleting the map', toasts });
  }
}

/**
 * Open (or focus) a map tab on the right pane.
 *
 * Middle-pane behavior is governed by the URL. Two cases:
 *
 *   - `preserveElementId` is set: caller wants the middle pane to KEEP
 *     showing a specific element detail (e.g. element-detail top-bar
 *     `[map]` / `[pin]` click). We navigate to the chained
 *     `/map/<mid>/element/<eid>` form so the middle pane stays on that
 *     element AND the right pane opens this map. Both parts of the URL
 *     describe what's displayed.
 *
 *   - `preserveElementId` is NOT set: caller wants to add a map tab to the
 *     right pane WITHOUT touching the middle pane. We mutate `rightTabs`
 *     only — no `navigate()` call. The URL stays whatever it was, so the
 *     middle pane keeps rendering whatever the user was looking at
 *     (element-detail, timeline, settings, etc.). Map tabs are ephemeral
 *     session state; not having them in the URL is fine.
 *
 * This split fixes the regression where clicking a map in the index would
 * navigate to `/map/<mid>` and flip the middle pane to timeline (the
 * world-active default for routes with no elementId).
 */
export function openMapTab(m: WorldMap, preserveElementId?: string): void {
  const ui = getState().ui;
  const activeWorldId = getState().active?.worldId;

  // Imageless maps open like any other — they render the sized
  // flat canvas and accept pins/zones (DESIGN_MAPS.md §4.2). The old refusal
  // + divert-to-element-detail is gone.
  const existingIndex = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === m.id);
  if (existingIndex >= 0) {
    patchSlice('ui', { ...ui, rightActiveIndex: existingIndex });
  } else {
    const newTab: RightTabRef = {
      kind: 'map',
      mapId: m.id,
      label: m.name || '(unnamed)',
      worldId: activeWorldId,
    };
    const nextTabs = [...ui.rightTabs, newTab];
    patchSlice('ui', { ...ui, rightTabs: nextTabs, rightActiveIndex: nextTabs.length - 1 });
  }
  // Only navigate when the caller wants the URL to reflect a specific
  // element selection alongside the map. Otherwise leave the URL alone —
  // the right pane is independent of the middle pane's primary route.
  if (preserveElementId && activeWorldId) {
    navigate(mapHash(activeWorldId, m.id, preserveElementId));
  }
}


