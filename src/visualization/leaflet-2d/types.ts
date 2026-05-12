/**
 * OnlyWorlds Leaflet 2D - Type Definitions
 *
 * Types for 2D map visualization with pins, connections, and events.
 */

import L from 'leaflet';

// ============================================
// PIN TYPES
// ============================================

/**
 * Pin data - the information needed to create a pin
 * Tools extend this with additional metadata as needed
 */
export interface PinData {
  id: string;
  name: string;
  type: string;              // Element type, category, custom type
  x: number;                 // X position (storage coordinates)
  y: number;                 // Y position (storage coordinates)
  icon?: string;             // Icon URL or path (defaults to /icons/{type}.png)
  label?: string;            // Display label (defaults to name)
  color?: string;            // Optional color override for styling
  scale?: number;            // Icon scale multiplier (default 1.0)
  visible?: boolean;         // Initial visibility (default true)
  metadata?: Record<string, unknown>;  // Tool-specific data
}

/**
 * Pin instance - a rendered pin on the map
 */
export interface Pin2D {
  id: string;
  x: number;
  y: number;
  marker: L.Marker;
  label?: L.Marker;          // Optional text label below pin
  data: PinData;
  visible: boolean;
}

// ============================================
// CONNECTION TYPES
// ============================================

/**
 * Connection between two pins
 */
export interface Connection {
  id: string;                // Unique connection ID
  fromId: string;            // Source pin ID
  toId: string;              // Target pin ID
  line: L.Polyline;          // Leaflet polyline
  style?: ConnectionStyle;   // Visual styling
}

/**
 * Connection visual styling
 */
export interface ConnectionStyle {
  color?: string;            // Line color (default: cyan #22d3ee)
  weight?: number;           // Line thickness (default: 2)
  opacity?: number;          // Line opacity (default: 0.4)
  dashArray?: string;        // Dash pattern (default: '5, 10')
}

// ============================================
// CONFIGURATION
// ============================================

/**
 * Manager configuration
 */
export interface Leaflet2DConfig {
  /** Container element ID (required) */
  containerId: string;

  // Canvas dimensions
  canvasWidth?: number;      // Default: 2000
  canvasHeight?: number;     // Default: 2000

  // Zoom settings
  minZoom?: number;          // Default: -2
  maxZoom?: number;          // Default: 4
  initialZoom?: number;      // Default: 0
  fixedZoom?: boolean;       // If true, disables all zoom controls (default: false)

  // Pan settings
  enablePan?: boolean;       // Default: true
  panButton?: 'middle' | 'left' | 'right';  // Which mouse button pans (default: 'left')

  // Pin defaults
  defaultIconSize?: number;      // Default: 48
  defaultLabelOffset?: number;   // Pixels below icon center (default: 27)
  showLabels?: boolean;          // Show labels by default (default: true)

  // Connection defaults
  defaultConnectionStyle?: ConnectionStyle;

  // Bounds
  maxBounds?: [[number, number], [number, number]];  // Optional movement bounds

  // Debug
  debug?: boolean;           // Log debug info (default: false)
}

/**
 * Resolved configuration with all defaults applied
 */
export interface ResolvedLeaflet2DConfig {
  containerId: string;
  canvasWidth: number;
  canvasHeight: number;
  minZoom: number;
  maxZoom: number;
  initialZoom: number;
  fixedZoom: boolean;
  enablePan: boolean;
  panButton: 'middle' | 'left' | 'right';
  defaultIconSize: number;
  defaultLabelOffset: number;
  showLabels: boolean;
  defaultConnectionStyle: Required<ConnectionStyle>;
  maxBounds: [[number, number], [number, number]] | null;
  debug: boolean;
}

// ============================================
// EVENTS
// ============================================

/**
 * Event types emitted by the manager
 */
export type Leaflet2DEventType =
  | 'ready'
  | 'pin-click'
  | 'pin-hover'
  | 'pin-hover-end'
  | 'map-click'
  | 'pin-added'
  | 'pin-removed'
  | 'connection-added'
  | 'connection-removed';

/**
 * Pin click event data
 */
export interface PinClickEvent {
  pin: Pin2D;
  originalEvent: L.LeafletMouseEvent;
}

/**
 * Pin hover event data
 */
export interface PinHoverEvent {
  pin: Pin2D;
  originalEvent: L.LeafletMouseEvent;
}

/**
 * Map click event data (click on empty space)
 */
export interface MapClickEvent {
  latlng: L.LatLng;
  point: { x: number; y: number };  // Storage coordinates
  originalEvent: L.LeafletMouseEvent;
}

/**
 * Event callback signatures
 */
export type EventCallbacks = {
  'ready': () => void;
  'pin-click': (event: PinClickEvent) => void;
  'pin-hover': (event: PinHoverEvent) => void;
  'pin-hover-end': (event: PinHoverEvent) => void;
  'map-click': (event: MapClickEvent) => void;
  'pin-added': (pin: Pin2D) => void;
  'pin-removed': (pinId: string) => void;
  'connection-added': (connection: Connection) => void;
  'connection-removed': (connectionId: string) => void;
};

// ============================================
// COORDINATE TYPES
// ============================================

/**
 * Point in storage coordinates (top-left origin, Y increases downward)
 */
export interface StoragePoint {
  x: number;
  y: number;
}

/**
 * Background configuration
 */
export interface BackgroundConfig {
  type: 'image' | 'grid' | 'none';
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  gridColor?: string;
  gridSpacing?: number;
}
