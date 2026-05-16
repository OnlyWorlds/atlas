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
import { ELEMENT_LABELS } from '../../core/constants';
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import {
  listZonesOnMap,
  markersForZoneOnMap,
  partitionZonesAndMarkers,
} from './zone-derived';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import type { Zone } from '../../core/types';
import { getActiveStore } from '../../ui/create-world-modal';
import { requestPushIfLinked } from '../../sync/sync-attach';
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
    const mode = (zone.supertype === 'line' ? 'line' : 'polygon') as 'polygon' | 'line';
    const opacity = zoneEffectiveOpacity(zone, prefs.zone_fill_opacity);
    const labelText = computeLabelText(zone, prefs.zone_labels);

    entry.zoneOverlay.addZone({
      id: zone.id,
      mode,
      points,
      color: (zone as { atlas_color?: string }).atlas_color,
      opacity,
      labelText,
    });
  }

  // Remove zones no longer on this map. Iterate cached ids by querying overlay.
  // ZoneOverlay doesn't expose its key set; we approximate by removing any
  // zone in state that isn't on this map AND that the overlay currently has.
  // Pragmatic enough — the overlay has a `hasZone` helper.
  for (const z of zones) {
    if (!present.has(z.id) && entry.zoneOverlay.hasZone(z.id)) {
      entry.zoneOverlay.removeZone(z.id);
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

function computeLabelText(zone: Zone, mode: 'always' | 'hover' | 'never'): string | undefined {
  if (mode === 'never') return undefined;
  if (mode === 'hover') return undefined; // hover-only labels handled via tooltip in a future pass
  return zone.name;
}

/**
 * Render the chip strip below the canvas (DESIGN_MAPS.md §13).
 */
function renderChipStrip(entry: MapTabCacheEntry, zones: Zone[], selectedId?: string | null): void {
  const strip = entry.zoneStrip;
  strip.innerHTML = '';
  if (zones.length === 0) {
    strip.style.display = 'none';
    return;
  }
  strip.style.display = '';

  for (const z of zones) {
    const chip = document.createElement('div');
    chip.className = 'atlas-zone-chip';
    if (z.id === selectedId) chip.classList.add('is-selected');
    chip.setAttribute('data-zone-id', z.id);
    chip.setAttribute('title', `${ELEMENT_LABELS.zone.singular}: ${z.name}`);

    const shapeIcon = z.supertype === 'line' ? 'show_chart' : 'hexagon';
    const color = (z as { atlas_color?: string }).atlas_color ?? '#22d3ee';

    chip.innerHTML = `
      <span class="material-symbols-outlined atlas-zone-chip-shape">${shapeIcon}</span>
      <span class="atlas-zone-chip-dot" style="background:${color}"></span>
      <span class="atlas-zone-chip-name">${escapeHtml(z.name)}</span>
      <button type="button" class="atlas-zone-chip-x" data-action="delete" title="Delete zone">
        <span class="material-symbols-outlined">close</span>
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
    const zoneId = chip.getAttribute('data-zone-id');
    if (!zoneId) return;

    // Delete affordance.
    if (target.closest('[data-action="delete"]')) {
      e.stopPropagation();
      await deleteZoneFromChip(zoneId, toasts);
      return;
    }

    // Plain click → select zone.
    patchSlice('ui', { ...getState().ui, selectedElementId: zoneId });
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
    toasts.success(`zone deleted`);
  } catch (err) {
    console.error('[zone-chip] delete failed:', err);
    toasts.error('failed to delete zone');
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
    const elements = await store.listElements();
    patchSlice('data', { elements });
    requestPushIfLinked();
  } catch (err) {
    console.error('[zone-chip] rename failed:', err);
    toasts.error('failed to rename zone');
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
