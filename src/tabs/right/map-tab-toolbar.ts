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
}

export function buildCanvasToolbar(): CanvasToolbarRefs {
  const root = document.createElement('div');
  root.className = 'atlas-map-toolbar';
  root.setAttribute('data-map-tab-toolbar', '');

  const settingsBtn = makeButton('settings', 'Map visual settings', 'map-visual-settings');
  const drawPolygonBtn = makeButton('hexagon', 'Draw polygon zone', 'draw-polygon');
  const drawLineBtn = makeButton('show_chart', 'Draw line zone', 'draw-line');
  const toggleZonesBtn = makeButton('visibility', 'Show/hide zones', 'toggle-zones-visibility');
  const togglePinsBtn = makeButton('visibility', 'Show/hide pins', 'toggle-pins-visibility');
  const fitToImageBtn = makeButton('fit_screen', 'Fit map to image', 'fit-to-image');

  // The pins-visibility button keeps the same glyph as zones-visibility but
  // differentiates via a small pin glyph overlay. Two-glyph composition
  // mirroring the [+map]/[+pin] pattern used in element-detail header.
  togglePinsBtn.classList.add('atlas-map-toolbar-pins-btn');
  toggleZonesBtn.classList.add('atlas-map-toolbar-zones-btn');

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
  refs.toggleZonesBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e?.zoneOverlay) return;
    const wasVisible = e.zoneOverlay.isLayerVisible();
    e.zoneOverlay.setLayerVisible(!wasVisible);
    refs.toggleZonesBtn.classList.toggle('is-active', wasVisible);
    // Glyph swap: visibility ↔ visibility_off mirrors the state.
    const icon = refs.toggleZonesBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = wasVisible ? 'visibility_off' : 'visibility';
  });

  refs.togglePinsBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    const currentlyActive = refs.togglePinsBtn.classList.contains('is-active');
    // Active class indicates "pins hidden" — flip.
    const nextHidden = !currentlyActive;
    e.manager.setPinsLayerVisible(!nextHidden);
    refs.togglePinsBtn.classList.toggle('is-active', nextHidden);
    const icon = refs.togglePinsBtn.querySelector('.material-symbols-outlined');
    if (icon) icon.textContent = nextHidden ? 'visibility_off' : 'visibility';
  });

  refs.fitToImageBtn.addEventListener('click', () => {
    const e = mapTabCache.get(mapId);
    if (!e) return;
    e.manager.fitToCanvas();
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
