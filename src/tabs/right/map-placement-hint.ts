/**
 * Pin-placement feedback (S299, Captain: "if I click that pinplace icon it
 * doesn't light up... visual feedback for that state").
 *
 * When `ui.pinPlacement` is armed the app is waiting for a map click. Three
 * cues, installed once at boot and driven purely by state:
 *   - the map cursor becomes a crosshair (wires the previously-dead
 *     `.atlas-placing` rule — the class was defined but never applied)
 *   - a clear-but-quiet banner floats over the active map: "Click the map to
 *     place <name>", with a cancel affordance
 *   - Esc cancels placement (the panic key)
 *
 * The +pin button's own lit state is CSS (`[data-action="pin-element"].active`,
 * applied by element-detail-header when armed) — this module owns the map side.
 */

import { isNarrow, openDrawer } from '../../layout/narrow-layout';
import { getState, patchSlice, subscribe } from '../../core/state';

const BANNER_CLASS = 'atlas-map-placement-hint';

function armedElementName(): string | null {
  const placement = getState().ui.pinPlacement;
  if (!placement) return null;
  const el = getState().data.elements.find(e => e.id === placement.elementId);
  return el?.name || 'element';
}

/** The active (in-document) map container, or null when no map is shown. */
function activeMapContainer(): HTMLElement | null {
  return document.querySelector('.atlas-map-canvas-container');
}

function clearPlacement(): void {
  if (getState().ui.pinPlacement) {
    patchSlice('ui', { ...getState().ui, pinPlacement: null });
  }
}

function renderBanner(name: string): void {
  const container = activeMapContainer();
  if (!container) return;
  let banner = container.querySelector<HTMLElement>(`.${BANNER_CLASS}`);
  if (!banner) {
    banner = document.createElement('div');
    banner.className = BANNER_CLASS;
    banner.innerHTML =
      `<span class="material-symbols-outlined">ads_click</span>` +
      `<span class="atlas-map-placement-hint-text"></span>` +
      `<button type="button" class="atlas-map-placement-hint-cancel" title="Cancel (Esc)">cancel</button>`;
    banner.querySelector('.atlas-map-placement-hint-cancel')
      ?.addEventListener('click', clearPlacement);
    container.appendChild(banner);
  }
  const text = banner.querySelector('.atlas-map-placement-hint-text');
  if (text) text.textContent = `Click the map to place ${name}`;
}

function removeBanners(): void {
  document.querySelectorAll(`.${BANNER_CLASS}`).forEach(n => n.remove());
}

/** Install once at boot. Idempotent-safe if called again (adds one subscriber). */
export function installPlacementHintWatcher(): void {
  let lastPlacement: unknown = null;
  subscribe(() => {
    const placement = getState().ui.pinPlacement;
    if (placement === lastPlacement) return;
    lastPlacement = placement;
    if (placement) {
      document.body.classList.add('atlas-placing');
      const name = armedElementName();
      if (name) renderBanner(name);
      // The next click belongs on the map, and below 1100px the map is in
      // the right drawer (S366): open it, or the armed pin has nowhere to go.
      if (isNarrow()) openDrawer('right');
    } else {
      document.body.classList.remove('atlas-placing');
      removeBanners();
    }
  });

  // Esc cancels placement — the panic key, matching the tour's rule.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && getState().ui.pinPlacement) {
      e.preventDefault();
      clearPlacement();
    }
  });
}
