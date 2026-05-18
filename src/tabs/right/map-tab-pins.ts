/**
 * Pin sync + filter chip strip for the map-tab subsystem.
 *
 * Extracted from map-tab.ts. `syncPins(entry)` reconciles the manager's
 * markers against `state.data.elements`. `refreshChipStrip` renders the
 * top-left category-filter chip strip (one chip per distinct element_type
 * present in this map's pins). `refreshActiveMapPins` is the public entry
 * point map-tab.ts's subscriber calls.
 */

import type { Pin } from '../../core/types';
import { getState } from '../../core/state';
import { ELEMENT_ICONS, ELEMENT_LABELS } from '../../core/constants';
import { pinVisualFor } from './pin-visuals';
import { hasLinkedSubMap } from './auto-open-map';
import { enablePinDrag } from './map-tab-pin-drag';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import type { PinLabels } from '../../core/map-view-prefs';

export function syncPins(entry: MapTabCacheEntry): void {
  const elements = getState().data.elements;
  const allMinePins = elements.filter((e): e is Pin =>
    e.type === 'pin' && e.map_id === entry.mapId
  );
  // Pin filter chip strip (DESIGN_MAPS.md §3 polish, session 211 bout PF):
  // pins whose element_type is in hiddenPinTypes are treated as removed —
  // syncPins removes their markers from the manager. Toggling a chip on the
  // strip is a syncPins re-call, so add/remove flips naturally.
  const minePins = allMinePins.filter(p => !entry.hiddenPinTypes.has(p.element_type ?? ''));
  const mineIds = new Set(minePins.map(p => p.id));

  // Refresh the chip strip on every sync — type set may have changed if a
  // pin was added/removed/element type changed.
  refreshChipStrip(entry, allMinePins);

  // Read per-map visual prefs once. Pins inherit the active map's tint setting
  // so all pins on a single map look coherent; switching tint via the visual
  // settings popover triggers a syncPins re-call → all pins re-skin live.
  const prefs = getEffectiveMapPrefs(entry.mapId);

  for (const existing of entry.manager.getAllPins()) {
    if (!mineIds.has(existing.id)) entry.manager.removePin(existing.id);
  }

  for (const pin of minePins) {
    const el = elements.find(e => e.id === pin.element_id);
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
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y, name: el.name, icon: visual.iconUrl, anchor });
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
      });
      enablePinDrag(entry, added.marker, pin.id);
    }
  }

  // Apply label visibility AFTER the pin set is reconciled so we count the
  // post-sync set (relevant for threshold mode).
  applyLabelVisibility(entry, prefs.pin_labels, prefs.pin_label_threshold, minePins.length);
}

/**
 * Toggle per-pin label visibility per the active prefs mode.
 *
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
  if (mode === 'always') show = true;
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
 * distinct element_type, in canonical ELEMENT_LABELS order. Each chip shows
 * the category icon + count. Active = type is visible (default); muted +
 * `data-hidden="true"` = type is hidden. Click toggles `hiddenPinTypes` and
 * re-syncs pins.
 *
 * Hidden when 0 distinct types (nothing to filter) or 1 type (toggling all
 * off would empty the map — not useful as a chip strip).
 */
function refreshChipStrip(entry: MapTabCacheEntry, allMinePins: Pin[]): void {
  const elements = getState().data.elements;
  const countByType = new Map<string, number>();
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
    countByType.set(type, (countByType.get(type) ?? 0) + 1);
  }

  if (countByType.size < 2) {
    entry.chipStrip.innerHTML = '';
    entry.chipStrip.setAttribute('data-active', 'false');
    return;
  }

  entry.chipStrip.setAttribute('data-active', 'true');
  entry.chipStrip.innerHTML = '';
  const types = [...countByType.keys()].sort((a, b) => {
    const aL = ELEMENT_LABELS[a as keyof typeof ELEMENT_LABELS]?.singular ?? a;
    const bL = ELEMENT_LABELS[b as keyof typeof ELEMENT_LABELS]?.singular ?? b;
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
    const label = ELEMENT_LABELS[type as keyof typeof ELEMENT_LABELS]?.singular ?? type;
    chip.title = hidden
      ? `${count} ${label}${count === 1 ? '' : 's'} hidden — click to show`
      : `${count} ${label}${count === 1 ? '' : 's'} shown — click to hide`;
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
