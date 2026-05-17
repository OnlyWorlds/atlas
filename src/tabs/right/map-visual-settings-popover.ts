/**
 * Map visual settings popover (DESIGN_MAPS.md §11).
 *
 * Left-anchored floating panel over the canvas. Reads + writes map_view_prefs
 * for the current map. Changes apply live where consumers exist:
 *   - grid (show/hide + spacing) — wired here via Leaflet2DManager
 *   - pin drag lock — wired here via Leaflet marker.dragging
 *
 * Pin-style / pin-labels / pin-tint / zone visual fields are persisted but
 * their consumers are deferred to follow-up bouts (V1.5 / V3). Prefs are
 * stored regardless so the popover UX feels real today.
 */

import {
  FACTORY_DEFAULTS,
  getAtlasDefaults,
  getEffectiveMapPrefs,
  getMapOverride,
  resetMapOverride,
  saveMapPrefsAsDefault,
  setAtlasDefaults,
  setMapOverride,
  type MapViewPrefs,
  type PinStyle,
  type PinLabels,
  type PinTint,
  type ZoneLabels,
  type GridSpacing,
} from '../../core/map-view-prefs';
import type { MapTabCacheEntry } from './map-tab-cache';
import { syncPins } from './map-tab-pins';
import { syncZones } from './map-tab-zones';

let openPopover: { wrapper: HTMLDivElement; entry: MapTabCacheEntry } | null = null;

/**
 * Toggle the popover. If already open for this map, close it. Otherwise
 * close any existing popover and open one for `entry`.
 */
export function toggleVisualSettingsPopover(entry: MapTabCacheEntry, anchor: HTMLElement): void {
  if (openPopover && openPopover.entry.mapId === entry.mapId) {
    closeVisualSettingsPopover();
    return;
  }
  closeVisualSettingsPopover();
  openVisualSettingsPopover(entry, anchor);
}

export function closeVisualSettingsPopover(): void {
  if (!openPopover) return;
  const w = openPopover.wrapper as HTMLElement & { __atlasCleanupReposition?: () => void };
  w.__atlasCleanupReposition?.();
  if (w.parentElement) w.parentElement.removeChild(w);
  document.removeEventListener('keydown', escListener);
  document.removeEventListener('mousedown', outsideClickListener);
  openPopover = null;
}

function escListener(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeVisualSettingsPopover();
}

function outsideClickListener(e: MouseEvent): void {
  if (!openPopover) return;
  const target = e.target as Node | null;
  if (!target) return;
  if (openPopover.wrapper.contains(target)) return;
  // Outside the popover. Don't close if the click is on the originating
  // toolbar button — let its toggle handler decide.
  const onButton = (target as HTMLElement).closest?.('[data-action="map-visual-settings"]');
  if (onButton) return;
  closeVisualSettingsPopover();
}

function openVisualSettingsPopover(entry: MapTabCacheEntry, _anchor: HTMLElement): void {
  const mapId = entry.mapId;

  const wrapper = document.createElement('div');
  wrapper.className = 'atlas-map-visual-settings-popover atlas-map-visual-settings-popover-midpanel';
  wrapper.setAttribute('role', 'dialog');
  wrapper.setAttribute('aria-label', 'Map visual settings');

  const render = () => {
    const prefs = getEffectiveMapPrefs(mapId);
    wrapper.innerHTML = template(prefs, !!getMapOverride(mapId));
    wireControls(wrapper, entry, render);
  };

  render();

  // Dock at the RIGHT edge of the midpanel (Captain session 219). The popover
  // lives at document.body level with position: fixed, with coords computed
  // from the midpanel's bounding rect each frame. The map (in the right pane)
  // stays unobstructed; the panel takes a vertical slice of the middle pane
  // adjacent to the divider. Falls back to floating-over-canvas if the
  // midpanel isn't present (defensive — should always exist when a map is open).
  document.body.appendChild(wrapper);
  const reposition = () => repositionAgainstMidpanel(wrapper);
  reposition();
  window.addEventListener('resize', reposition);
  // ResizeObserver tracks midpanel size changes (divider drag, sidebar mode
  // toggle, etc.) — cheaper than a global mousemove listener and fires on
  // every actual size change rather than every cursor pixel.
  const middle = document.querySelector('.atlas-middle');
  const ro = middle ? new ResizeObserver(() => reposition()) : null;
  if (middle && ro) ro.observe(middle);
  // Store cleanup hook on the wrapper for closeVisualSettingsPopover.
  (wrapper as HTMLElement & { __atlasCleanupReposition?: () => void }).__atlasCleanupReposition = () => {
    window.removeEventListener('resize', reposition);
    ro?.disconnect();
  };

  openPopover = { wrapper, entry };

  // Defer registration until next tick so the originating click doesn't
  // immediately bubble up and close us.
  setTimeout(() => {
    document.addEventListener('keydown', escListener);
    document.addEventListener('mousedown', outsideClickListener);
  }, 0);

  // Apply current prefs to live consumers (in case they were stale from a
  // prior session).
  applyLivePrefs(entry, getEffectiveMapPrefs(mapId));
}

/**
 * Compute and apply position: fixed coords so the popover sits docked to
 * the right edge of the `.atlas-middle` pane. If midpanel isn't present
 * (e.g. some pane disposed), the popover is left at its CSS-default for
 * fallback floating.
 */
function repositionAgainstMidpanel(wrapper: HTMLElement): void {
  const middle = document.querySelector('.atlas-middle');
  if (!middle) return;
  const rect = (middle as HTMLElement).getBoundingClientRect();
  // Take a slim ~340px vertical slice on the RIGHT edge of midpanel. We
  // overlay middle content (element-detail), not the map.
  const width = Math.min(340, Math.max(260, rect.width - 40));
  wrapper.style.position = 'fixed';
  wrapper.style.left = `${Math.round(rect.right - width - 8)}px`;
  wrapper.style.top = `${Math.round(rect.top + 8)}px`;
  wrapper.style.width = `${width}px`;
  wrapper.style.maxHeight = `${Math.round(rect.height - 16)}px`;
}

function template(prefs: MapViewPrefs, hasOverride: boolean): string {
  return `
    <div class="atlas-popover-header">
      <span class="material-symbols-outlined">tune</span>
      <span class="atlas-popover-title">Map visual settings</span>
    </div>

    <div class="atlas-popover-body">
      <section class="atlas-popover-section">
        <label class="atlas-popover-section-label">Pin style</label>
        <div class="atlas-popover-radio-row" data-field="pin_style">
          ${radio('pin_style', 'icon',       'Icon',          prefs.pin_style)}
          ${radio('pin_style', 'round-icon', 'Round + icon',  prefs.pin_style)}
          ${radio('pin_style', 'pin-shape',  'Pin shape',     prefs.pin_style)}
        </div>
      </section>

      <section class="atlas-popover-section">
        <label class="atlas-popover-section-label">Pin labels</label>
        <div class="atlas-popover-radio-row" data-field="pin_labels">
          ${radio('pin_labels', 'always',    'Always',        prefs.pin_labels)}
          ${radio('pin_labels', 'hover',     'On hover',      prefs.pin_labels)}
          ${radio('pin_labels', 'threshold', `≤ N visible`,   prefs.pin_labels)}
          ${radio('pin_labels', 'never',     'Never',         prefs.pin_labels)}
        </div>
        <div class="atlas-popover-inline-num ${prefs.pin_labels === 'threshold' ? '' : 'is-muted'}">
          Threshold:
          <input type="number" min="1" max="999" value="${prefs.pin_label_threshold}" data-field="pin_label_threshold" />
        </div>
      </section>

      <section class="atlas-popover-section">
        <label class="atlas-popover-section-label">Pin tint</label>
        <div class="atlas-popover-radio-row" data-field="pin_tint">
          ${radio('pin_tint', 'type-color', 'Type color',    prefs.pin_tint)}
          ${radio('pin_tint', 'accent',     'Accent',        prefs.pin_tint)}
          ${radio('pin_tint', 'muted',      'Muted',         prefs.pin_tint)}
        </div>
      </section>

      <section class="atlas-popover-section">
        <label class="atlas-popover-toggle-row">
          <input type="checkbox" data-field="show_grid" ${prefs.show_grid ? 'checked' : ''} />
          <span>Show grid</span>
        </label>
        <div class="atlas-popover-radio-row ${prefs.show_grid ? '' : 'is-muted'}" data-field="grid_spacing">
          Spacing
          ${radio('grid_spacing', '20',  '20',  String(prefs.grid_spacing))}
          ${radio('grid_spacing', '50',  '50',  String(prefs.grid_spacing))}
          ${radio('grid_spacing', '100', '100', String(prefs.grid_spacing))}
          ${radio('grid_spacing', '200', '200', String(prefs.grid_spacing))}
          <span class="atlas-popover-radio-trailing">px</span>
        </div>
        <div class="atlas-popover-inline-num ${prefs.show_grid ? '' : 'is-muted'}">
          Custom:
          <input type="number" min="2" max="2000" step="1" value="${prefs.grid_spacing}" data-field="grid_spacing_custom" />
          <span class="atlas-popover-radio-trailing">px</span>
        </div>
      </section>

      <section class="atlas-popover-section">
        <label class="atlas-popover-toggle-row">
          <input type="checkbox" data-field="lock_pin_drag" ${prefs.lock_pin_drag ? 'checked' : ''} />
          <span>Lock pin dragging</span>
        </label>
      </section>

      <section class="atlas-popover-section">
        <div class="atlas-popover-section-divider">Zones</div>
        <label class="atlas-popover-section-label">Zone fill opacity <span class="atlas-popover-slider-val">${Math.round(prefs.zone_fill_opacity * 100)}%</span></label>
        <input type="range" min="0" max="100" value="${Math.round(prefs.zone_fill_opacity * 100)}" data-field="zone_fill_opacity" class="atlas-popover-slider" />

        <label class="atlas-popover-section-label">Zone labels</label>
        <div class="atlas-popover-radio-row" data-field="zone_labels">
          ${radio('zone_labels', 'always', 'Always',     prefs.zone_labels)}
          ${radio('zone_labels', 'hover',  'On hover',   prefs.zone_labels)}
          ${radio('zone_labels', 'never',  'Never',      prefs.zone_labels)}
        </div>
      </section>
    </div>

    <div class="atlas-popover-footer">
      <button type="button" class="atlas-btn-ghost" data-action="save-as-default">Save as default</button>
      <button type="button" class="atlas-btn-ghost" data-action="reset-this-map" ${hasOverride ? '' : 'disabled'}>Reset this map</button>
    </div>
  `;
}

function radio(field: string, value: string, label: string, current: string): string {
  const checked = current === value;
  return `
    <label class="atlas-popover-radio ${checked ? 'is-active' : ''}">
      <input type="radio" name="${field}" value="${value}" ${checked ? 'checked' : ''} />
      <span>${label}</span>
    </label>
  `;
}

function wireControls(wrapper: HTMLDivElement, entry: MapTabCacheEntry, rerender: () => void): void {
  const mapId = entry.mapId;
  const apply = (patch: Partial<MapViewPrefs>) => {
    setMapOverride(mapId, patch);
    applyLivePrefs(entry, getEffectiveMapPrefs(mapId));
    // Re-render so disabled/active states update.
    rerender();
  };

  // Radio groups
  wrapper.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach(input => {
    input.addEventListener('change', () => {
      if (!input.checked) return;
      const field = input.name;
      const value = input.value;
      const patch: Partial<MapViewPrefs> = {};
      if (field === 'pin_style') patch.pin_style = value as PinStyle;
      else if (field === 'pin_labels') patch.pin_labels = value as PinLabels;
      else if (field === 'pin_tint') patch.pin_tint = value as PinTint;
      else if (field === 'zone_labels') patch.zone_labels = value as ZoneLabels;
      else if (field === 'grid_spacing') patch.grid_spacing = Number(value) as GridSpacing;
      apply(patch);
    });
  });

  // Checkboxes
  wrapper.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => {
    input.addEventListener('change', () => {
      const field = input.getAttribute('data-field');
      if (field === 'show_grid') apply({ show_grid: input.checked });
      else if (field === 'lock_pin_drag') apply({ lock_pin_drag: input.checked });
    });
  });

  // Number inputs (pin_label_threshold + custom grid spacing)
  wrapper.querySelectorAll<HTMLInputElement>('input[type="number"]').forEach(input => {
    // Custom grid spacing updates LIVE on each keystroke (input event) so the
    // grid redraws as the user types — same UX as the opacity slider. We also
    // listen on 'change' (blur/Enter) to re-render the popover so radio
    // chip-selection state reflects whether the value matches a preset.
    if (input.getAttribute('data-field') === 'grid_spacing_custom') {
      input.addEventListener('input', () => {
        const value = Number(input.value);
        if (!Number.isFinite(value) || value < 2) return;
        // Don't trigger a re-render (loses focus); apply silently.
        setMapOverride(mapId, { grid_spacing: value });
        applyLivePrefs(entry, getEffectiveMapPrefs(mapId));
      });
      input.addEventListener('change', () => rerender());
      return;
    }
    input.addEventListener('change', () => {
      const field = input.getAttribute('data-field');
      const value = Number(input.value);
      if (field === 'pin_label_threshold' && Number.isFinite(value) && value >= 1) {
        apply({ pin_label_threshold: value });
      }
    });
  });

  // Sliders (zone_fill_opacity)
  wrapper.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(input => {
    input.addEventListener('input', () => {
      const field = input.getAttribute('data-field');
      if (field === 'zone_fill_opacity') {
        // Don't re-render on every drag (would lose focus); apply silently
        // and update the displayed value.
        const pct = Number(input.value);
        if (Number.isFinite(pct)) {
          setMapOverride(mapId, { zone_fill_opacity: pct / 100 });
          applyLivePrefs(entry, getEffectiveMapPrefs(mapId));
          const valEl = wrapper.querySelector<HTMLSpanElement>('.atlas-popover-slider-val');
          if (valEl) valEl.textContent = `${pct}%`;
        }
      }
    });
    input.addEventListener('change', () => rerender());
  });

  // Footer actions
  const saveBtn = wrapper.querySelector<HTMLButtonElement>('[data-action="save-as-default"]');
  saveBtn?.addEventListener('click', () => {
    // Saving the current map's effective prefs as the atlas-wide defaults.
    saveMapPrefsAsDefault(mapId);
    rerender();
  });
  const resetBtn = wrapper.querySelector<HTMLButtonElement>('[data-action="reset-this-map"]');
  resetBtn?.addEventListener('click', () => {
    resetMapOverride(mapId);
    applyLivePrefs(entry, getEffectiveMapPrefs(mapId));
    rerender();
  });

  // Quiet helpers (avoid unused warnings)
  void FACTORY_DEFAULTS;
  void getAtlasDefaults;
  void setAtlasDefaults;
}

/**
 * Apply effective prefs to live consumers.
 *
 * Wired today (session 216): grid, pin drag lock, pin tint, pin labels.
 * Pin style variants ('icon' vs 'round-icon' vs 'pin-shape') and zone
 * visual fields beyond fill_opacity are persisted but consumers TBD.
 * This function is the single integration point — additional consumers
 * attach here when they ship.
 */
export function applyLivePrefs(entry: MapTabCacheEntry, prefs: MapViewPrefs): void {
  // Grid
  applyGrid(entry, prefs.show_grid, prefs.grid_spacing);
  // Pin drag lock
  applyPinDragLock(entry, prefs.lock_pin_drag);
  // Pin tint + labels + style — ride on a syncPins re-call. Cheap (cache-key
  // keyed visuals + DOM-level display toggle); no per-marker rebuild.
  syncPins(entry);
  // Zone fill opacity + label visibility — syncZones re-applies via
  // zoneEffectiveOpacity (which reads prefs.zone_fill_opacity) and
  // computeLabelText (which reads prefs.zone_labels). Cheaper than touching
  // ZoneOverlay directly: tracks add/update/remove + label create/destroy
  // through the same pipeline syncZones already uses.
  syncZones(entry);
}

function applyGrid(entry: MapTabCacheEntry, show: boolean, spacing: number): void {
  // Grid is a separate layer from the image background — toggling it on/off
  // never touches the backgroundLayer (per Leaflet2DManager's gridLayer
  // split, added to fix a session-213 bug where opening the popover wiped
  // image backgrounds).
  const manager = entry.manager;
  if (show) {
    manager.setGridOverlay(spacing);
  } else {
    manager.clearGridOverlay();
  }
}

function applyPinDragLock(entry: MapTabCacheEntry, lock: boolean): void {
  const pins = entry.manager.getAllPins();
  for (const p of pins) {
    const dragging = p.marker?.dragging;
    if (!dragging) continue;
    if (lock) dragging.disable();
    else dragging.enable();
  }
}
