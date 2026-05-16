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
import { getAssociatedMaps } from './auto-open-map';
import { enablePinDrag } from './map-tab-pin-drag';
import { mapTabCache, type MapTabCacheEntry } from './map-tab-cache';

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
        const hasMapBadge = getAssociatedMaps(el.id, elements).length > 0;
        const visual = pinVisualFor(el.type, hasMapBadge);
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y, name: el.name, icon: visual.iconUrl });
      } else {
        entry.manager.updatePin(pin.id, { x: pin.x, y: pin.y });
      }
    } else {
      // New marker — fall back to a friendlier placeholder while element
      // data is still resolving (vs the raw '(element)' string).
      const name = el?.name ?? '(loading…)';
      const type = el?.type ?? 'object';
      const hasMapBadge = el ? getAssociatedMaps(el.id, elements).length > 0 : false;
      const visual = pinVisualFor(type, hasMapBadge);
      const added = entry.manager.addPin({
        id: pin.id,
        name,
        type,
        x: pin.x,
        y: pin.y,
        icon: visual.iconUrl,
        scale: 1,
      });
      enablePinDrag(entry, added.marker, pin.id);
    }
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
