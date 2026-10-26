/**
 * The map's date bar (#280): a map whose zones carry dates shows them as of a
 * chosen date, and since 1.50 its pins by their element's dates (the
 * Titus's Q11). Bottom left of the canvas: the date in the world's
 * calendar, a slider over the dates on this map, Now (the world's now, the
 * default) and All dates. Only drawn while a zone or a pinned element on this
 * map is dated; per map tab and for the session, like the zone panel's eyes.
 * The rule itself is `core/zone-dates.ts`.
 */

import { getState } from '../../core/state';
import { worldDateText } from '../../core/world-date-text';
import { effectiveZoneDate, elementSpan, spanDateRange, spanShownAt, zoneShownAt, zoneSpan } from '../../core/zone-dates';
import { partitionZonesAndMarkers, listZonesOnMap } from './zone-derived';
import L from 'leaflet';
import type { MapTabCacheEntry } from './map-tab-cache';
import type { Element, Pin, Zone } from '../../core/types';

/** The world's now (`World.time_current`), or null when none is set. */
export function worldNow(): number | null {
  const n = getState().active?.meta?.time_current;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** The date zones are filtered by on this map tab; null = every zone shows. */
export function mapZoneDate(entry: MapTabCacheEntry): number | null {
  return effectiveZoneDate(entry.zoneDate, worldNow());
}

/**
 * Whether this map tab shows a zone at its date: the one test the drawing,
 * the zone panel and its rebuild share (conv. 143). The selected zone always
 * shows, so its page's Edit shape and show-on-map never land on nothing.
 */
export function zoneShownOnMap(entry: MapTabCacheEntry, zone: Zone, date = mapZoneDate(entry)): boolean {
  return zone.id === getState().ui.selectedElementId || zoneShownAt(zone, date);
}

/**
 * Whether this map tab shows a pin at its date, by its element's span (a pin
 * carries no dates of its own). A pin whose element is not loaded shows. The
 * selected pin, or the pin of the selected element, always shows, so a show
 * on map or a pin just placed never lands on nothing.
 */
export function pinShownOnMap(entry: MapTabCacheEntry, pin: Pin, el: Element | undefined, date = mapZoneDate(entry)): boolean {
  const selected = getState().ui.selectedElementId;
  if (selected !== null && (pin.id === selected || pin.element_id === selected)) return true;
  if (pin.element_id && revealed.get(entry.mapId)?.has(pin.element_id)) return true;
  return spanShownAt(elementSpan(el), date);
}

/**
 * Elements whose pins the person just asked to see on a map, whatever its
 * date: a pin just placed (New pin, a drop from the sidebar) or located (the
 * sidebar's on-map badge, the element header's pin button). Without this a
 * placed pin said "Pin placed" and drew nothing, and a locate flew to an
 * empty spot. Per map, for the session; moving the
 * date (the slider, Now, All dates) is a new question, so it clears.
 */
const revealed = new Map<string, Set<string>>();

export function revealOnMap(mapId: string, elementId: string): void {
  let set = revealed.get(mapId);
  if (!set) { set = new Set(); revealed.set(mapId, set); }
  set.add(elementId);
}

export function clearRevealed(mapId: string): void {
  revealed.delete(mapId);
}

/** This map's drawable pins with their elements, as `syncPins` reads them. */
export function pinsOnMap(mapId: string, elements: readonly Element[]): Array<{ pin: Pin; el: Element | undefined }> {
  const byId = new Map(elements.map(e => [e.id, e] as const));
  return elements
    .filter((e): e is Pin => e.type === 'pin' && (e as Pin).map_id === mapId)
    .filter(p => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map(pin => ({ pin, el: pin.element_id ? byId.get(pin.element_id) : undefined }));
}

export function buildDateBar(): HTMLDivElement {
  const bar = document.createElement('div');
  bar.className = 'atlas-map-datebar';
  bar.setAttribute('data-role', 'map-datebar');
  bar.hidden = true;
  bar.innerHTML = `
    <span class="material-symbols-outlined atlas-map-datebar-icon" aria-hidden="true">schedule</span>
    <span class="atlas-map-datebar-label" data-role="datebar-label"></span>
    <input type="range" class="atlas-map-datebar-slider" data-role="datebar-slider" step="1" aria-label="Date the map shows">
    <button type="button" class="atlas-map-datebar-btn" data-action="datebar-now" title="Show the map as of the world's now">Now</button>
    <button type="button" class="atlas-map-datebar-btn" data-action="datebar-all" title="Show every zone and pin, whatever its dates">All dates</button>
  `;
  return bar;
}

/** Bind the bar once per map tab; `resync` redraws this tab's zones. */
export function wireDateBar(entry: MapTabCacheEntry, resync: () => void): void {
  const bar = entry.dateBar;
  const slider = bar.querySelector<HTMLInputElement>('[data-role="datebar-slider"]')!;
  // A drag fires many inputs; one redraw per frame.
  let frame = 0;
  const schedule = (): void => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; resync(); });
  };
  slider.addEventListener('input', () => {
    const v = Number(slider.value);
    if (!Number.isFinite(v)) return;
    entry.zoneDate = { kind: 'date', value: v };
    clearRevealed(entry.mapId);
    schedule();
  });
  bar.querySelector('[data-action="datebar-now"]')!.addEventListener('click', () => {
    entry.zoneDate = { kind: 'now' };
    clearRevealed(entry.mapId);
    resync();
  });
  bar.querySelector('[data-action="datebar-all"]')!.addEventListener('click', () => {
    entry.zoneDate = { kind: 'all' };
    clearRevealed(entry.mapId);
    resync();
  });
  // Leaflet must not read a drag on the bar as a pan, a click as a map click,
  // or a right-click or long press as the map's New pin: its own controls'
  // guards (as map-submap-door does; contextmenu is among them).
  L.DomEvent.disableClickPropagation(bar);
  L.DomEvent.disableScrollPropagation(bar);
}

/**
 * Bring the bar up to date with this map's zones and pins (every `syncZones`,
 * which runs beside every `syncPins`, on a map with no zones too): hidden
 * when nothing here is dated; else the date, the slider's reach and
 * position, and how many zones and pins the date shows.
 */
export function updateDateBar(entry: MapTabCacheEntry): void {
  const bar = entry.dateBar;
  const now = worldNow();
  const elements = getState().data.elements;
  const { zones, markers } = partitionZonesAndMarkers(elements);
  const onThisMap = listZonesOnMap(entry.mapId, markers, zones);
  const pins = pinsOnMap(entry.mapId, elements);
  const pinSpans = pins.map(p => elementSpan(p.el));
  const range = spanDateRange([...onThisMap.map(zoneSpan), ...pinSpans], now);
  bar.hidden = !range;
  // The zoom control rises above the bar while it shows (atlas.css).
  entry.container.classList.toggle('atlas-map-has-datebar', !!range);
  if (!range) return;

  const date = mapZoneDate(entry);
  const choice = entry.zoneDate.kind;
  const label = bar.querySelector<HTMLElement>('[data-role="datebar-label"]')!;
  label.textContent = date === null ? 'All dates' : worldDateText(date);
  bar.dataset.choice = date === null ? 'all' : choice;

  const slider = bar.querySelector<HTMLInputElement>('[data-role="datebar-slider"]')!;
  // A chosen date outside the zones' reach still sits on the slider's end.
  const min = Math.min(range.min, date ?? range.min);
  const max = Math.max(range.max, date ?? range.max);
  slider.min = String(min);
  slider.max = String(max);
  // While dragging the browser owns the thumb; only set it from elsewhere.
  if (document.activeElement !== slider || choice !== 'date') {
    slider.value = String(date ?? now ?? max);
  }
  slider.setAttribute('aria-valuetext', label.textContent);
  // How many the date shows rides the label's tooltip: the zones button
  // already counts them, and a long calendar date needs the room. Counted
  // by the date alone, as the drawing decides it (the eyes and chips aside).
  const parts: string[] = [];
  if (onThisMap.length > 0) {
    const shownZones = onThisMap.filter(z => zoneShownOnMap(entry, z, date)).length;
    parts.push(`${shownZones} of ${onThisMap.length} zones`);
  }
  if (pins.some((_, i) => pinSpans[i].start !== null || pinSpans[i].end !== null)) {
    const shownPins = pins.filter(p => pinShownOnMap(entry, p.pin, p.el, date)).length;
    parts.push(`${shownPins} of ${pins.length} pins`);
  }
  label.title = `${label.textContent}: ${parts.join(' and ')} show`;

  const nowBtn = bar.querySelector<HTMLButtonElement>('[data-action="datebar-now"]')!;
  nowBtn.hidden = now === null;
  nowBtn.setAttribute('aria-pressed', String(choice === 'now' && now !== null));
  bar.querySelector<HTMLButtonElement>('[data-action="datebar-all"]')!
    .setAttribute('aria-pressed', String(date === null));
}
