/**
 * Zone canvas + chip-strip sync (DESIGN_MAPS.md §13, DESIGN_ZONES.md §4).
 *
 * Two responsibilities:
 *   1. Sync zones-on-this-map into the per-tab ZoneOverlay (Leaflet canvas).
 *   2. Render the chip strip below the canvas.
 *
 * Both read from state.data.elements + map_view_prefs and re-render on
 * change. Click chip → select zone; right-click chip → context menu.
 */

import { getState, patchSlice } from '../../core/state';
import { navigate, elementHash } from '../../core/router';
import { ELEMENT_LABELS } from '../../core/constants';
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import {
  listZonesOnMap,
  markersForZoneOnMap,
  partitionZonesAndMarkers,
  getZoneShape,
} from './zone-derived';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import type { Zone } from '../../core/types';
import { getActiveStore } from '../../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import type { ToastManager } from '../../ui/toast-manager';

/**
 * Sync the ZoneOverlay to the current state. Adds new zones, updates changed
 * geometry / visuals, removes deleted ones. Mirrors syncPins shape.
 */
export function syncZones(entry: MapTabCacheEntry): void {
  if (!entry.zoneOverlay) return;
  const state = getState();
  const { zones, markers } = partitionZonesAndMarkers(state.data.elements);
  const onThisMap = listZonesOnMap(entry.mapId, markers, zones);

  const present = new Set<string>();
  const prefs = getEffectiveMapPrefs(entry.mapId);

  for (const zone of onThisMap) {
    present.add(zone.id);
    const points = markersForZoneOnMap(zone.id, entry.mapId, markers).map(m => ({
      x: m.x,
      y: m.y,
    }));
    const mode = getZoneShape(zone);
    const opacity = zoneEffectiveOpacity(zone, prefs.zone_fill_opacity);
    // Label policy:
    //   - 'always' → labelText = zone.name, hover-only = false (always shown)
    //   - 'hover'  → labelText = zone.name, hover-only = true  (fade on hover)
    //   - 'never'  → labelText = undefined (no marker built)
    const labelMode = prefs.zone_labels;
    const labelText = labelMode === 'never' ? undefined : zone.name;
    const labelHoverOnly = labelMode === 'hover';

    entry.zoneOverlay.addZone({
      id: zone.id,
      mode,
      points,
      color: (zone as { atlas_color?: string }).atlas_color,
      opacity,
      labelText,
      labelHoverOnly,
    });
  }

  // Remove overlay entries that are no longer on this map. Iterate the
  // OVERLAY's known ids (ZD2 fix) — iterating `zones` from state was wrong
  // because a just-deleted zone isn't in state.data.elements anymore, so the
  // remove loop never visited its id and the polygon stayed on the canvas
  // until page reload. With `getZoneIds`, we see every rendered overlay and
  // can drop ones not in the current present-on-this-map set.
  for (const id of entry.zoneOverlay.getZoneIds()) {
    if (!present.has(id)) {
      entry.zoneOverlay.removeZone(id);
    }
  }

  // Reflect selection in canvas styling.
  const selectedId = state.ui.selectedElementId;
  for (const zone of onThisMap) {
    entry.zoneOverlay.setZoneSelected(zone.id, zone.id === selectedId);
  }

  renderChipStrip(entry, onThisMap, selectedId);
}

function zoneEffectiveOpacity(zone: Zone, mapDefault: number): number {
  const explicit = (zone as { atlas_opacity?: number }).atlas_opacity;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  return mapDefault;
}

// computeLabelText replaced inline (session 219) — label policy now sets both
// labelText AND labelHoverOnly on the ZoneShape so ZoneOverlay can wire fade
// behavior. Kept the export-shape pattern for any external callers.
export function computeLabelText(zone: Zone, mode: 'always' | 'hover' | 'never'): string | undefined {
  return mode === 'never' ? undefined : zone.name;
}

/**
 * Render the zones dropdown panel + sync the toolbar dropdown button (ZC9
 * replaces the bottom-of-canvas chip strip from DESIGN_MAPS.md §13).
 *
 * - When zones.length === 0: hide both the toolbar button AND the panel.
 * - Otherwise: show the button with a count badge; render chip-styled rows
 *   into the panel. Panel opens/closes via the button (wireZonesDropdown).
 */
function renderChipStrip(entry: MapTabCacheEntry, zones: Zone[], selectedId?: string | null): void {
  const strip = entry.zoneStrip;
  strip.innerHTML = '';

  // Update the toolbar dropdown button (count + visibility). The button lives
  // in entry.toolbar — query for it by its data-action attribute so this
  // helper is independent of CanvasToolbarRefs.
  const btn = entry.toolbar.querySelector<HTMLButtonElement>('[data-action="zones-dropdown"]');
  const countEl = btn?.querySelector<HTMLElement>('[data-role="zones-count"]');

  if (zones.length === 0) {
    strip.style.display = 'none';
    strip.classList.remove('is-open');
    if (btn) {
      btn.style.display = 'none';
      btn.classList.remove('is-open');
    }
    return;
  }

  if (btn) {
    btn.style.display = '';
    if (countEl) countEl.textContent = String(zones.length);
  }
  // Panel itself stays display: '' so the .is-open class controls visibility
  // (driven by wireZonesDropdown). Keep it laid out so opening doesn't lag.
  strip.style.display = '';

  for (const z of zones) {
    const chip = document.createElement('div');
    chip.className = 'atlas-zone-chip';
    if (z.id === selectedId) chip.classList.add('is-selected');
    chip.setAttribute('data-zone-id', z.id);
    chip.setAttribute('title', `${ELEMENT_LABELS.zone.singular}: ${z.name}`);

    const shapeIcon = getZoneShape(z) === 'line' ? 'show_chart' : 'hexagon';
    const color = (z as { atlas_color?: string }).atlas_color ?? '#22d3ee';

    chip.innerHTML = `
      <span class="material-symbols-outlined atlas-zone-chip-shape">${shapeIcon}</span>
      <span class="atlas-zone-chip-dot" style="background:${color}"></span>
      <span class="atlas-zone-chip-name">${escapeHtml(z.name)}</span>
      <button type="button" class="atlas-zone-chip-x" data-action="delete" title="Delete zone">
        <span class="material-symbols-outlined">delete</span>
      </button>
    `;
    strip.appendChild(chip);
  }
}

/**
 * Bind handlers on the chip strip. Called once when the strip is mounted in
 * mountMapTab. Uses event delegation so individual chips don't need
 * per-render listener cleanup.
 */
export function wireChipStrip(entry: MapTabCacheEntry, toasts: ToastManager): void {
  const strip = entry.zoneStrip;

  strip.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>('.atlas-zone-chip');
    if (!chip) return;
    // Defensive: stop bubbling so the click can't reach any ancestor handler
    // that might mis-interpret it (e.g. a sibling filter strip that shares a
    // delegated parent in a future layout). Chip selection should be a
    // contained gesture.
    e.stopPropagation();
    const zoneId = chip.getAttribute('data-zone-id');
    if (!zoneId) return;

    // Delete affordance.
    if (target.closest('[data-action="delete"]')) {
      await deleteZoneFromChip(zoneId, toasts);
      return;
    }

    // Plain click → select zone AND navigate to element-detail route so the
    // middle pane reflects the selection (parity with canvas zone-click flow).
    // sidebarMode is intentionally left alone: navigation to /element/<id>
    // triggers sidebar.syncModeFromRoute which already flips to elements mode
    // when the route is content-y. Setting it here too creates a double-patch.
    const worldId = getState().active?.worldId;
    if (worldId) {
      patchSlice('ui', { ...getState().ui, selectedElementId: zoneId });
      navigate(elementHash(worldId, zoneId));
    } else {
      patchSlice('ui', { ...getState().ui, selectedElementId: zoneId });
    }
  });

  strip.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement;
    const chip = target.closest<HTMLElement>('.atlas-zone-chip');
    if (!chip) return;
    e.preventDefault();
    const zoneId = chip.getAttribute('data-zone-id');
    if (!zoneId) return;
    showChipContextMenu(zoneId, e.clientX, e.clientY, toasts);
  });
}

async function deleteZoneFromChip(zoneId: string, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  const zone = getState().data.elements.find(e => e.id === zoneId);
  if (!zone) return;
  // Confirm via the standard delete pattern. Cascade tombstones markers.
  const dependents = await store.findDependents(zoneId);
  const ok = window.confirm(
    `Delete zone "${zone.name}"? This will also remove ${dependents.length} marker(s).`,
  );
  if (!ok) return;
  try {
    await store.deleteZone(zoneId);
    const elements = await store.listElements();
    patchSlice('data', { elements });
    // Clear selection if we just deleted the selected zone.
    if (getState().ui.selectedElementId === zoneId) {
      patchSlice('ui', { ...getState().ui, selectedElementId: null });
    }
    requestPushIfLinked();
    toasts.success(`Zone deleted`);
  } catch (err) {
    console.error('[zone-chip] delete failed:', err);
    toasts.error('Failed to delete zone');
  }
}

function showChipContextMenu(zoneId: string, clientX: number, clientY: number, toasts: ToastManager): void {
  // Tear down any existing menu first.
  document.querySelectorAll('.atlas-zone-chip-context').forEach(el => el.remove());

  const menu = document.createElement('div');
  menu.className = 'atlas-zone-chip-context';
  menu.style.left = `${clientX}px`;
  menu.style.top = `${clientY}px`;

  const item = (label: string, action: () => void) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'atlas-zone-chip-context-item';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      action();
      menu.remove();
    });
    return btn;
  };

  menu.append(
    item('Rename', () => renameZone(zoneId, toasts)),
    item('Delete', () => { void deleteZoneFromChip(zoneId, toasts); }),
  );

  document.body.appendChild(menu);

  const dismiss = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener('mousedown', dismiss);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss), 0);
}

async function renameZone(zoneId: string, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  const zone = getState().data.elements.find(e => e.id === zoneId);
  if (!zone) return;
  const next = window.prompt('New zone name', zone.name);
  if (next === null || next.trim() === '' || next === zone.name) return;
  try {
    await store.updateZone(zoneId, { name: next.trim() });
    const elements = await refreshElementsAfterWrite(store);
  } catch (err) {
    console.error('[zone-chip] rename failed:', err);
    toasts.error('Failed to rename zone');
  }
}

/**
 * Pure helper — called from the global subscribe in map-tab.ts to refresh
 * zones on every visible map tab.
 */
export function refreshActiveMapZones(): void {
  const state = getState();
  const active = state.ui.rightTabs[state.ui.rightActiveIndex];
  if (!active || active.kind !== 'map') return;
  const cached = activeCache(active.mapId);
  if (!cached) return;
  syncZones(cached);
}

function activeCache(mapId: string): MapTabCacheEntry | null {
  return mapTabCache.get(mapId) ?? null;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}
