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
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import {
  listZonesOnMap,
  markersForZoneOnMap,
  partitionZonesAndMarkers,
  getZoneShape,
} from './zone-derived';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { scheduleLabelDensity } from './map-label-density';
import { resolveStyle, groupByKind } from '../../core/world-styles';
import { renderZonePanel, wireZonePanel } from './map-zone-panel';
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
  const rules = state.styles.rules;
  // Kind → hidden, from the zone panel's eyes (session-only, per map).
  const hiddenIds = new Set<string>();
  if (entry.hiddenZoneKinds.size > 0) {
    for (const kind of groupByKind(onThisMap)) {
      if (entry.hiddenZoneKinds.has(kind.key)) for (const z of kind.members) hiddenIds.add(z.id);
    }
  }

  for (const zone of onThisMap) {
    present.add(zone.id);
    const points = markersForZoneOnMap(zone.id, entry.mapId, markers).map(m => ({
      x: m.x,
      y: m.y,
    }));
    const mode = getZoneShape(zone);
    // World style rules (S356): the zone's own atlas_* field wins, then the
    // kind's rule, then the map default.
    const style = resolveStyle(rules, zone);
    const opacity = zoneEffectiveOpacity(zone, style.fill_opacity ?? prefs.zone_fill_opacity);
    // Label policy:
    //   - 'always' → labelText = zone.name, hover-only = false (always shown)
    //   - 'hover'  → labelText = zone.name, hover-only = true  (fade on hover)
    //   - 'never'  → labelText = undefined (no marker built)
    //   - 'auto'   → labelText = zone.name, hover-only = false; the density
    //                pass right after culls collisions by class (S356)
    const labelMode = prefs.zone_labels;
    const labelText = labelMode === 'never' ? undefined : zone.name;
    const labelHoverOnly = labelMode === 'hover';

    entry.zoneOverlay.addZone({
      id: zone.id,
      mode,
      points,
      color: (zone as { atlas_color?: string }).atlas_color ?? style.color,
      opacity,
      labelText,
      labelHoverOnly,
      labelBelow: prefs.zone_label_position === 'below',
      weight: style.weight,
      dash: style.dash,
    });
    entry.zoneOverlay.setZoneVisible(zone.id, !hiddenIds.has(zone.id));
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

  renderZonePanel(entry, onThisMap, selectedId);
  scheduleLabelDensity(entry);
}

function zoneEffectiveOpacity(zone: Zone, mapDefault: number): number {
  const explicit = (zone as { atlas_opacity?: number }).atlas_opacity;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;
  return mapDefault;
}

// computeLabelText replaced inline (session 219) — label policy now sets both
// labelText AND labelHoverOnly on the ZoneShape so ZoneOverlay can wire fade
// behavior. Kept the export-shape pattern for any external callers.
export function computeLabelText(zone: Zone, mode: 'auto' | 'always' | 'hover' | 'never'): string | undefined {
  return mode === 'never' ? undefined : zone.name;
}

/**
 * Bind the zone panel's handlers once per map tab (mountMapTab). The panel
 * itself lives in map-zone-panel.ts; this module supplies the store-touching
 * verbs (delete, rename via context menu, write a kind's colour into zones).
 */
export function wireChipStrip(entry: MapTabCacheEntry, toasts: ToastManager): void {
  wireZonePanel(entry, {
    onDelete: (zoneId) => { void deleteZoneFromChip(zoneId, toasts); },
    onContext: (zoneId, x, y) => showChipContextMenu(zoneId, x, y, toasts),
    onApplyToZones: (zones, color) => { void applyColorToZones(zones, color, toasts); },
  });
}

/**
 * Materialise a kind's rule colour into each zone's own `atlas_color`, so a
 * tool that reads the wire (the field rides v2) sees the colour without
 * knowing about `.atlas/styles.json`. Each write goes through the store's
 * per-id chain; one refresh at the end.
 */
async function applyColorToZones(zones: Zone[], color: string, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  if (!store || zones.length === 0) return;
  try {
    for (const z of zones) await store.updateZone(z.id, { atlas_color: color } as Partial<Zone>);
    await refreshElementsAfterWrite(store);
    toasts.success(`Colour written into ${zones.length} zone${zones.length === 1 ? '' : 's'}`);
  } catch (err) {
    console.error('[zone-panel] apply colour failed:', err);
    toasts.error('Could not write the colour into every zone');
  }
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

