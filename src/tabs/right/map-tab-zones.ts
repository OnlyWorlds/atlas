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
import { mapStyleOf, overPicture, zoneKindOf, PLAIN_ZONE_LAYER, MAP_STYLE_IDS, type MapStylePreset, type InkTreatment } from '../../core/map-ink';
import { renderZonePanel, wireZonePanel } from './map-zone-panel';
import type { Zone, WorldMap } from '../../core/types';
import { pickMapImageSource } from './map-image-source';
import { getActiveStore } from '../../core/active-store';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../../sync/sync-attach';
import type { ToastManager } from '../../ui/toast-manager';
import { showProblem } from '../../ui/problem-fixes';
import { mapZoneDate, updateDateBar, zoneShownOnMap } from './map-date-bar';

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
  // A map drawn from its own zones (S423): the map's style gives each zone
  // whose subtype names a kind that kind's treatment; the rest draw plain.
  // Over a picture the picture is the ground: the zones keep their ink and cover nothing (gate G3).
  const thisMap = state.data.elements.find(e => e.id === entry.mapId) as WorldMap | undefined;
  const style = mapStyleOf(thisMap);
  const preset = style && thisMap && pickMapImageSource(thisMap).kind !== 'flat' ? overPicture(style) : style;

  for (const zone of onThisMap) {
    present.add(zone.id);
    // Points without finite coordinates are skipped, not drawn (S360: one bad
    // marker threw inside Leaflet and the rest of the map's zones vanished).
    const points = markersForZoneOnMap(zone.id, entry.mapId, markers)
      .filter(m => Number.isFinite(m.x) && Number.isFinite(m.y))
      .map(m => ({ x: m.x, y: m.y }));
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

    const ink = preset ? kindTreatment(preset, zone) : undefined;
    entry.zoneOverlay.addZone({
      id: zone.id,
      mode,
      points,
      color: (zone as { atlas_color?: string }).atlas_color ?? style.color,
      opacity,
      labelText,
      labelHoverOnly,
      // On a styled map an area's name is lettering inside it, not a chip under it.
      labelBelow: prefs.zone_label_position === 'below' && !ink,
      weight: style.weight,
      dash: style.dash,
      ink,
    });
  }
  if (preset) entry.zoneOverlay.applyInkOrder(PLAIN_ZONE_LAYER);
  // Back from a style, the zones take their plain order again (gate G4).
  else entry.zoneOverlay.applyPlainOrder(onThisMap.map(z => z.id));
  // The pins read the style from the container (CSS: inked icons, lettered names).
  entry.container.classList.toggle('atlas-map-ink', Boolean(preset));
  // ...and the lettering from the style's own class (S424).
  for (const id of MAP_STYLE_IDS) entry.container.classList.toggle(`atlas-map-style-${id}`, preset?.id === id);

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

  applyZoneVisibility(entry, onThisMap);
}

/**
 * Which zones show: the panel's eyes (kinds hidden, session-only, per map)
 * and the date bar (#280, conv. 143); then the bar, the panel and the label
 * pass. The slider runs only this, so a drag never rebuilds the zones (a
 * rebuild resets every label and the density pass flickered them).
 */
function applyZoneVisibility(entry: MapTabCacheEntry, onThisMap: Zone[]): void {
  if (!entry.zoneOverlay) return;
  const hiddenIds = new Set<string>();
  if (entry.hiddenZoneKinds.size > 0) {
    for (const kind of groupByKind(onThisMap, { byRole: true })) {
      if (entry.hiddenZoneKinds.has(kind.key)) for (const z of kind.members) hiddenIds.add(z.id);
    }
  }
  const date = mapZoneDate(entry);
  for (const zone of onThisMap) {
    entry.zoneOverlay.setZoneVisible(zone.id, zoneShownOnMap(entry, zone, date) && !hiddenIds.has(zone.id));
  }
  updateDateBar(entry);
  renderZonePanel(entry, onThisMap, getState().ui.selectedElementId);
  scheduleLabelDensity(entry);
}

/** The date bar moved (#280): visibility only, the zones stay as built. */
export function refreshZoneDates(entry: MapTabCacheEntry): void {
  const { zones, markers } = partitionZonesAndMarkers(getState().data.elements);
  applyZoneVisibility(entry, listZonesOnMap(entry.mapId, markers, zones));
}

function kindTreatment(preset: MapStylePreset, zone: Zone): InkTreatment | undefined {
  const kind = zoneKindOf(zone.subtype);
  return kind ? preset.kinds[kind] : undefined;
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
    // No retry (S369 gate B L1): an older colour would overwrite a newer one.
    showProblem(err, {
      doing: 'writing the colour into the zones',
      toasts,
    });
  }
}

async function deleteZoneFromChip(zoneId: string, toasts: ToastManager): Promise<void> {
  const store = getActiveStore();
  if (!store) return;
  const zone = getState().data.elements.find(e => e.id === zoneId);
  if (!zone) return;
  // Confirm via the standard delete pattern. Cascade tombstones markers.
  // A failed count must not throw away the delete (it used to reject unseen).
  let markerCount: number | null = null;
  try { markerCount = (await store.findDependents(zoneId)).length; }
  catch (err) { console.warn('[zone-chip] dependents probe failed:', err); }
  const ok = window.confirm(markerCount === null
    ? `Delete zone "${zone.name}"? This also removes its markers. This cannot be undone.`
    : `Delete zone "${zone.name}"? This also removes ${markerCount} marker(s). This cannot be undone.`);
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
    showProblem(err, { doing: 'deleting the zone', toasts });
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
    showProblem(err, { doing: 'renaming the zone', toasts });
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

