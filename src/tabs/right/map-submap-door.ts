/**
 * Into a submap and back up (#139, S387; the Captain's ask, h20 #2081).
 *
 * A pin whose element is a Location with its own map (some Map names it as
 * `location`) already wears the map badge (`hasLinkedSubMap`). Clicking the
 * pin still opens the element (DESIGN_MAPS §3.6: a click selects, it never
 * moves the right pane); while that element is selected, a small door floats
 * beside its pin on this map: "Open <its map>". The submap's toolbar carries
 * the way back: "Up to <parent>", the parent the map tree shows (an explicit
 * `parent_map`, else the one inferred from the location chain, §2).
 *
 * Both swap the CURRENT map tab in place, so a walk down and back up never
 * piles up tabs; a target already open in another tab is focused instead.
 */

import L from 'leaflet';
import type { Element, WorldMap } from '../../core/types';
import { getState, patchSlice } from '../../core/state';
import { escapeText } from '../../core/dom-utils';
import { getAssociatedMaps } from './auto-open-map';
import { buildMapTree, type LocationLike, type MapTreeNode } from './map-tree';
import type { MapTabCacheEntry } from './map-tab-cache';

/** The maps of a Location element other than `exceptMapId`, in the tree's order (hierarchy, then name). */
export function submapsFor(elementId: string, elements: readonly Element[], exceptMapId: string): WorldMap[] {
  const el = elements.find(e => e.id === elementId);
  if (!el || el.type !== 'location') return [];
  return getAssociatedMaps(elementId, elements).filter(m => m.id !== exceptMapId);
}

/** The map above `mapId` in the maps tree, or null for a root (or a map that is gone). */
export function parentMapFor(mapId: string, elements: readonly Element[]): WorldMap | null {
  const maps = elements.filter((e): e is WorldMap => e.type === 'map');
  const locations: LocationLike[] = elements
    .filter(e => e.type === 'location')
    .map(e => ({ id: e.id, parent_location: typeof e['parent_location'] === 'string' ? e['parent_location'] as string : undefined }));
  const walk = (nodes: MapTreeNode[], parent: WorldMap | null): WorldMap | null | undefined => {
    for (const n of nodes) {
      if (n.map.id === mapId) return parent;
      const found = walk(n.children, n.map);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(buildMapTree(maps, locations), null) ?? null;
}

/**
 * Show `to` in the tab that shows `fromMapId`: focus it where it is already
 * open, else replace that tab's map. Falls back to a new tab when `fromMapId`
 * has none.
 */
export function swapMapTab(fromMapId: string, to: WorldMap): void {
  const ui = getState().ui;
  const already = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === to.id);
  if (already >= 0) {
    patchSlice('ui', { ...ui, rightActiveIndex: already });
    return;
  }
  const ref = { kind: 'map' as const, mapId: to.id, label: to.name || '(unnamed)', worldId: getState().active?.worldId };
  const at = ui.rightTabs.findIndex(t => t.kind === 'map' && t.mapId === fromMapId);
  const rightTabs = [...ui.rightTabs];
  if (at >= 0) rightTabs[at] = ref; else rightTabs.push(ref);
  patchSlice('ui', { ...ui, rightTabs, rightActiveIndex: at >= 0 ? at : rightTabs.length - 1 });
}

const doors = new WeakMap<MapTabCacheEntry, L.Marker>();

/** The floating door beside the selected element's pin, when its place has a map of its own. */
export function refreshSubmapDoor(entry: MapTabCacheEntry): void {
  const lMap = entry.manager.getMap();
  const prior = doors.get(entry);
  if (prior) { prior.remove(); doors.delete(entry); }
  if (!lMap) return;
  const state = getState();
  const selected = state.ui.selectedElementId;
  if (!selected) return;
  const elements = state.data.elements;
  const targets = submapsFor(selected, elements, entry.mapId);
  if (targets.length === 0) return;
  const pin = elements.find(e => e.type === 'pin' && e['map_id'] === entry.mapId && e['element_id'] === selected);
  const drawn = pin ? entry.manager.getPin(pin.id) : undefined;
  if (!drawn || !drawn.visible) return;
  const html = targets.slice(0, 3).map(m =>
    `<button type="button" class="atlas-submap-door-btn" data-action="open-submap" data-map-id="${escapeText(m.id)}">`
    + `<span class="material-symbols-outlined" aria-hidden="true">zoom_in_map</span>`
    + `<span>Open ${escapeText(m.name || 'its map')}</span></button>`).join('');
  const door = L.marker(drawn.marker.getLatLng(), {
    // Above and right of the pin: below it sit the pin's own label and the
    // hover tooltip, which stays up while the pointer rests on the pin.
    icon: L.divIcon({ className: 'atlas-submap-door', html, iconSize: undefined, iconAnchor: [-14, 18 + 32 * Math.min(targets.length, 3)] }),
    interactive: true,
    keyboard: false,
    zIndexOffset: 1000,
  });
  door.on('add', () => {
    const el = door.getElement();
    if (!el) return;
    L.DomEvent.disableClickPropagation(el);
    el.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-action="open-submap"]');
      const to = btn && getState().data.elements.find(e => e.id === btn.dataset.mapId && e.type === 'map');
      if (to) swapMapTab(entry.mapId, to as WorldMap);
    });
  });
  door.addTo(lMap);
  doors.set(entry, door);
}

/** "Up to <parent>" at the head of the map's toolbar; hidden on a root map. */
export function refreshUpButton(entry: MapTabCacheEntry): void {
  let btn = entry.toolbar.querySelector<HTMLButtonElement>('[data-action="map-up"]');
  const parent = parentMapFor(entry.mapId, getState().data.elements);
  if (!parent) { btn?.remove(); return; }
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-map-toolbar-btn atlas-map-up-btn';
    btn.setAttribute('data-action', 'map-up');
    btn.addEventListener('click', () => {
      const to = getState().data.elements.find(e => e.id === btn!.dataset.mapId && e.type === 'map');
      if (to) swapMapTab(entry.mapId, to as WorldMap);
    });
    entry.toolbar.prepend(btn);
  }
  const name = parent.name || '(unnamed)';
  btn.dataset.mapId = parent.id;
  btn.title = `Up to ${name}`;
  btn.setAttribute('aria-label', `Up to ${name}`);
  btn.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>`
    + `<span class="atlas-map-up-label">${escapeText(name)}</span>`;
}
