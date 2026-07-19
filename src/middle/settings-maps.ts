/**
 * Settings → Maps tab (split out of the Editing tab 2026-07-19).
 *
 * Two sections:
 *   1. Map affordance toggles (header label toggles) — registry.maps_settings,
 *      moved verbatim from settings-editing.ts.
 *   2. Default map view — the atlas-wide MapViewPrefs DEFAULTS editor. Until
 *      now these defaults were only writable implicitly ("Save as default" in
 *      a map's ⚙ popover); this gives them a discoverable home. Per-map
 *      overrides stay in the popover — a map with its own settings does not
 *      follow defaults (the pinning rule in map-view-prefs.ts).
 *
 * Changing a default live-applies to every OPEN map tab whose effective prefs
 * change (mapTabCache + applyLivePrefs — same integration point the popover
 * uses), so the right pane repaints while the settings tab is in the middle.
 */

import { getState, patchSlice } from '../core/state';
import { saveRegistry, setMapsSettings } from '../registry/registry';
import { ToastManager } from '../ui/toast-manager';
import type { WorldsRegistry } from '../core/types';
import {
  getAtlasDefaults,
  setAtlasDefaults,
  resetAtlasDefaults,
  getEffectiveMapPrefs,
  type MapViewPrefs,
  type PinStyle,
  type PinLabels,
  type PinTint,
  type ZoneLabels,
} from '../core/map-view-prefs';
import { mapTabCache } from '../tabs/right/map-tab-cache';
import { applyLivePrefs } from '../tabs/right/map-visual-settings-popover';

export function renderMapsTab(reg: WorldsRegistry): string {
  return `
    ${renderAffordanceSection(reg)}
    ${renderDefaultsSection()}
  `;
}

export function wireMapsTab(toasts: ToastManager): void {
  wireAffordanceSection();
  wireDefaultsSection(toasts);
}

// ---- Map affordances (header label toggles; DESIGN_MAPS.md §3.5) ----

function renderAffordanceSection(reg: WorldsRegistry): string {
  const s = reg.maps_settings ?? {};
  const showMaps = !!s.show_map_names_in_header;
  const showPinMaps = !!s.show_pin_map_names_in_header;
  const showPinnedEls = !!s.show_pinned_element_names_in_header;
  return `
    <section class="atlas-settings-section">
      <h3>Map affordances</h3>
      <p class="atlas-settings-hint">How atlas renders map affordances across the UI. Label toggles default off for a tighter icon-only layout; flip on for explicit names.</p>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-map-names-in-header" ${showMaps ? 'checked' : ''} />
        <span>Show map names alongside map icons in element header</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-pin-map-names-in-header" ${showPinMaps ? 'checked' : ''} />
        <span>Show map names alongside pin icons in element header</span>
      </label>
      <label class="atlas-settings-toggle">
        <input type="checkbox" name="show-pinned-element-names-in-header" ${showPinnedEls ? 'checked' : ''} />
        <span>Show element names alongside category icons on Map detail</span>
      </label>
    </section>
  `;
}

function wireAffordanceSection(): void {
  // Three independent toggles all stored on registry.maps_settings via the
  // partial-merge setMapsSettings helper. No info toasts — the visible state
  // change in element-detail headers is its own feedback.
  const wireToggle = (
    name: string,
    key: 'show_map_names_in_header' | 'show_pin_map_names_in_header' | 'show_pinned_element_names_in_header',
  ): void => {
    const el = document.querySelector<HTMLInputElement>(`.atlas-settings input[name="${name}"]`);
    el?.addEventListener('change', () => {
      const next = setMapsSettings(getState().registry, { [key]: el.checked });
      saveRegistry(next);
      patchSlice('registry', next);
    });
  };
  wireToggle('show-map-names-in-header', 'show_map_names_in_header');
  wireToggle('show-pin-map-names-in-header', 'show_pin_map_names_in_header');
  wireToggle('show-pinned-element-names-in-header', 'show_pinned_element_names_in_header');
}

// ---- Default map view (atlas-wide MapViewPrefs defaults) ----

function renderDefaultsSection(): string {
  const d = getAtlasDefaults();
  const sel = (name: string, options: Array<[string, string]>, current: string): string => {
    const opts = options
      .map(([v, label]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${label}</option>`)
      .join('');
    return `<select class="atlas-select" data-map-default="${name}">${opts}</select>`;
  };
  return `
    <section class="atlas-settings-section">
      <h3>Default map view</h3>
      <p class="atlas-settings-hint">
        The starting look for every map. A map you tune through its own
        ⚙ visual settings keeps its own look and stops following these
        defaults.
      </p>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Pin style</label>
        ${sel('pin_style', [['icon', 'Icon'], ['round-icon', 'Round + icon'], ['pin-shape', 'Pin shape']], d.pin_style)}
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Pin labels</label>
        ${sel('pin_labels', [['always', 'Always'], ['hover', 'On hover'], ['threshold', 'When few pins visible'], ['never', 'Never']], d.pin_labels)}
      </div>
      <div class="atlas-settings-row" data-map-default-row="pin_label_threshold" ${d.pin_labels === 'threshold' ? '' : 'hidden'}>
        <label class="atlas-settings-label">Label threshold (pins)</label>
        <input class="atlas-input atlas-settings-num-input" type="number" min="1" max="99" value="${d.pin_label_threshold}" data-map-default="pin_label_threshold" />
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Pin tint</label>
        ${sel('pin_tint', [['type-color', 'Type color'], ['accent', 'Accent'], ['muted', 'Muted']], d.pin_tint)}
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Zone labels</label>
        ${sel('zone_labels', [['always', 'Always'], ['hover', 'On hover'], ['never', 'Never']], d.zone_labels)}
      </div>
      <div class="atlas-settings-row">
        <label class="atlas-settings-label">Zone fill opacity (%)</label>
        <input class="atlas-input atlas-settings-num-input" type="number" min="0" max="100" step="5" value="${Math.round(d.zone_fill_opacity * 100)}" data-map-default="zone_fill_opacity" />
      </div>
      <button type="button" class="atlas-btn-ghost" data-action="reset-map-defaults">Reset to factory defaults</button>
      <p class="atlas-settings-hint">Grid and pin-drag lock are per-map choices: set them from a map's ⚙ visual settings.</p>
    </section>
  `;
}

function wireDefaultsSection(toasts: ToastManager): void {
  // Every default change live-applies to open map tabs so the right pane
  // repaints beside the settings panel. Maps carrying their own override are
  // naturally unaffected (getEffectiveMapPrefs merges override last).
  const applyToOpenTabs = (): void => {
    for (const entry of mapTabCache.values()) {
      applyLivePrefs(entry, getEffectiveMapPrefs(entry.mapId));
    }
  };
  const commit = (patch: Partial<MapViewPrefs>, message: string): void => {
    setAtlasDefaults(patch);
    applyToOpenTabs();
    toasts.info(message);
  };

  document.querySelectorAll<HTMLSelectElement>('.atlas-settings select[data-map-default]').forEach((el) => {
    el.addEventListener('change', () => {
      const field = el.getAttribute('data-map-default');
      const v = el.value;
      if (field === 'pin_style') commit({ pin_style: v as PinStyle }, `Default pin style: ${v}`);
      else if (field === 'pin_labels') {
        commit({ pin_labels: v as PinLabels }, `Default pin labels: ${v}`);
        const row = document.querySelector<HTMLElement>('.atlas-settings [data-map-default-row="pin_label_threshold"]');
        if (row) row.hidden = v !== 'threshold';
      } else if (field === 'pin_tint') commit({ pin_tint: v as PinTint }, `Default pin tint: ${v}`);
      else if (field === 'zone_labels') commit({ zone_labels: v as ZoneLabels }, `Default zone labels: ${v}`);
    });
  });

  document.querySelectorAll<HTMLInputElement>('.atlas-settings input[data-map-default]').forEach((el) => {
    el.addEventListener('change', () => {
      const field = el.getAttribute('data-map-default');
      const value = Number(el.value);
      if (!Number.isFinite(value)) return;
      if (field === 'pin_label_threshold' && value >= 1) {
        commit({ pin_label_threshold: value }, `Default label threshold: ${value}`);
      } else if (field === 'zone_fill_opacity' && value >= 0 && value <= 100) {
        commit({ zone_fill_opacity: value / 100 }, `Default zone opacity: ${value}%`);
      }
    });
  });

  const resetBtn = document.querySelector<HTMLButtonElement>('.atlas-settings [data-action="reset-map-defaults"]');
  resetBtn?.addEventListener('click', () => {
    resetAtlasDefaults();
    applyToOpenTabs();
    toasts.info('Map defaults reset to factory values');
    // Re-render the section in place so the controls reflect factory values.
    // Cheapest honest refresh: re-navigate to the same settings hash.
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
