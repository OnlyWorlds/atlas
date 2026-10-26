/**
 * Is a zone draw or a zone reshape in progress on the page?
 *
 * `ui.zoneEditing` was meant to say so (the zone-edit-mode header promised an
 * explicit slice) but nothing ever sets it, so every check that read it was
 * dead: Esc still jumped home mid-draw and the live folder could
 * rescan and reload elements under a half-dragged outline. The two gestures
 * DO mark the page: the draft overlay (`zone-drawing-overlay.ts`) and the
 * edit container class (`zone-edit-mode.ts`). Read as DOM so core stays free
 * of the Leaflet modules.
 */
export function isZoneGestureActive(): boolean {
  return typeof document !== 'undefined'
    && document.querySelector('[data-zone-draft-overlay], .atlas-zone-editing') !== null;
}
