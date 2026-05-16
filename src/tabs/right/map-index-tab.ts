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
 * Disclosure (session 211 finishing bout MZ): nodes with children get a
 * chevron prefix; click toggles. Collapsed state lives in localStorage per
 * world (key `atlas_map_tree_collapsed_v1`), independent of registry — pure
 * UI pref that doesn't merit a cross-machine sync surface.
 */

import { getState, patchSlice, subscribe, type RightTabRef } from '../../core/state';
import type { WorldMap, Pin, Element } from '../../core/types';
import { ToastManager } from '../../ui/toast-manager';
import { createMapDialog } from '../../ui/map-create-modal';
import { navigate, mapHash, elementHash } from '../../core/router';
import { getActiveStore } from '../../ui/create-world-modal';
import { requestPushIfLinked } from '../../sync/sync-attach';
import { buildMapTree, filterTreeByName, type MapTreeNode, type LocationLike } from './map-tree';

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

function toggleNodeCollapsed(worldId: string, mapId: string): void {
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
      input.placeholder = 'search maps...';
      input.value = searchTerm;
      input.spellcheck = false;
      input.autocomplete = 'off';
      input.setAttribute('data-role', 'map-search');
      input.addEventListener('input', () => {
        searchTerm = input.value;
        render();
        // Preserve focus across the re-render.
        const fresh = root.querySelector<HTMLInputElement>('input[data-role="map-search"]');
        if (fresh) {
          fresh.focus();
          // Restore caret to end of value (re-render reset selection).
          const len = fresh.value.length;
          fresh.setSelectionRange(len, len);
        }
      });
      searchRow.appendChild(input);
      if (searchTerm) {
        const clear = document.createElement('button');
        clear.type = 'button';
        clear.className = 'atlas-map-index-search-clear';
        clear.title = 'clear search';
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

    renderTree(list, tree, 0, {
      activeMapId,
      openMapIds,
      pinCounts,
      locationNames,
      toasts,
      worldId,
      requestRerender: render,
      // During active search, ignore collapsed state — every match is
      // visible and reachable. Clearing the search restores it.
      ignoreCollapsed: !!trimmedSearch,
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
}

function renderTree(list: HTMLElement, nodes: MapTreeNode[], depth: number, ctx: RenderCtx): void {
  for (const node of nodes) {
    const collapsed = !ctx.ignoreCollapsed && isNodeCollapsed(ctx.worldId, node.map.id);
    list.appendChild(renderRow(node, depth, ctx, collapsed));
    // Skip descendants when this node is collapsed.
    if (node.children.length > 0 && !collapsed) {
      renderTree(list, node.children, depth + 1, ctx);
    }
  }
}

function renderRow(node: MapTreeNode, depth: number, ctx: RenderCtx, collapsed: boolean): HTMLElement {
  const m = node.map;
  const hasChildren = node.children.length > 0;
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

  // Disclosure chevron — visible only for nodes with children. Leaf nodes
  // get a placeholder span of the same width so the row icons stay aligned
  // across siblings (mix of leaves + parents in one group is the common case).
  const chevron = document.createElement('span');
  if (hasChildren) {
    chevron.className = 'atlas-map-tree-chevron';
    chevron.setAttribute('role', 'button');
    chevron.setAttribute('aria-label', collapsed ? 'expand' : 'collapse');
    chevron.title = collapsed ? `expand (${node.children.length} child${node.children.length === 1 ? '' : 'ren'})` : 'collapse';
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
  if (ctx.openMapIds.has(m.id)) main.classList.add('atlas-map-tree-row-open');
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
  // Only navigate when the caller wants the URL to reflect a specific
  // element selection alongside the map. Otherwise leave the URL alone —
  // the right pane is independent of the middle pane's primary route.
  if (preserveElementId && activeWorldId) {
    navigate(mapHash(activeWorldId, m.id, preserveElementId));
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
