/**
 * Pin sync + filter chip strip for the map-tab subsystem.
 *
 * Extracted from map-tab.ts. `syncPins(entry)` reconciles the manager's
 * markers against `state.data.elements`. `refreshChipStrip` renders the
 * top-left category-filter chip strip (one chip per distinct element_type
 * present in this map's pins). `refreshActiveMapPins` is the public entry
 * point map-tab.ts's subscriber calls.
 */

import type { Element, Pin } from '../../core/types';
import { getState } from '../../core/state';
import { ELEMENT_ICONS } from '../../core/constants';
import { typeName } from '../../core/type-words';
import { pinVisualFor } from './pin-visuals';
import { hasLinkedSubMap } from './auto-open-map';
import { enablePinDrag } from './map-tab-pin-drag';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import type { PinLabels } from '../../core/map-view-prefs';
import { medianNearestNeighbour, pinScaleForSpacing, scheduleLabelDensity } from './map-label-density';
import { refreshSubmapDoor, refreshUpButton, SUBMAP_PIN_HINT } from './map-submap-door';
import { mapZoneDate, pinShownOnMap, revealOnMap } from './map-date-bar';
// view-only-ok: its updatePin calls are the Leaflet manager's, a redraw, not a store write (conv. 149).

export function syncPins(entry: MapTabCacheEntry): void {
  const elements = getState().data.elements;
  const allMinePins = elements.filter((e): e is Pin =>
    e.type === 'pin' && e.map_id === entry.mapId
  );
  // Pin filter chip strip (DESIGN_MAPS.md §3 polish):
  // pins whose element_type is in hiddenPinTypes are treated as removed —
  // syncPins removes their markers from the manager. Toggling a chip on the
  // strip is a syncPins re-call, so add/remove flips naturally.
  // A pin without finite x/y is schema-legal (only `name` is required) but
  // cannot be drawn; Leaflet throws on it and every later pin went missing.
  // Skip it here, as pin-locate and the share payload already do.
  // The date bar (1.50) is applied after, as visibility only
  // (`applyPinDates`): a marker the date hides stays built, so a slider drag
  // never re-creates icons and labels.
  const byId = new Map(elements.map(e => [e.id, e] as const));
  const minePins = allMinePins.filter(p =>
    !entry.hiddenPinTypes.has(p.element_type ?? '') && Number.isFinite(p.x) && Number.isFinite(p.y));
  const mineIds = new Set(minePins.map(p => p.id));

  // Read per-map visual prefs once. Pins inherit the active map's tint setting
  // so all pins on a single map look coherent; switching tint via the visual
  // settings popover triggers a syncPins re-call → all pins re-skin live.
  const prefs = getEffectiveMapPrefs(entry.mapId);

  for (const existing of entry.manager.getAllPins()) {
    if (!mineIds.has(existing.id)) entry.manager.removePin(existing.id);
  }

  for (const pin of minePins) {
    const el = pin.element_id ? byId.get(pin.element_id) : undefined;
    const existing = entry.manager.getPin(pin.id);

    if (existing) {
      // Update only the fields whose source data is reliable. Element lookup
      // can briefly fail during sync transitions (an in-flight id-swap on a
      // referenced element races the pin's element_id update). Overwriting
      // the label to '(element)' in that window produces a visible flicker
      // on reload. Keep the prior label and icon when lookup misses; the
      // next subscriber tick after sync settles will re-resolve cleanly.
      if (el) {
        const hasMapBadge = hasLinkedSubMap(el.id, elements);
        const visual = pinVisualFor(el.type, hasMapBadge, prefs.pin_tint, prefs.pin_style);
        // pin-shape's visible tip should align with the latlng (bottom-tip
        // anchor); icon + round-icon are symmetric and stay centered.
        const anchor: 'center' | 'bottom-tip' = prefs.pin_style === 'pin-shape' ? 'bottom-tip' : 'center';
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y, name: el.name, icon: visual.iconUrl, anchor, hint: hasMapBadge ? SUBMAP_PIN_HINT : '' });
      } else {
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y });
      }
    } else {
      // New marker — fall back to a friendlier placeholder while element
      // data is still resolving (vs the raw '(element)' string).
      const name = el?.name ?? '(loading…)';
      const type = el?.type ?? 'object';
      const hasMapBadge = el ? hasLinkedSubMap(el.id, elements) : false;
      const visual = pinVisualFor(type, hasMapBadge, prefs.pin_tint, prefs.pin_style);
      const anchor: 'center' | 'bottom-tip' = prefs.pin_style === 'pin-shape' ? 'bottom-tip' : 'center';
      const added = entry.manager.addPin({
        id: pin.id,
        name,
        type,
        x: pin.x,
        y: pin.y,
        icon: visual.iconUrl,
        scale: 1,
        anchor,
        ...(hasMapBadge ? { hint: SUBMAP_PIN_HINT } : {}),
      });
      enablePinDrag(entry, added.marker, pin.id);
    }
  }

  // The icon-scale rule: median nearest-neighbour gap of THIS pin
  // set in storage units, computed once per sync; applyPinScale turns it
  // into a per-zoom scale. Sparse maps measure a gap wider than the icon
  // and keep scale 1 — the rule only ever shrinks. Measured over every pin
  // the chips show, whatever the date, so scrubbing never resizes the icons.
  entry.pinSpacing = medianNearestNeighbour(minePins.map(p => ({ x: p.x, y: p.y })));
  applyPinScale(entry);

  applyPinDates(entry, allMinePins, minePins, byId, prefs);
}

/**
 * Show an element's pins on a map whatever its date, because the person just
 * placed or located one there (`revealOnMap`), and apply it now if the tab is
 * built; a sync that follows a write applies it anyway.
 */
export function revealPinsOnMap(mapId: string, elementId: string): void {
  revealOnMap(mapId, elementId);
  const entry = mapTabCache.get(mapId);
  if (entry) void entry.ready.then(() => refreshPinDates(entry));
}

/**
 * The date bar moved: which built pins show, visibility only, then the
 * chips, labels and the submap door that read what shows.
 */
export function refreshPinDates(entry: MapTabCacheEntry): void {
  const elements = getState().data.elements;
  const allMinePins = elements.filter((e): e is Pin => e.type === 'pin' && e.map_id === entry.mapId);
  const minePins = allMinePins.filter(p =>
    !entry.hiddenPinTypes.has(p.element_type ?? '') && Number.isFinite(p.x) && Number.isFinite(p.y));
  applyPinDates(entry, allMinePins, minePins, new Map(elements.map(e => [e.id, e] as const)), getEffectiveMapPrefs(entry.mapId));
}

function applyPinDates(
  entry: MapTabCacheEntry,
  allMinePins: Pin[],
  minePins: Pin[],
  byId: Map<string, Element>,
  prefs: ReturnType<typeof getEffectiveMapPrefs>,
): void {
  const date = mapZoneDate(entry);
  const shownAt = (p: Pin) => pinShownOnMap(entry, p, p.element_id ? byId.get(p.element_id) : undefined, date);
  const visible = minePins.filter(shownAt);
  entry.manager.setPinVisibility(visible.map(p => p.id));

  // Refresh the chip strip on every sync — type set may have changed if a
  // pin was added/removed/element type changed. Its chips come from every pin
  // here and count the ones the date shows, so a type's chip never comes and
  // goes with the date (the zone panel's lesson).
  refreshChipStrip(entry, allMinePins, allMinePins.filter(shownAt));

  // Apply label visibility AFTER the pin set is reconciled so we count the
  // post-sync set (relevant for threshold mode).
  applyLabelVisibility(entry, prefs.pin_labels, prefs.pin_label_threshold, visible.length);
  scheduleLabelDensity(entry);
  // Into a submap and back up (#139): both read the pins and the selection
  // just reconciled.
  refreshSubmapDoor(entry);
  refreshUpButton(entry);
}

/**
 * Re-skin every pin to the scale the current zoom warrants. Runs after each
 * sync and on zoomend (map-tab wires it). A no-op unless the rounded scale
 * changed, so panning never touches a marker.
 */
export function applyPinScale(entry: MapTabCacheEntry): void {
  const lMap = entry.manager.getMap();
  if (!lMap) return;
  const spacing = entry.pinSpacing ?? Infinity;
  // CRS.Simple: one storage unit is 2^zoom screen pixels.
  const spacingPx = spacing * Math.pow(2, lMap.getZoom());
  const scale = pinScaleForSpacing(spacingPx, entry.manager.getDefaultIconSize());
  if (entry.pinScale === scale) return;
  entry.pinScale = scale;
  for (const p of entry.manager.getAllPins()) {
    entry.manager.updatePin(p.id, { scale });
  }
}

/**
 * Toggle per-pin label visibility per the active prefs mode.
 *
 *  - 'auto':      every label visible here, then collision-culled.
 *  - 'always':    every label visible (Leaflet default).
 *  - 'hover':     all permanent labels hidden — atlas's custom .atlas-pin-tooltip
 *                 already covers hover-time naming, so this collapses to "off"
 *                 for the static label layer.
 *  - 'threshold': visible iff total pins on this map (after type filter) ≤ N.
 *  - 'never':     all labels hidden.
 *
 * Implementation reads each pin's `.label` Leaflet marker (created by
 * Leaflet2DManager.addPin when showLabels is true) and toggles its DOM-level
 * `display`. Cheaper than add/remove on the layer — survives pin updates.
 */
function applyLabelVisibility(
  entry: MapTabCacheEntry,
  mode: PinLabels,
  threshold: number,
  visiblePinCount: number,
): void {
  let show: boolean;
  // 'auto' shows everything here; the density pass that runs right after
  // culls the collisions by class (map-label-density.ts).
  if (mode === 'always' || mode === 'auto') show = true;
  else if (mode === 'never') show = false;
  else if (mode === 'hover') show = false; // hover handled by custom tooltip
  else if (mode === 'threshold') show = visiblePinCount <= threshold;
  else show = true;

  for (const p of entry.manager.getAllPins()) {
    const el = p.label?.getElement();
    if (!el) continue;
    (el as HTMLElement).style.display = show ? '' : 'none';
  }
}

/**
 * Re-render the pin-filter chip strip from the current pin set. One chip per
 * distinct element_type, in the order of the words the world prints. Each chip shows
 * the category icon + count. Active = type is visible (default); muted +
 * `data-hidden="true"` = type is hidden. Click toggles `hiddenPinTypes` and
 * re-syncs pins.
 *
 * Hidden when 0 distinct types (nothing to filter) or 1 type (toggling all
 * off would empty the map — not useful as a chip strip).
 */
function refreshChipStrip(entry: MapTabCacheEntry, allMinePins: Pin[], atDate: Pin[]): void {
  const elements = getState().data.elements;
  const countByType = new Map<string, number>();
  const shownIds = new Set(atDate.map(p => p.id));
  for (const pin of allMinePins) {
    let type = pin.element_type;
    if (!type) {
      // Defensive: legacy pins missing element_type — resolve from the
      // referenced element. The engine self-heal writes it back on push,
      // but the local cache may not reflect that until next refresh.
      const el = elements.find(e => e.id === pin.element_id);
      type = el?.type ?? '';
    }
    if (!type) continue;
    countByType.set(type, (countByType.get(type) ?? 0) + (shownIds.has(pin.id) ? 1 : 0));
  }

  if (countByType.size < 2) {
    entry.chipStrip.innerHTML = '';
    entry.chipStrip.setAttribute('data-active', 'false');
    return;
  }

  entry.chipStrip.setAttribute('data-active', 'true');
  entry.chipStrip.innerHTML = '';
  const types = [...countByType.keys()].sort((a, b) => {
    const aL = typeName(a);
    const bL = typeName(b);
    return aL.localeCompare(bL);
  });
  for (const type of types) {
    const count = countByType.get(type)!;
    const hidden = entry.hiddenPinTypes.has(type);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'atlas-pin-filter-chip';
    chip.setAttribute('data-type', type);
    chip.setAttribute('data-hidden', String(hidden));
    const label = typeName(type, { many: count !== 1 });
    chip.title = hidden
      ? `${count} ${label} hidden · click to show`
      : `${count} ${label} shown · click to hide`;
    const iconName = ELEMENT_ICONS[type as keyof typeof ELEMENT_ICONS] ?? 'category';
    chip.innerHTML = `<span class="material-symbols-outlined">${iconName}</span><span class="atlas-pin-filter-chip-count">${count}</span>`;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (entry.hiddenPinTypes.has(type)) entry.hiddenPinTypes.delete(type);
      else entry.hiddenPinTypes.add(type);
      syncPins(entry);
    });
    entry.chipStrip.appendChild(chip);
  }
}

/** Re-sync pins for whichever map is currently visible. */
export function refreshActiveMapPins(): void {
  const ui = getState().ui;
  const active = ui.rightTabs[ui.rightActiveIndex];
  if (!active || active.kind !== 'map') return;
  const entry = mapTabCache.get(active.mapId);
  if (!entry) return;
  entry.ready.then(() => syncPins(entry));
}
