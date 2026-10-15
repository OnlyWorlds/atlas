/**
 * The map's date bar (#280): a map whose zones carry dates shows them as of a
 * chosen date. Bottom left of the canvas: the date in the world's calendar, a
 * slider over the zones' dates, Now (the world's now, the default) and All
 * dates. Only drawn while a zone on this map is dated; per map tab and for the
 * session, like the zone panel's eyes. The rule itself is `core/zone-dates.ts`.
 */

import { getState } from '../../core/state';
import { resolveCalendarLens } from '../../core/calendar-lens';
import { formatStep } from '@onlyworlds/sdk';
import { effectiveZoneDate, zoneDateRange, zoneShownAt } from '../../core/zone-dates';
import L from 'leaflet';
import type { MapTabCacheEntry } from './map-tab-cache';
import type { Zone } from '../../core/types';

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

/** A date as the world's calendar says it (the active lens, as the charts and the element page resolve it). */
function dateText(n: number): string {
  const s = getState();
  const worldId = s.active?.worldId;
  const reg = worldId ? s.registry.worlds.find(w => w.id === worldId) : undefined;
  const lens = resolveCalendarLens(s.data.elements, reg?.active_calendar_id, { fallbackToOnly: true });
  return lens && Number.isInteger(n) ? formatStep(lens.config, n) : String(n);
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
    <button type="button" class="atlas-map-datebar-btn" data-action="datebar-now" title="Show the zones as of the world's now">Now</button>
    <button type="button" class="atlas-map-datebar-btn" data-action="datebar-all" title="Show every zone, whatever its dates">All dates</button>
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
    schedule();
  });
  bar.querySelector('[data-action="datebar-now"]')!.addEventListener('click', () => {
    entry.zoneDate = { kind: 'now' };
    resync();
  });
  bar.querySelector('[data-action="datebar-all"]')!.addEventListener('click', () => {
    entry.zoneDate = { kind: 'all' };
    resync();
  });
  // Leaflet must not read a drag on the bar as a pan, a click as a map click,
  // or a right-click or long press as the map's New pin: its own controls'
  // guards (as map-submap-door does; contextmenu is among them).
  L.DomEvent.disableClickPropagation(bar);
  L.DomEvent.disableScrollPropagation(bar);
}

/**
 * Bring the bar up to date with this map's zones (every `syncZones`): hidden
 * when no zone here is dated; else the date, the slider's reach and position,
 * and how many zones the date shows.
 */
export function updateDateBar(entry: MapTabCacheEntry, onThisMap: readonly Zone[], shown: number): void {
  const bar = entry.dateBar;
  const now = worldNow();
  const range = zoneDateRange(onThisMap, now);
  bar.hidden = !range;
  // The zoom control rises above the bar while it shows (atlas.css).
  entry.container.classList.toggle('atlas-map-has-datebar', !!range);
  if (!range) return;

  const date = mapZoneDate(entry);
  const choice = entry.zoneDate.kind;
  const label = bar.querySelector<HTMLElement>('[data-role="datebar-label"]')!;
  label.textContent = date === null ? 'All dates' : dateText(date);
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
  // already counts them, and a long calendar date needs the room.
  label.title = `${label.textContent}: ${shown} of ${onThisMap.length} zones show`;

  const nowBtn = bar.querySelector<HTMLButtonElement>('[data-action="datebar-now"]')!;
  nowBtn.hidden = now === null;
  nowBtn.setAttribute('aria-pressed', String(choice === 'now' && now !== null));
  bar.querySelector<HTMLButtonElement>('[data-action="datebar-all"]')!
    .setAttribute('aria-pressed', String(date === null));
}
