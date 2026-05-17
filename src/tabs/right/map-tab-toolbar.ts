/**
 * Canvas toolbar above the leaflet map (DESIGN_MAPS.md §12).
 *
 * F5 scaffold: builds the DOM. Buttons mount with title tooltips and data
 * attributes; behavior is wired in later bouts:
 *   - ⚙ visual settings → V1
 *   - ⬡ draw polygon  → V2
 *   - ╱ draw line     → V2
 *   - 👁 zones        → V5
 *   - 👁 pins         → V5
 *   - ⤢ fit-to-image  → V5
 */

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
