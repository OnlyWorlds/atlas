/**
 * Shared cache + entry type for the map-tab subsystem.
 *
 * Extracted from map-tab.ts so the pin-sync, pin-drag, filter-chips, and
 * background-refresh modules can share the cache without circular imports.
 * map-tab.ts owns mount/dispose lifecycle; the submodules read/write entries
 * via the exports here.
 */

import type { Leaflet2DManager } from '../../visualization/leaflet-2d/Leaflet2DManager';
import type { ZoneOverlay } from '../../visualization/leaflet-2d/ZoneOverlay';
import type { ZoneDateChoice } from '../../core/zone-dates';

export interface MapTabCacheEntry {
  mapId: string;
  worldId: string;
  /**
   * Vertical flex column that hosts the toolbar (top) + the leaflet container
   * (below). This is what gets re-attached to the active map pane on tab
   * switch — caching the wrapper preserves the leaflet state inside.
   */
  wrapper: HTMLDivElement;
  /**
   * Thin toolbar row above the canvas (DESIGN_MAPS.md §12). Contains the
   * settings cog, draw-polygon, draw-line, show/hide zones, show/hide pins,
   * fit-to-image buttons. F5 scaffold; behavior wired in V1-V5.
   */
  toolbar: HTMLDivElement;
  container: HTMLDivElement;
  manager: Leaflet2DManager;
  objectUrls: string[];
  ready: Promise<void>;
  tooltip: HTMLDivElement;
  /**
   * Trash drop-zone overlay used by pin drag-to-delete (DESIGN_MAPS.md §3.5).
   * Hidden by default; shown only while a pin is
   * being dragged. Drop a pin on top → pin is deleted.
   */
  trashZone: HTMLDivElement;
  /**
   * Pin filter chip strip — top-left overlay. One chip per element type
   * present in this map's pins. Click chip toggles `hiddenPinTypes`.
   */
  chipStrip: HTMLDivElement;
  /**
   * Per-tab in-memory set of element types whose pins are hidden on this
   * map. Default empty (all visible). Reset on tab dispose. Pure UX pref —
   * never persisted.
   */
  hiddenPinTypes: Set<string>;
  /**
   * Snapshot of the image source last used to render the background. When the
   * map element's image fields change (URL edited, local file added/removed),
   * the subscriber compares and re-applies.
   */
  lastBg: string;
  /**
   * Zone polygon/polyline renderer attached to this tab's leaflet map.
   * Constructed in mountMapTab after manager.init lands; null before that.
   * Disposed in disposeMapTab before manager.destroy.
   */
  zoneOverlay: ZoneOverlay | null;
  /**
   * Below-canvas chip strip listing zones present on this map. One chip per
   * zone (computed via listZonesOnMap). Click selects, right-click context.
   */
  zoneStrip: HTMLDivElement;
  /**
   * Median nearest-neighbour gap between this map's visible pins, in
   * STORAGE units (the density layer). Set by syncPins; read by
   * applyPinScale on every zoomend. Infinity when fewer than two pins.
   */
  pinSpacing?: number;
  /** The icon scale last applied to every pin (rounded); skip when unchanged. */
  pinScale?: number;
  /**
   * Kinds (world-styles `groupByKind` keys) whose zones are hidden on this
   * map from the zone panel's eye. Session-only, like `hiddenPinTypes`.
   */
  hiddenZoneKinds: Set<string>;
  /**
   * The date bar (#280, `map-date-bar.ts`), bottom left of the canvas, shown
   * while a zone on this map is dated; and what it is set to (the world's now
   * by default). Session-only, like `hiddenZoneKinds`.
   */
  dateBar: HTMLDivElement;
  zoneDate: ZoneDateChoice;
}

export const mapTabCache = new Map<string, MapTabCacheEntry>();
