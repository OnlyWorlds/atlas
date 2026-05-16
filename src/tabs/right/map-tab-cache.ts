/**
 * Shared cache + entry type for the map-tab subsystem.
 *
 * Extracted from map-tab.ts so the pin-sync, pin-drag, filter-chips, and
 * background-refresh modules can share the cache without circular imports.
 * map-tab.ts owns mount/dispose lifecycle; the submodules read/write entries
 * via the exports here.
 */

import type { Leaflet2DManager } from '../../visualization/leaflet-2d/Leaflet2DManager';

export interface MapTabCacheEntry {
  mapId: string;
  worldId: string;
  container: HTMLDivElement;
  manager: Leaflet2DManager;
  objectUrls: string[];
  ready: Promise<void>;
  tooltip: HTMLDivElement;
  /**
   * Trash drop-zone overlay used by pin drag-to-delete (DESIGN_MAPS.md §3.5
   * smoke note session 211). Hidden by default; shown only while a pin is
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
}

export const mapTabCache = new Map<string, MapTabCacheEntry>();
