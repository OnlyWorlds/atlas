/**
 * The sample-world demo — a VIEW-ONLY PRESENTATION at `#/demo`, not a world
 * in the registry (session 254 decision: the old in-app sample world stranded
 * users in a half-configured app and read as "what is this world doing here").
 *
 * Built from the share renderer's payload path (born read-only: cards, pin
 * modal, zero edit affordances) plus a Leaflet hero for the map (zoom/pan is
 * the prize piece). Nothing is written anywhere: no registry entry, no OPFS,
 * no folder. Close it and it's gone.
 *
 * Data: `demo-page.json` (curated from Captain's Sikelia world — prose-only
 * descriptions, 12 carded highlights, every pin click-openable) + the bundled
 * map art webp. Both lazy-load; neither rides the main chunk. Regenerate the
 * JSON via the session-254 script in PROGRESS (source: Forge/Notes/sikelia/).
 */

import { isAtlasGrounded } from '../core/grounded';
import { navigate } from '../core/router';
import { getState } from '../core/state';
import { hasFolderMode } from '../core/capabilities';
import type { PagePayload, PayloadElementEntry } from '../core/share-payload';
import { escapeText } from '../core/dom-utils';

interface DemoData {
  payload: PagePayload;
  map: {
    width: number;
    height: number;
    pins: Array<{ x: number; y: number; name: string; ref: string }>;
  };
}

let overlay: HTMLElement | null = null;
let cleanup: (() => void) | null = null;

export function isDemoMounted(): boolean {
  return overlay !== null;
}

export function unmountDemo(): void {
  cleanup?.();
  cleanup = null;
  overlay?.remove();
  overlay = null;
}

/** Mount the demo as a full-viewport overlay. Idempotent. */
export function mountDemo(): void {
  if (overlay) return;
  overlay = document.createElement('div');
  overlay.className = 'atlas-demo-overlay';
  overlay.innerHTML = `
    <div class="atlas-demo-band">
      <span class="atlas-demo-band-title">Sikelia · example page · view only</span>
      <button type="button" class="atlas-demo-exit" data-action="demo-exit">
        <span class="material-symbols-outlined">close</span> Exit
      </button>
    </div>
    <div class="atlas-demo-scroll">
      <div class="atlas-demo-intro">
        <h1>Sikelia</h1>
        <p>Ancient Sicily around 505 BC: <span data-role="demo-pin-count">the settlements</span> on hand-made map art, each one placed, described, and sorted by what kind of place it was, from Greek poleis to native strongholds and Phoenician ports.</p>
        <p class="atlas-demo-intro-sub">A page like this is what Atlas publishes: blocks built from a real world. Zoom the map, click any pin. Below it: a dozen highlights from <span data-role="demo-element-count">its</span> elements.</p>
      </div>
      <div class="atlas-demo-map" data-role="demo-map"></div>
      <p class="atlas-demo-map-hint">Drag to pan · scroll to zoom · click a pin to read about the place</p>
      <div class="atlas-demo-cards" data-role="demo-cards"></div>
      <div class="atlas-demo-footer">
        <p>Compose your own in the pages room: pick blocks, preview, publish.</p>
        <button type="button" class="atlas-btn-primary" data-action="demo-exit-setup">Set up a local folder</button>
        <button type="button" class="atlas-btn-primary" data-action="demo-exit-back">Back to Atlas</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const exit = (): void => { navigate('#/'); };
  overlay.querySelector('[data-action="demo-exit"]')!.addEventListener('click', exit);
  // The footer CTA runs the real folder setup from here (user gesture is
  // required for showDirectoryPicker, so this handler IS the picker moment),
  // then leaves the demo — straight from "I've seen it" to "it's mine."
  const setupBtn = overlay.querySelector<HTMLButtonElement>('[data-action="demo-exit-setup"]')!;
  const backBtn = overlay.querySelector<HTMLButtonElement>('[data-action="demo-exit-back"]')!;
  // Entry is the share room's example link now (S255): visitors with an
  // atlas root get "back to atlas"; rootless visitors (old links, curious
  // strangers) still get the setup CTA. Show exactly one.
  // Capability gate (S309, third instance of the class): on OPFS-only
  // browsers the folder picker does not exist, so the setup CTA would be a
  // silently dead button (its catch swallows the throw by design, for
  // user-cancel). No folder mode -> no folder CTA; the back door stays.
  // "Has worlds" is the question, not "has a home folder": a world opened in
  // place on a first visit has no root and needs no setup offer (S365 lens B F4).
  if (isAtlasGrounded() || !hasFolderMode()) setupBtn.remove();
  else backBtn.remove();
  backBtn.addEventListener('click', exit);
  setupBtn.addEventListener('click', async () => {
    setupBtn.disabled = true;
    try {
      const { setupAtlasRoot } = await import('../setup/atlas-root-flow');
      const result = await setupAtlasRoot();
      if (result) {
        exit();
        // A world pick opens in place; a folder pick says what it found (S365).
        const [{ finishSetupDoor }, { toastManager }] = await Promise.all([
          import('../setup/world-doors'), import('../ui/toast-manager'),
        ]);
        await finishSetupDoor(result, toastManager);
      }
    } catch {
      // Cancelled or failed — stay in the demo; the welcome page offers it again.
    } finally {
      setupBtn.disabled = false;
    }
  });
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') exit(); };
  window.addEventListener('keydown', onKey);

  let disposed = false;
  let mapDispose: (() => void) | null = null;
  cleanup = () => {
    disposed = true;
    window.removeEventListener('keydown', onKey);
    mapDispose?.();
  };

  // Everything heavy loads lazily after the shell paints.
  void (async () => {
    const [{ default: data }, render] = await Promise.all([
      import('./demo-page.json') as Promise<{ default: DemoData }>,
      import('../middle/share-page-render'),
    ]);
    if (disposed || !overlay) return;

    // Counts DERIVED from the payload (S309): this copy shipped a hardcoded
    // "586 elements" against a payload carrying 196 — a rotting number is
    // worse than none. The payload is the source; the copy reads it.
    const pinCount = data.map.pins.length;
    const elementCount = Object.keys(data.payload.elements ?? {}).length;
    const pinCountEl = overlay.querySelector<HTMLElement>('[data-role="demo-pin-count"]');
    if (pinCountEl) pinCountEl.textContent = `${pinCount} settlements`;
    const elCountEl = overlay.querySelector<HTMLElement>('[data-role="demo-element-count"]');
    if (elCountEl) elCountEl.textContent = String(elementCount);

    // Cards through the real payload renderer (view-only by construction).
    const cardsMount = overlay.querySelector<HTMLElement>('[data-role="demo-cards"]')!;
    cardsMount.appendChild(render.renderPayloadPage(data.payload));

    // The map hero: Leaflet on the bundled art, every pin openable.
    mapDispose = await mountDemoMap(
      overlay.querySelector<HTMLElement>('[data-role="demo-map"]')!,
      data,
      (entry) => render.openPinModal(entry, data.payload.elements),
    );
    if (disposed) mapDispose?.();
  })();
}

async function mountDemoMap(
  mount: HTMLElement,
  data: DemoData,
  openEntry: (entry: PayloadElementEntry) => void,
): Promise<() => void> {
  const { default: L } = await import('leaflet');
  await import('leaflet/dist/leaflet.css');
  const { width: W, height: H } = data.map;

  const map = L.map(mount, {
    crs: L.CRS.Simple,
    attributionControl: false,
    zoomControl: true,
    minZoom: -4,
    maxZoom: 1,
    zoomSnap: 0.25,
  });
  const assetUrl = new URL('./sikelia-map.webp', import.meta.url).href;
  const bounds: L.LatLngBoundsExpression = [[0, 0], [H, W]];
  L.imageOverlay(assetUrl, bounds).addTo(map);
  // Padding so the initial fit shows the WHOLE island — the bare fit clipped
  // the northeast tip at the container edge (S255 fresh-eyes pass).
  map.fitBounds(bounds, { padding: [16, 16] });
  map.setMaxBounds([[-H * 0.15, -W * 0.15], [H * 1.15, W * 1.15]]);

  for (const pin of data.map.pins) {
    const entry = data.payload.elements[pin.ref];
    // Bottom-left, like the schema and Leaflet CRS.Simple (S361: the bundled
    // pins were flipped to the standard with this line).
    const marker = L.circleMarker([pin.y, pin.x], {
      radius: 5,
      color: '#22d3ee',
      weight: 1.5,
      fillColor: '#0e7490',
      fillOpacity: 0.75,
    }).addTo(map);
    // Leaflet reads a string tooltip as HTML: escape even this bundled name,
    // so the pattern is safe if it is ever copied onto live data (S360).
    marker.bindTooltip(escapeText(pin.name), { direction: 'top', offset: [0, -6] });
    // Close the hover tooltip before the modal opens — it otherwise lingers
    // under the dimmed backdrop like debris (S255 fresh-eyes pass).
    if (entry) marker.on('click', () => { marker.closeTooltip(); openEntry(entry); });
  }

  return () => map.remove();
}
