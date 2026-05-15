/**
 * Ghost pins — ephemeral computed-display markers (DESIGN_MAPS.md §3.8).
 *
 * Right-click on a real pin spawns ghost pins around it: one for each other
 * element that shares the same `location` value but doesn't already have a
 * real pin on this map. Right-click again on the same source pin toggles
 * them off. Right-click on a ghost prunes that single ghost.
 *
 * Lifecycle: in-memory per map tab. Cleared on map tab dispose, world switch,
 * or page reload. Never persisted to disk or synced to OW.
 *
 * Eligible types are computed at runtime from the SDK FIELD_SCHEMA — any
 * element whose `location` field is a single_link → location qualifies.
 * The `map` type is excluded (pins don't target maps; DESIGN_MAPS.md §1.4).
 */

import L from 'leaflet';
import { FIELD_SCHEMA } from '@onlyworlds/sdk';
import type { Element, ElementType, Pin } from '../../core/types';
import { storageToLeaflet } from '../../visualization/leaflet-2d/CoordinateUtils';
import { pinVisualFor } from './pin-visuals';
import { getState, patchSlice } from '../../core/state';
import { navigate, elementHash } from '../../core/router';

/** Pixel radius for ghost ring around the source pin. Tightened in session
 * 211 smoke after Captain feedback that 70px felt "too far away" — 45 keeps
 * the cluster close enough to read as a group around the source pin. */
export const GHOST_RADIUS_PX = 45;
/** Translucency for ghost markers. */
export const GHOST_OPACITY = 0.4;
/** Default icon size at zoom 0. Matches Leaflet2DManager.config.defaultIconSize. */
const GHOST_ICON_SIZE = 32;
/** Show a name label by default when ghost count is at most this many.
 * Above this threshold, labels get noisy fast — count-only relies on hover.
 * Per session 211 smoke ("if 6 or less"). */
const GHOST_LABEL_THRESHOLD = 6;

// ---- Eligible types (FIELD_SCHEMA-driven) ----

let _eligibleTypes: Set<string> | null = null;
function eligibleTypes(): Set<string> {
  if (_eligibleTypes) return _eligibleTypes;
  const out = new Set<string>();
  const schema = FIELD_SCHEMA as Record<string, Record<string, { type?: string; target?: string }> | undefined>;
  for (const [type, fields] of Object.entries(schema)) {
    if (!fields) continue;
    if (type === 'map') continue; // §1.4: pins don't target maps
    const loc = fields['location'];
    if (loc?.type === 'single_link' && loc?.target === 'location') {
      out.add(type);
    }
  }
  _eligibleTypes = out;
  return out;
}

export function isGhostEligible(type: string): boolean {
  return eligibleTypes().has(type);
}

// ---- Pure helpers ----

/**
 * Resolve the "location id" that determines a source pin's ghost neighborhood.
 *
 *   - Source element is a Location → its OWN id is the location everyone else
 *     should match against. (A pin pointing AT Eldoria should ghost every
 *     character/creature/object with `location === Eldoria.id`.)
 *   - Source element has a `location` single_link → use that link's value.
 *   - Anything else (or empty location) → null (no ghosts will spawn).
 *
 * Exported so the caller can disambiguate "no location to ghost from" from
 * other failure modes when surfacing toasts.
 */
export function resolveSourceLocationId(source: Element | undefined): string | null {
  if (!source) return null;
  if (source.type === 'location') return source.id;
  const linked = (source as Record<string, unknown>).location;
  return typeof linked === 'string' && linked ? linked : null;
}

/**
 * Compute the elements that should ghost around a source pin. Pure function.
 *
 * Rules (DESIGN_MAPS.md §3.8):
 *   - Source pin's locId resolved per `resolveSourceLocationId` (handles both
 *     Location pins and content-element pins).
 *   - Candidate must be an eligible type (character/creature/object) with the
 *     same `location` value.
 *   - Candidate must not already have a real pin on this map.
 *   - Candidate cannot be the source element itself.
 */
export function computeGhostCandidates(
  sourcePinElementId: string,
  mapId: string,
  elements: readonly Element[],
): Element[] {
  const source = elements.find(e => e.id === sourcePinElementId);
  const locId = resolveSourceLocationId(source);
  if (!locId) return [];

  const realPinElementIds = new Set<string>();
  for (const e of elements) {
    if (e.type === 'pin' && (e as Pin).map_id === mapId) {
      realPinElementIds.add((e as Pin).element_id);
    }
  }

  return elements.filter(e => {
    if (e.id === sourcePinElementId) return false;
    if (!isGhostEligible(e.type)) return false;
    if ((e as Record<string, unknown>).location !== locId) return false;
    if (realPinElementIds.has(e.id)) return false;
    return true;
  });
}

/**
 * Position N ghosts evenly around (sourceX, sourceY) at the given radius.
 * First ghost is placed at the top (12 o'clock); subsequent ghosts walk
 * clockwise. Pure function.
 */
export function computeGhostPositions(
  sourceX: number,
  sourceY: number,
  count: number,
  radius: number = GHOST_RADIUS_PX,
): Array<{ x: number; y: number }> {
  if (count <= 0) return [];
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    // Start angle = -PI/2 puts the first ghost at top of circle.
    const angle = (Math.PI * 2 * i) / count - Math.PI / 2;
    out.push({
      x: sourceX + radius * Math.cos(angle),
      // Note: storage Y grows DOWN. Adding radius * sin moves down for
      // positive angles. That's fine — the circle still wraps correctly.
      y: sourceY + radius * Math.sin(angle),
    });
  }
  return out;
}

// ---- Per-map cache (stateful, side-effect surface) ----

interface GhostMarkerEntry {
  ghostId: string;
  sourcePinId: string;
  elementId: string;
  marker: L.Marker;
  /** Optional name label marker (rendered when count ≤ GHOST_LABEL_THRESHOLD). */
  labelMarker?: L.Marker;
}

interface GhostMapCache {
  layer: L.LayerGroup;
  markersBySource: Map<string, GhostMarkerEntry[]>;
  /** Reverse lookup: marker → entry for click/contextmenu handlers. */
  markerToEntry: WeakMap<L.Marker, GhostMarkerEntry>;
}

const ghostCacheByMap = new Map<string, GhostMapCache>();

function getOrCreateCache(mapId: string, lMap: L.Map): GhostMapCache {
  let cache = ghostCacheByMap.get(mapId);
  if (cache) return cache;
  const layer = L.layerGroup().addTo(lMap);
  cache = {
    layer,
    markersBySource: new Map(),
    markerToEntry: new WeakMap(),
  };
  ghostCacheByMap.set(mapId, cache);
  return cache;
}

/**
 * Tear down all ghost state for a given map. Called by map-tab.ts in
 * disposeMapTab to release Leaflet resources.
 */
export function disposeGhostsForMap(mapId: string, lMap: L.Map | null): void {
  const cache = ghostCacheByMap.get(mapId);
  if (!cache) return;
  try {
    if (lMap) lMap.removeLayer(cache.layer);
  } catch {
    /* noop */
  }
  cache.markersBySource.clear();
  ghostCacheByMap.delete(mapId);
}

/** Does the given source pin currently have any active ghosts on this map? */
export function hasActiveGhostsFor(mapId: string, sourcePinId: string): boolean {
  const cache = ghostCacheByMap.get(mapId);
  if (!cache) return false;
  const entries = cache.markersBySource.get(sourcePinId);
  return !!entries && entries.length > 0;
}

interface ToggleArgs {
  mapId: string;
  sourcePinId: string;
  sourcePinElementId: string;
  sourcePinX: number;
  sourcePinY: number;
  canvasHeight: number;
  lMap: L.Map;
  onToast: (msg: string, level: 'info' | 'error') => void;
}

/**
 * Toggle ghost pins around a source pin. If the source already has ghosts,
 * remove them. Otherwise compute candidates and spawn. Returns the number
 * of ghosts now showing (0 means toggled off; > 0 means just spawned).
 */
export function toggleGhostsAtSourcePin(args: ToggleArgs): number {
  const { mapId, sourcePinId, sourcePinElementId, sourcePinX, sourcePinY, canvasHeight, lMap, onToast } = args;

  // Toggle-off: source already has active ghosts.
  const existingCache = ghostCacheByMap.get(mapId);
  if (existingCache && hasActiveGhostsFor(mapId, sourcePinId)) {
    const entries = existingCache.markersBySource.get(sourcePinId);
    if (entries) {
      for (const entry of entries) {
        try {
          existingCache.layer.removeLayer(entry.marker);
          if (entry.labelMarker) existingCache.layer.removeLayer(entry.labelMarker);
        } catch { /* noop */ }
      }
    }
    existingCache.markersBySource.delete(sourcePinId);
    return 0;
  }

  // Toggle-on: compute candidates from current state.
  const elements = getState().data.elements;
  const sourceEl = elements.find(e => e.id === sourcePinElementId);
  if (!sourceEl) {
    onToast('source pin element not found', 'error');
    return 0;
  }
  const locId = resolveSourceLocationId(sourceEl);
  if (!locId) {
    // Content-element source with no location link. Location-element sources
    // never trip this since their own id is the locId. Toast wording reflects
    // that nuance.
    onToast("this pin's element has no location set — nothing to ghost", 'info');
    return 0;
  }
  const candidates = computeGhostCandidates(sourcePinElementId, mapId, elements);
  if (candidates.length === 0) {
    onToast('no other elements at this location', 'info');
    return 0;
  }

  const positions = computeGhostPositions(sourcePinX, sourcePinY, candidates.length);
  const cache = getOrCreateCache(mapId, lMap);
  const entries: GhostMarkerEntry[] = [];
  // Auto-label when the candidate set is small enough to read without
  // clutter. Above the threshold the ring is the primary affordance; hover
  // tooltips remain for individual names.
  const showLabels = candidates.length <= GHOST_LABEL_THRESHOLD;
  for (let i = 0; i < candidates.length; i++) {
    const el = candidates[i];
    const pos = positions[i];
    const ghostId = `ghost:${sourcePinId}:${el.id}`;
    const visual = pinVisualFor(el.type);
    const latlng = storageToLeaflet({ x: pos.x, y: pos.y }, canvasHeight);

    const marker = L.marker(latlng, {
      icon: L.icon({
        iconUrl: visual.iconUrl,
        iconSize: [GHOST_ICON_SIZE, GHOST_ICON_SIZE],
        iconAnchor: [GHOST_ICON_SIZE / 2, GHOST_ICON_SIZE / 2],
        className: 'atlas-ghost-pin-icon',
      }),
      opacity: GHOST_OPACITY,
      // High z-index so ghosts render above real pins (caller's intent: see
      // what's around). Default Leaflet zIndexOffset is 0; +500 keeps us
      // above standard markers without clobbering popovers.
      zIndexOffset: 500,
      title: `${el.name || '(unnamed)'} — left click to select, right click to remove`,
    });

    // Optional name label rendered as a separate divIcon marker, anchored
    // below the ghost icon. interactive: false so the label doesn't block
    // clicks on the icon. Mirrors the Leaflet2DManager pin-label pattern.
    //
    // Width tuned to be narrower than the arc-spacing between adjacent
    // ghosts at radius 45 (≈47px at count=6), so labels don't visually bleed
    // into neighbor icons. Inner span clips with ellipsis for long names.
    let labelMarker: L.Marker | undefined;
    if (showLabels) {
      const labelText = el.name || '(unnamed)';
      const labelW = 90;
      const labelH = 18;
      const labelAnchorY = -(GHOST_ICON_SIZE / 2 + 14);
      labelMarker = L.marker(latlng, {
        icon: L.divIcon({
          className: 'atlas-ghost-pin-label',
          html: `<span>${escapeText(labelText)}</span>`,
          iconSize: [labelW, labelH],
          iconAnchor: [labelW / 2, labelAnchorY],
        }),
        interactive: false,
        zIndexOffset: 501,
        opacity: GHOST_OPACITY + 0.2, // slightly less transparent than the icon
      });
    }

    const entry: GhostMarkerEntry = {
      ghostId,
      sourcePinId,
      elementId: el.id,
      marker,
      labelMarker,
    };

    // Left click → select the element. Stop propagation so the underlying
    // map-click handler (pin-placement check) doesn't also fire.
    marker.on('click', (e) => {
      L.DomEvent.stop(e.originalEvent ?? e);
      const worldId = getState().active?.worldId;
      if (!worldId) return;
      patchSlice('ui', { ...getState().ui, selectedElementId: el.id });
      navigate(elementHash(worldId, el.id));
    });

    // Right click → prune this single ghost.
    marker.on('contextmenu', (e) => {
      L.DomEvent.stop(e.originalEvent ?? e);
      pruneSingleGhost(mapId, ghostId);
    });

    cache.markerToEntry.set(marker, entry);
    entries.push(entry);
    cache.layer.addLayer(marker);
    if (labelMarker) cache.layer.addLayer(labelMarker);
  }
  cache.markersBySource.set(sourcePinId, entries);
  return entries.length;
}

function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Remove a single ghost by ghostId. No-op if not found. */
export function pruneSingleGhost(mapId: string, ghostId: string): void {
  const cache = ghostCacheByMap.get(mapId);
  if (!cache) return;
  for (const [sourceId, entries] of cache.markersBySource.entries()) {
    const idx = entries.findIndex(e => e.ghostId === ghostId);
    if (idx === -1) continue;
    const entry = entries[idx];
    try {
      cache.layer.removeLayer(entry.marker);
      if (entry.labelMarker) cache.layer.removeLayer(entry.labelMarker);
    } catch { /* noop */ }
    entries.splice(idx, 1);
    if (entries.length === 0) {
      cache.markersBySource.delete(sourceId);
    }
    return;
  }
}
