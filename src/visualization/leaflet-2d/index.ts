/**
 * OnlyWorlds Leaflet 2D
 *
 * 2D map visualization with Leaflet CRS.Simple.
 * General-purpose foundation for spatial pin displays, relationship maps,
 * and navigable 2D canvases.
 */

// Main manager
export { Leaflet2DManager } from './Leaflet2DManager';

// Types
export type {
  // Pin types
  PinData,
  Pin2D,

  // Connection types
  Connection,
  ConnectionStyle,

  // Configuration
  Leaflet2DConfig,
  ResolvedLeaflet2DConfig,
  BackgroundConfig,

  // Events
  Leaflet2DEventType,
  PinClickEvent,
  PinHoverEvent,
  MapClickEvent,
  EventCallbacks,

  // Coordinates
  StoragePoint
} from './types';

// Coordinate utilities
export {
  leafletToStorage,
  storageToLeaflet,
  pointsToLatLngs,
  latLngsToPoints,
  getCenterPoint,
  getBoundingBox,
  getDistance,
  generateId
} from './CoordinateUtils';
