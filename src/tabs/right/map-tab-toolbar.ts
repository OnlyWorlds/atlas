/**
 * Canvas toolbar above the leaflet map (DESIGN_MAPS.md §12).
 *
 * `buildCanvasToolbar` builds the DOM; `wireCanvasToolbar` attaches behavior
 * to the buttons (visual-settings popover, zones/pins visibility toggles,
 * fit-to-image, draw-polygon/line) and the right-anchored zones dropdown.
 * Extracted from map-tab.ts in the session-233 re-trim — the wiring lives
 * with the toolbar it drives. Button handlers look up the live cache entry by
 * mapId at click time, so wiring before the entry exists is safe.
 */

import { ToastManager } from '../../ui/toast-manager';
import { getState, patchSlice } from '../../core/state';
import { navigate, elementHash } from '../../core/router';
import { mapTabCache } from './map-tab-cache';
import { toggleVisualSettingsPopover } from './map-visual-settings-popover';
import { startDrawing, getActiveDraft, cancelDrawing } from './zone-drawing';

export interface CanvasToolbarRefs {
  root: HTMLDivElement;
  settingsBtn: HTMLButtonElement;
  drawPolygonBtn: HTMLButtonElement;
  drawLineBtn: HTMLButtonElement;
  toggleZonesBtn: HTMLButtonElement;
  togglePinsBtn: HTMLButtonElement;
  fitToImageBtn: HTMLButtonElement;
  /**
   * Right-anchored zones dropdown trigger (ZC9). Replaces the previous
   * bottom chip strip with a single button + expanding dropdown panel.
   * Hidden until at least one zone exists on the active map. Wired up by
   * zone-dropdown.ts.
   */
  zonesDropdownBtn: HTMLButtonElement;
  /** Far-right map glyph → navigates to the map element's edit page. */
  editMapBtn: HTMLButtonElement;
}

export function buildCanvasToolbar(): CanvasToolbarRefs {
  const root = document.createElement('div');
  root.className = 'atlas-map-toolbar';
  root.setAttribute('data-map-tab-toolbar', '');

  const settingsBtn = makeButton('settings', 'Map visual settings', 'map-visual-settings');
  const drawPolygonBtn = makeButton('hexagon', 'Draw polygon zone', 'draw-polygon');
  const drawLineBtn = makeButton('show_chart', 'Draw line zone', 'draw-line');
  // Visibility toggles show the SUBJECT (zones / pins), not an identical eye
  // pair (Captain, 2026-07-19: "identical icons — a bit confusing"). Hidden
  // state = a small slash-eye badge + dimmed button, wired below.
  const toggleZonesBtn = makeButton('pentagon', 'Show/hide zones', 'toggle-zones-visibility');
  const togglePinsBtn = makeButton('location_on', 'Show/hide pins', 'toggle-pins-visibility');
  const fitToImageBtn = makeButton('fit_screen', 'Fit map to image', 'fit-to-image');

  togglePinsBtn.classList.add('atlas-map-toolbar-pins-btn');
  toggleZonesBtn.classList.add('atlas-map-toolbar-zones-btn');
  for (const b of [toggleZonesBtn, togglePinsBtn]) {
    const badge = document.createElement('span');
    badge.className = 'material-symbols-outlined atlas-map-toolbar-eyeoff';
    badge.textContent = 'visibility_off';
    badge.hidden = true;
    b.appendChild(badge);
  }

  // Right-side zones dropdown (ZC9). Anchored right via margin-left:auto on
  // the spacer below. The button itself shows a count badge of how many
  // zones live on this map; clicking it expands a panel of chip-styled rows.
  const zonesDropdownBtn = document.createElement('button');
  zonesDropdownBtn.type = 'button';
  zonesDropdownBtn.className = 'atlas-map-toolbar-btn atlas-zones-dropdown-btn';
  zonesDropdownBtn.title = 'Zones on this map';
  zonesDropdownBtn.setAttribute('aria-label', 'Zones on this map');
  zonesDropdownBtn.setAttribute('data-action', 'zones-dropdown');
  zonesDropdownBtn.style.display = 'none'; // hidden until populated
  zonesDropdownBtn.innerHTML = `
    <span class="material-symbols-outlined">hexagon</span>
    <span class="atlas-zones-dropdown-count" data-role="zones-count">0</span>
    <span class="material-symbols-outlined atlas-zones-dropdown-caret">expand_more</span>
  `;

  const divider = () => {
    const d = document.createElement('span');
    d.className = 'atlas-map-toolbar-divider';
    d.setAttribute('aria-hidden', 'true');
    return d;
  };

  const spacer = document.createElement('span');
  spacer.className = 'atlas-map-toolbar-spacer';
  spacer.setAttribute('aria-hidden', 'true');

  // Far right, past the zones dropdown: open the map ELEMENT's edit page
  // (Captain, 2026-07-19 — the canvas had no route to the map's own editor).
  const editMapBtn = makeButton('map', 'Open this map element', 'open-map-element');

  root.append(
    settingsBtn,
    divider(),
    drawPolygonBtn,
    drawLineBtn,
    divider(),
    toggleZonesBtn,
    togglePinsBtn,
    divider(),
    fitToImageBtn,
    spacer,
    zonesDropdownBtn,
    editMapBtn,
  );

  return {
    root,
    settingsBtn,
    drawPolygonBtn,
    drawLineBtn,
    toggleZonesBtn,
    togglePinsBtn,
    fitToImageBtn,
    zonesDropdownBtn,
    editMapBtn,
  };
}

/**
 * Wire the toolbar buttons + zones dropdown for a freshly-mounted map.
 * Handlers resolve the live `mapTabCache` entry by mapId at click time, so
 * this runs before the cache entry is populated.
 */
export function wireCanvasToolbar(
  refs: CanvasToolbarRefs,
  zoneStrip: HTMLElement,
  mapId: string,
  toasts: ToastManager,
): void {
  // Settings cog → toggle the visual settings popover.
  refs.settingsBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (e) toggleVisualSettingsPopover(e, refs.settingsBtn);
  });

  // Visibility toggles (transient, not persisted to prefs). State held in
  // the button's `is-active` class; default = visible (button not active).
  // Hidden state = is-active class (dims the subject glyph via CSS) + the
  // small slash-eye badge. The subject glyph itself never swaps.
  const setHiddenLook = (btn: HTMLButtonElement, hidden: boolean): void => {
    btn.classList.toggle('is-active', hidden);
    const badge = btn.querySelector<HTMLElement>('.atlas-map-toolbar-eyeoff');
    if (badge) badge.hidden = !hidden;
  };

  refs.toggleZonesBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e?.zoneOverlay) return;
    const wasVisible = e.zoneOverlay.isLayerVisible();
    e.zoneOverlay.setLayerVisible(!wasVisible);
    setHiddenLook(refs.toggleZonesBtn, wasVisible);
  });

  refs.togglePinsBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    const nextHidden = !refs.togglePinsBtn.classList.contains('is-active');
    e.manager.setPinsLayerVisible(!nextHidden);
    setHiddenLook(refs.togglePinsBtn, nextHidden);
  });

  refs.fitToImageBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    e.manager.fitToCanvas();
  });

  // Map glyph, far right → the map element's own edit page.
  refs.editMapBtn.addEventListener('click', () => {
    const worldId = getState().active?.worldId;
    if (!worldId) return;
    patchSlice('ui', { ...getState().ui, selectedElementId: mapId });
    navigate(elementHash(worldId, mapId));
  });

  // Draw buttons → toggle drawing mode for this map.
  refs.drawPolygonBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    const active = getActiveDraft();
    if (active && active.mode === 'polygon' && active.mapId === mapId) {
      cancelDrawing();
    } else {
      startDrawing(e, 'polygon', toasts);
    }
  });
  refs.drawLineBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    const active = getActiveDraft();
    if (active && active.mode === 'line' && active.mapId === mapId) {
      cancelDrawing();
    } else {
      startDrawing(e, 'line', toasts);
    }
  });

  // Right-anchored zones dropdown trigger → toggle the panel.
  wireZonesDropdown(refs.zonesDropdownBtn, zoneStrip);
}

/**
 * Toggle behavior for the zones dropdown panel (ZC9). Click the button →
 * open the panel + add outside-click + Escape listeners. Click again or
 * outside → close. Defensive: clicks inside the panel don't close it.
 */
function wireZonesDropdown(btn: HTMLButtonElement, panel: HTMLElement): void {
  let outsideListener: ((e: MouseEvent) => void) | null = null;
  let escListener: ((e: KeyboardEvent) => void) | null = null;

  const close = (): void => {
    panel.classList.remove('is-open');
    btn.classList.remove('is-open');
    if (outsideListener) document.removeEventListener('mousedown', outsideListener);
    if (escListener) document.removeEventListener('keydown', escListener);
    outsideListener = null;
    escListener = null;
  };

  const open = (): void => {
    panel.classList.add('is-open');
    btn.classList.add('is-open');
    outsideListener = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panel.contains(t) || btn.contains(t)) return;
      close();
    };
    escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // Defer registration so the originating click doesn't immediately close.
    setTimeout(() => {
      if (outsideListener) document.addEventListener('mousedown', outsideListener);
      if (escListener) document.addEventListener('keydown', escListener);
    }, 0);
  };

  btn.addEventListener('click', () => {
    if (panel.classList.contains('is-open')) close();
    else open();
  });
}

function makeButton(icon: string, title: string, dataAction: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'atlas-map-toolbar-btn atlas-icon-btn-sm';
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.setAttribute('data-action', dataAction);
  const span = document.createElement('span');
  span.className = 'material-symbols-outlined';
  span.textContent = icon;
  btn.appendChild(span);
  return btn;
}
