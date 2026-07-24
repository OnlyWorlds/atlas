/**
 * OnlyWorlds Leaflet 2D Manager
 *
 * General-purpose 2D map visualization using Leaflet with CRS.Simple.
 * Provides pin management, connections, visibility control, and camera operations.
 *
 * Extracted from ecosystem-explorer-mobile MapManager + Zoner patterns.
 */

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type {
  Leaflet2DConfig,
  ResolvedLeaflet2DConfig,
  PinData,
  Pin2D,
  Connection,
  ConnectionStyle,
  Leaflet2DEventType,
  EventCallbacks,
  BackgroundConfig,
  StoragePoint
} from './types';
import { leafletToStorage, storageToLeaflet, generateId } from './CoordinateUtils';

/**
 * Translate the semantic `anchor` choice to a Leaflet [x, y] iconAnchor.
 *   - 'center': icon centered on the latlng — appropriate for disc/round-icon styles.
 *   - 'bottom-tip': bottom-center aligns to latlng — appropriate for teardrop
 *     pin-shape so the visible tip points at the map coord.
 */
function computeIconAnchor(iconSize: number, anchor: 'center' | 'bottom-tip'): [number, number] {
  if (anchor === 'bottom-tip') {
    // Leave a 2px margin at the bottom of the canvas (matches the
    // pin-visuals tipY = size - 2 used in drawPinShape).
    return [iconSize / 2, iconSize - 2];
  }
  return [iconSize / 2, iconSize / 2];
}

/**
 * Default configuration values
 */
const DEFAULT_CONFIG: Omit<ResolvedLeaflet2DConfig, 'containerId'> = {
  canvasWidth: 2000,
  canvasHeight: 2000,
  minZoom: -2,
  maxZoom: 4,
  initialZoom: 0,
  fixedZoom: false,
  enablePan: true,
  panButton: 'left',
  defaultIconSize: 48,
  defaultLabelOffset: 27,
  showLabels: true,
  defaultConnectionStyle: {
    color: '#22d3ee',
    weight: 2,
    opacity: 0.4,
    dashArray: '5, 10'
  },
  maxBounds: null,
  debug: false
};

export class Leaflet2DManager {
  private map: L.Map | null = null;
  private config: ResolvedLeaflet2DConfig;

  // Layer groups (z-index order: background < grid < connections < pins < labels)
  private backgroundLayer: L.LayerGroup | null = null;
  private gridLayer: L.LayerGroup | null = null;
  private connectionsLayer: L.LayerGroup | null = null;
  private pinsLayer: L.LayerGroup | null = null;
  private labelsLayer: L.LayerGroup | null = null;

  // Pin storage
  private pins: Map<string, Pin2D> = new Map();

  // Connection storage
  private connections: Map<string, Connection> = new Map();

  // Event callbacks
  private eventCallbacks: Partial<{ [K in Leaflet2DEventType]: EventCallbacks[K][] }> = {};

  // Preloaded icons cache
  private preloadedIcons: Set<string> = new Set();

  // ============================================
  // INITIALIZATION
  // ============================================

  constructor(config: Leaflet2DConfig) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      defaultConnectionStyle: {
        ...DEFAULT_CONFIG.defaultConnectionStyle,
        ...config.defaultConnectionStyle
      }
    } as ResolvedLeaflet2DConfig;

    this.log('Config resolved:', this.config);
  }

  /**
   * Initialize the Leaflet map
   */
  async init(): Promise<void> {
    this.log('Initializing Leaflet2DManager...');

    const container = document.getElementById(this.config.containerId);
    if (!container) {
      throw new Error(`Container element not found: ${this.config.containerId}`);
    }

    // Create map with CRS.Simple (Cartesian coordinates).
    // Smooth fractional zoom: Leaflet defaults to integer-step zoom which
    // feels jumpy on wheel + on +/- buttons. zoomSnap=0.25 + zoomDelta=0.5
    // gives precise zoom positions; wheelPxPerZoomLevel=120 slows the wheel
    // for finer control.
    const mapOptions: L.MapOptions = {
      crs: L.CRS.Simple,
      minZoom: this.config.fixedZoom ? this.config.initialZoom : this.config.minZoom,
      maxZoom: this.config.fixedZoom ? this.config.initialZoom : this.config.maxZoom,
      // Disable Leaflet's default top-left zoom control. We re-add it at
      // bottom-right below, where it won't collide with atlas's top-left
      // pin-filter chip strip (DESIGN_MAPS.md session 211 polish).
      zoomControl: false,
      attributionControl: false,
      renderer: L.canvas(),
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
      zoomAnimation: true,
      // SOLID bounds, not elastic (S316, the pan snap-back). Leaflet's
      // default viscosity 0 ALLOWS dragging past maxBounds and then
      // rubber-bands the view back on release — with bounds set to the exact
      // image rect, every pan appeared to work and then snapped back
      // (measured: a 120px drag settling at 0). Viscosity 1.0 makes the edge
      // firm during the drag itself: the map stops instead of bouncing.
      maxBoundsViscosity: 1.0,
    };

    // Fixed zoom disables all zoom interactions
    if (this.config.fixedZoom) {
      Object.assign(mapOptions, {
        zoomSnap: 0,
        zoomDelta: 0,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        touchZoom: false,
        boxZoom: false
      });
    }

    this.map = L.map(this.config.containerId, mapOptions);

    // Add zoom control at bottom-right (unless fixedZoom disables zooming
    // entirely). Bottom-right avoids the top-left chip-strip collision.
    if (!this.config.fixedZoom) {
      L.control.zoom({ position: 'bottomright' }).addTo(this.map);
    }

    // Configure pan controls
    if (!this.config.enablePan) {
      this.map.dragging.disable();
    }

    // Set initial view (center of canvas)
    const centerX = this.config.canvasWidth / 2;
    const centerY = this.config.canvasHeight / 2;
    const centerLatLng = storageToLeaflet({ x: centerX, y: centerY }, this.config.canvasHeight);
    this.map.setView(centerLatLng, this.config.initialZoom);

    // Set bounds if configured
    if (this.config.maxBounds) {
      const sw = storageToLeaflet(
        { x: this.config.maxBounds[0][0], y: this.config.maxBounds[1][1] },
        this.config.canvasHeight
      );
      const ne = storageToLeaflet(
        { x: this.config.maxBounds[1][0], y: this.config.maxBounds[0][1] },
        this.config.canvasHeight
      );
      // Padded 15% per side (S316): exact-rect bounds leave ZERO pannable
      // slack whenever the viewport exceeds the image on an axis, which reads
      // as "panning is broken". The pad is view breathing room only — stored
      // pin/vertex coords stay guarded by their own clamps (pin-drag,
      // commitVertexPosition), never by the camera.
      this.map.setMaxBounds(L.latLngBounds(sw, ne).pad(0.15));
    }

    // Custom pane for the background image — sits BELOW Leaflet's default
    // panes (tilePane=200, overlayPane=400, markerPane=600) so the image
    // never paints over zones, pins, the grid, or transient drawing UI.
    // Without this the image renders in overlayPane (z=400) alongside zone
    // polygons; DOM order then determines stacking and the image can end
    // up obscuring the polygons (session 213 smoke).
    this.map.createPane('atlasBgImagePane');
    const bgPane = this.map.getPane('atlasBgImagePane');
    if (bgPane) bgPane.style.zIndex = '180';

    // Create layer groups (order matters for z-index)
    this.backgroundLayer = L.layerGroup().addTo(this.map);
    // gridLayer is independent of backgroundLayer so the grid overlay can
    // toggle on/off without disturbing an image background. Sits in the
    // default overlayPane (z=400) so its lines render on top of the image
    // (z=180) but under pins (z=600).
    this.gridLayer = L.layerGroup().addTo(this.map);
    this.connectionsLayer = L.layerGroup().addTo(this.map);
    this.pinsLayer = L.layerGroup().addTo(this.map);
    this.labelsLayer = L.layerGroup().addTo(this.map);

    // Set up map click handler
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      const point = leafletToStorage(e.latlng, this.config.canvasHeight);
      this.emit('map-click', {
        latlng: e.latlng,
        point,
        originalEvent: e
      });
    });

    this.log('Initialization complete');
    this.emit('ready');
  }

  // ============================================
  // BACKGROUND
  // ============================================

  /**
   * Set a background image. `onError` fires once if the browser cannot load
   * the URL (404, CORS, dead host) — callers can fall back to the flat
   * canvas instead of leaving Leaflet's broken-image void (S300b).
   */
  setBackgroundImage(url: string, width?: number, height?: number, onError?: () => void): void {
    if (!this.map || !this.backgroundLayer) return;

    this.backgroundLayer.clearLayers();

    const imgWidth = width || this.config.canvasWidth;
    const imgHeight = height || this.config.canvasHeight;

    // Image bounds in Leaflet coordinates
    const bounds: L.LatLngBoundsExpression = [
      [0, 0],
      [imgHeight, imgWidth]
    ];

    // Render into the low-z custom pane so the image never obscures zones,
    // pins, grid, or transient drawing UI regardless of DOM insertion order.
    const overlay = L.imageOverlay(url, bounds, { pane: 'atlasBgImagePane' });
    if (onError) overlay.once('error', onError);
    overlay.addTo(this.backgroundLayer);
    this.log('Background image set:', url);
  }

  /**
   * Render a grid as the SOLE background (replaces any existing image).
   *
   * Used when a map has no image — the grid fills the canvas as visual scaffolding.
   * Clears the backgroundLayer. **DO NOT call this when a map has an image** —
   * use `setGridOverlay` instead, which renders the grid as a non-destructive
   * translucent overlay above whatever background is set.
   */
  setBackgroundGrid(spacing: number = 100, color: string = 'rgba(34, 211, 238, 0.1)'): void {
    if (!this.map || !this.backgroundLayer) return;

    this.backgroundLayer.clearLayers();
    this.drawGridLines(this.backgroundLayer, spacing, color);

    this.log('Background grid set');
  }

  /**
   * Render a flat colored canvas as the SOLE background (replaces any image).
   *
   * The imageless-map backdrop (DESIGN_MAPS.md §4.2): one rectangle spanning
   * the full canvas bounds — fill delineates the map space against the app
   * background, hairline stroke marks the edge. The ⚙ grid overlay composes
   * on top via setGridOverlay (separate layer) for users who want scaffolding.
   */
  setBackgroundFlat(
    fillColor: string = 'rgba(255, 255, 255, 0.04)',
    strokeColor: string = 'rgba(34, 211, 238, 0.22)',
  ): void {
    if (!this.map || !this.backgroundLayer) return;
    this.backgroundLayer.clearLayers();
    // interactive: false — the rect spans the whole canvas; if it captured
    // pointer events it would sit under every pin-placement click.
    L.rectangle(
      [[0, 0], [this.config.canvasHeight, this.config.canvasWidth]],
      { color: strokeColor, weight: 1, fillColor, fillOpacity: 1, pane: 'atlasBgImagePane', interactive: false },
    ).addTo(this.backgroundLayer);
    this.log('Background flat canvas set');
  }

  /**
   * Render a grid as a TRANSLUCENT OVERLAY on top of any existing background.
   *
   * Used by the canvas toolbar's "show grid" toggle (DESIGN_MAPS.md §11) when
   * the map already has an image background — the grid lines overlay on top
   * without clearing the image. Idempotent — calling repeatedly replaces the
   * previous grid overlay.
   */
  setGridOverlay(spacing: number = 100, color: string = 'rgba(34, 211, 238, 0.32)'): void {
    if (!this.map || !this.gridLayer) return;
    this.gridLayer.clearLayers();
    this.drawGridLines(this.gridLayer, spacing, color);
  }

  /** Remove the grid overlay, leaving the background image (if any) intact. */
  clearGridOverlay(): void {
    if (!this.gridLayer) return;
    this.gridLayer.clearLayers();
  }

  private drawGridLines(target: L.LayerGroup, spacing: number, color: string): void {
    // Vertical lines
    for (let x = 0; x <= this.config.canvasWidth; x += spacing) {
      L.polyline(
        [[0, x], [this.config.canvasHeight, x]],
        { color, weight: 1, opacity: 1 }
      ).addTo(target);
    }
    // Horizontal lines
    for (let y = 0; y <= this.config.canvasHeight; y += spacing) {
      L.polyline(
        [[y, 0], [y, this.config.canvasWidth]],
        { color, weight: 1, opacity: 1 }
      ).addTo(target);
    }
  }

  /**
   * Clear background
   */
  clearBackground(): void {
    if (this.backgroundLayer) {
      this.backgroundLayer.clearLayers();
    }
  }

  // ============================================
  // ICON PRELOADING
  // ============================================

  /**
   * Preload icons for better performance
   */
  async preloadIcons(urls: string[]): Promise<void> {
    const uniqueUrls = [...new Set(urls)].filter(url => !this.preloadedIcons.has(url));

    this.log(`Preloading ${uniqueUrls.length} icons...`);

    const loadPromises = uniqueUrls.map(url => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          this.preloadedIcons.add(url);
          resolve();
        };
        img.onerror = () => {
          // Silent fail for missing icons
          resolve();
        };
        img.src = url;
      });
    });

    await Promise.all(loadPromises);
    this.log(`Icons preloaded: ${this.preloadedIcons.size}`);
  }

  // ============================================
  // PIN MANAGEMENT
  // ============================================

  /**
   * Add a pin to the map
   */
  addPin(data: PinData): Pin2D {
    if (!this.map || !this.pinsLayer || !this.labelsLayer) {
      throw new Error('Manager not initialized. Call init() first.');
    }

    // Check for duplicate
    if (this.pins.has(data.id)) {
      this.log(`Pin ${data.id} already exists, updating instead`);
      return this.updatePin(data.id, data);
    }

    const latlng = storageToLeaflet({ x: data.x, y: data.y }, this.config.canvasHeight);
    const iconUrl = data.icon || `/icons/${data.type}.png`;
    const iconSize = (data.scale || 1) * this.config.defaultIconSize;

    // Anchor — 'center' default; 'bottom-tip' for teardrop pin-shape so the
    // visible point aligns with the latlng. (atlas pin_style consumer in
    // syncPins picks this.)
    const iconAnchorXY = computeIconAnchor(iconSize, data.anchor ?? 'center');

    // Create marker
    const marker = L.marker(latlng, {
      icon: L.icon({
        iconUrl,
        iconSize: [iconSize, iconSize],
        iconAnchor: iconAnchorXY
      })
    });

    // Create label — anchored to the pin's latlng with PIXEL-space iconAnchor so
    // the gap stays constant across zoom levels. (defaultLabelOffset is treated
    // as a pixel gap below the pin's bottom edge.)
    let label: L.Marker | undefined;
    if (this.config.showLabels) {
      const labelText = data.label || data.name;
      // iconAnchor Y = negative pushes icon DOWN from latlng. Distance = pin half + gap.
      const pinHalf = iconSize / 2;
      const labelAnchorY = -(pinHalf + this.config.defaultLabelOffset);
      label = L.marker(latlng, {
        icon: L.divIcon({
          className: 'leaflet-2d-pin-label',
          html: `<span class="pin-label-text">${labelText}</span>`,
          iconSize: [150, 24],
          iconAnchor: [75, labelAnchorY]
        }),
        interactive: false
      });
    }

    // Create pin object
    const pin: Pin2D = {
      id: data.id,
      x: data.x,
      y: data.y,
      marker,
      label,
      data,
      visible: data.visible !== false
    };

    // Set up event handlers
    marker.on('click', (e: L.LeafletMouseEvent) => {
      this.emit('pin-click', { pin, originalEvent: e });
    });

    marker.on('mouseover', (e: L.LeafletMouseEvent) => {
      this.emit('pin-hover', { pin, originalEvent: e });
    });

    marker.on('mouseout', (e: L.LeafletMouseEvent) => {
      this.emit('pin-hover-end', { pin, originalEvent: e });
    });

    marker.on('contextmenu', (e: L.LeafletMouseEvent) => {
      // Block the map-level contextmenu so consumers (atlas's ghost-pin
      // toggle) get clean per-pin events without also opening the map's
      // "new pin" modal that fires on map.contextmenu.
      L.DomEvent.stop(e.originalEvent ?? (e as unknown as Event));
      this.emit('pin-contextmenu', { pin, originalEvent: e });
    });

    // Add to map if visible
    if (pin.visible) {
      marker.addTo(this.pinsLayer);
      if (label) {
        label.addTo(this.labelsLayer);
      }
    }

    this.pins.set(data.id, pin);
    this.emit('pin-added', pin);
    this.log(`Pin added: ${data.id}`);

    return pin;
  }

  /**
   * Remove a pin from the map
   */
  removePin(id: string): boolean {
    const pin = this.pins.get(id);
    if (!pin) return false;

    pin.marker.remove();
    if (pin.label) {
      pin.label.remove();
    }

    // Remove any connections to/from this pin
    this.connections.forEach((conn, connId) => {
      if (conn.fromId === id || conn.toId === id) {
        this.removeConnection(connId);
      }
    });

    this.pins.delete(id);
    this.emit('pin-removed', id);
    this.log(`Pin removed: ${id}`);

    return true;
  }

  /**
   * Update a pin's data and/or position
   */
  updatePin(id: string, updates: Partial<PinData>): Pin2D {
    const pin = this.pins.get(id);
    if (!pin) {
      throw new Error(`Pin not found: ${id}`);
    }

    // Update data
    Object.assign(pin.data, updates);

    // Update position if changed
    if (updates.x !== undefined || updates.y !== undefined) {
      pin.x = updates.x ?? pin.x;
      pin.y = updates.y ?? pin.y;
      const newLatLng = storageToLeaflet({ x: pin.x, y: pin.y }, this.config.canvasHeight);
      pin.marker.setLatLng(newLatLng);
      if (pin.label) {
        // Label is anchored to the pin's latlng — pixel offset is in the icon,
        // not the latlng. Just keep them in sync.
        pin.label.setLatLng(newLatLng);
      }

      // Update connections
      this.updateConnectionsForPin(id);
    }

    // Update icon if changed
    if (updates.icon || updates.scale || updates.anchor) {
      const iconUrl = updates.icon || pin.data.icon || `/icons/${pin.data.type}.png`;
      const iconSize = (updates.scale || pin.data.scale || 1) * this.config.defaultIconSize;
      const anchorChoice = updates.anchor ?? pin.data.anchor ?? 'center';
      const iconAnchorXY = computeIconAnchor(iconSize, anchorChoice);
      pin.marker.setIcon(L.icon({
        iconUrl,
        iconSize: [iconSize, iconSize],
        iconAnchor: iconAnchorXY
      }));
    }

    // Update label if changed
    if ((updates.label || updates.name) && pin.label) {
      const labelText = updates.label || updates.name || pin.data.name;
      const labelElement = pin.label.getElement();
      if (labelElement) {
        const textSpan = labelElement.querySelector('.pin-label-text');
        if (textSpan) {
          textSpan.textContent = labelText;
        }
      }
    }

    this.log(`Pin updated: ${id}`);
    return pin;
  }

  /**
   * Get a pin by ID
   */
  getPin(id: string): Pin2D | undefined {
    return this.pins.get(id);
  }

  /**
   * Get all pins
   */
  getAllPins(): Pin2D[] {
    return Array.from(this.pins.values());
  }

  /**
   * Get visible pins
   */
  getVisiblePins(): Pin2D[] {
    return this.getAllPins().filter(p => p.visible);
  }

  /**
   * Clear all pins
   */
  clearPins(): void {
    this.pins.forEach((_, id) => this.removePin(id));
    this.log('All pins cleared');
  }

  // ============================================
  // PIN VISIBILITY
  // ============================================

  /**
   * Show specific pins (add to map)
   */
  showPins(ids: string[]): void {
    ids.forEach(id => {
      const pin = this.pins.get(id);
      if (pin && !pin.visible) {
        pin.visible = true;
        if (this.pinsLayer) pin.marker.addTo(this.pinsLayer);
        if (this.labelsLayer && pin.label) pin.label.addTo(this.labelsLayer);
      }
    });
    this.updateConnectionVisibility();
  }

  /**
   * Hide specific pins (remove from map but keep in memory)
   */
  hidePins(ids: string[]): void {
    ids.forEach(id => {
      const pin = this.pins.get(id);
      if (pin && pin.visible) {
        pin.visible = false;
        pin.marker.remove();
        if (pin.label) pin.label.remove();
      }
    });
    this.updateConnectionVisibility();
  }

  /**
   * Show all pins
   */
  showAllPins(): void {
    this.showPins(Array.from(this.pins.keys()));
  }

  /**
   * Hide all pins
   */
  hideAllPins(): void {
    this.hidePins(Array.from(this.pins.keys()));
  }

  /**
   * Set visibility atomically (show only these pins, hide all others)
   */
  setPinVisibility(visibleIds: string[]): void {
    const visibleSet = new Set(visibleIds);

    this.pins.forEach((pin, id) => {
      const shouldBeVisible = visibleSet.has(id);

      if (shouldBeVisible && !pin.visible) {
        pin.visible = true;
        if (this.pinsLayer) pin.marker.addTo(this.pinsLayer);
        if (this.labelsLayer && pin.label) pin.label.addTo(this.labelsLayer);
      } else if (!shouldBeVisible && pin.visible) {
        pin.visible = false;
        pin.marker.remove();
        if (pin.label) pin.label.remove();
      }
    });

    this.updateConnectionVisibility();
    this.log(`Visibility updated: ${visibleIds.length} pins visible`);
  }

  // ============================================
  // CONNECTIONS
  // ============================================

  /**
   * Add a connection between two pins
   */
  addConnection(fromId: string, toId: string, style?: ConnectionStyle): Connection | null {
    if (!this.map || !this.connectionsLayer) return null;

    const fromPin = this.pins.get(fromId);
    const toPin = this.pins.get(toId);

    if (!fromPin || !toPin) {
      this.log(`Cannot create connection: pin not found (${fromId} -> ${toId})`);
      return null;
    }

    const connId = `${fromId}->${toId}`;

    // Check for existing connection
    if (this.connections.has(connId)) {
      this.log(`Connection already exists: ${connId}`);
      return this.connections.get(connId)!;
    }

    const mergedStyle: ConnectionStyle = {
      ...this.config.defaultConnectionStyle,
      ...style
    };

    const line = L.polyline(
      [fromPin.marker.getLatLng(), toPin.marker.getLatLng()],
      {
        color: mergedStyle.color,
        weight: mergedStyle.weight,
        opacity: mergedStyle.opacity,
        dashArray: mergedStyle.dashArray
      }
    );

    const connection: Connection = {
      id: connId,
      fromId,
      toId,
      line,
      style: mergedStyle
    };

    // Only show if both pins are visible
    if (fromPin.visible && toPin.visible) {
      line.addTo(this.connectionsLayer);
    }

    this.connections.set(connId, connection);
    this.emit('connection-added', connection);
    this.log(`Connection added: ${connId}`);

    return connection;
  }

  /**
   * Remove a connection
   */
  removeConnection(id: string): boolean {
    const connection = this.connections.get(id);
    if (!connection) return false;

    connection.line.remove();
    this.connections.delete(id);
    this.emit('connection-removed', id);
    this.log(`Connection removed: ${id}`);

    return true;
  }

  /**
   * Remove connection between two pins (by pin IDs)
   */
  removeConnectionBetween(fromId: string, toId: string): boolean {
    const connId = `${fromId}->${toId}`;
    return this.removeConnection(connId);
  }

  /**
   * Clear all connections
   */
  clearConnections(): void {
    this.connections.forEach((_, id) => this.removeConnection(id));
    this.log('All connections cleared');
  }

  /**
   * Get all connections
   */
  getAllConnections(): Connection[] {
    return Array.from(this.connections.values());
  }

  /**
   * Update connection positions when a pin moves
   */
  private updateConnectionsForPin(pinId: string): void {
    const pin = this.pins.get(pinId);
    if (!pin) return;

    this.connections.forEach(conn => {
      if (conn.fromId === pinId || conn.toId === pinId) {
        const fromPin = this.pins.get(conn.fromId);
        const toPin = this.pins.get(conn.toId);
        if (fromPin && toPin) {
          conn.line.setLatLngs([
            fromPin.marker.getLatLng(),
            toPin.marker.getLatLng()
          ]);
        }
      }
    });
  }

  /**
   * Update connection visibility based on pin visibility
   */
  private updateConnectionVisibility(): void {
    if (!this.connectionsLayer) return;

    this.connections.forEach(conn => {
      const fromPin = this.pins.get(conn.fromId);
      const toPin = this.pins.get(conn.toId);
      const bothVisible = fromPin?.visible && toPin?.visible;

      if (bothVisible && !this.connectionsLayer!.hasLayer(conn.line)) {
        conn.line.addTo(this.connectionsLayer!);
      } else if (!bothVisible && this.connectionsLayer!.hasLayer(conn.line)) {
        conn.line.remove();
      }
    });
  }

  // ============================================
  // CAMERA CONTROL
  // ============================================

  /**
   * Pan to a position (storage coordinates)
   */
  panTo(x: number, y: number, options?: { duration?: number; animate?: boolean }): void {
    if (!this.map) return;

    const latlng = storageToLeaflet({ x, y }, this.config.canvasHeight);
    this.map.panTo(latlng, {
      animate: options?.animate ?? true,
      duration: (options?.duration ?? 300) / 1000
    });
  }

  /**
   * Pan to a specific pin
   */
  panToPin(id: string, options?: { duration?: number; animate?: boolean }): void {
    const pin = this.pins.get(id);
    if (pin) {
      this.panTo(pin.x, pin.y, options);
    }
  }

  /**
   * Fit view to show all visible pins
   */
  fitBounds(padding?: number, maxZoom?: number): void {
    if (!this.map) return;

    const visiblePins = this.getVisiblePins();
    if (visiblePins.length === 0) return;

    const latlngs = visiblePins.map(p => p.marker.getLatLng());
    const bounds = L.latLngBounds(latlngs);

    const opts: L.FitBoundsOptions = {
      padding: [padding ?? 50, padding ?? 50],
    };
    if (typeof maxZoom === 'number') opts.maxZoom = maxZoom;

    this.map.fitBounds(bounds, opts);
  }

  /**
   * Fit view to the canvas (entire image / world bounds).
   *
   * Unlike fitBounds() which fits to visible pins, this fits to the
   * full canvas defined by canvasWidth × canvasHeight. Used by the
   * canvas toolbar's "fit to image" button (DESIGN_MAPS.md §12).
   */
  fitToCanvas(padding: number = 20): void {
    if (!this.map) return;
    const sw = storageToLeaflet({ x: 0, y: this.config.canvasHeight }, this.config.canvasHeight);
    const ne = storageToLeaflet({ x: this.config.canvasWidth, y: 0 }, this.config.canvasHeight);
    const bounds = L.latLngBounds(sw, ne);
    this.map.fitBounds(bounds, { padding: [padding, padding] });
  }

  /**
   * Show or hide the pins layer in bulk (DESIGN_MAPS.md §12 toolbar
   * declutter toggle). Transient — not persisted to prefs. Markers remain
   * in memory; the layer is just detached/attached.
   */
  setPinsLayerVisible(visible: boolean): void {
    if (!this.map || !this.pinsLayer) return;
    if (visible) {
      if (!this.map.hasLayer(this.pinsLayer)) this.map.addLayer(this.pinsLayer);
      if (this.labelsLayer && !this.map.hasLayer(this.labelsLayer)) {
        this.map.addLayer(this.labelsLayer);
      }
    } else {
      if (this.map.hasLayer(this.pinsLayer)) this.map.removeLayer(this.pinsLayer);
      if (this.labelsLayer && this.map.hasLayer(this.labelsLayer)) {
        this.map.removeLayer(this.labelsLayer);
      }
    }
  }

  /**
   * Fit view to specific pins
   */
  fitToPins(ids: string[], padding?: number): void {
    if (!this.map) return;

    const pins = ids.map(id => this.pins.get(id)).filter(Boolean) as Pin2D[];
    if (pins.length === 0) return;

    const latlngs = pins.map(p => p.marker.getLatLng());
    const bounds = L.latLngBounds(latlngs);

    this.map.fitBounds(bounds, {
      padding: [padding ?? 50, padding ?? 50]
    });
  }

  /**
   * Set zoom level
   */
  setZoom(zoom: number): void {
    if (!this.map || this.config.fixedZoom) return;
    this.map.setZoom(zoom);
  }

  /**
   * Get current zoom level
   */
  getZoom(): number {
    return this.map?.getZoom() ?? this.config.initialZoom;
  }

  /**
   * Get current center (storage coordinates)
   */
  getCenter(): StoragePoint {
    if (!this.map) return { x: 0, y: 0 };
    return leafletToStorage(this.map.getCenter(), this.config.canvasHeight);
  }

  // ============================================
  // EVENTS
  // ============================================

  /**
   * Register an event callback
   */
  on<K extends Leaflet2DEventType>(event: K, callback: EventCallbacks[K]): void {
    if (!this.eventCallbacks[event]) {
      this.eventCallbacks[event] = [];
    }
    (this.eventCallbacks[event] as EventCallbacks[K][]).push(callback);
  }

  /**
   * Remove an event callback
   */
  off<K extends Leaflet2DEventType>(event: K, callback: EventCallbacks[K]): void {
    const callbacks = this.eventCallbacks[event];
    if (callbacks) {
      const index = (callbacks as EventCallbacks[K][]).indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event
   */
  private emit<K extends Leaflet2DEventType>(event: K, data?: Parameters<EventCallbacks[K]>[0]): void {
    const callbacks = this.eventCallbacks[event];
    if (callbacks) {
      callbacks.forEach(cb => {
        (cb as (data?: unknown) => void)(data);
      });
    }
  }

  // ============================================
  // UTILITY
  // ============================================

  /**
   * Convert storage coordinates to Leaflet LatLng
   */
  toLeafletCoords(point: StoragePoint): L.LatLng {
    return storageToLeaflet(point, this.config.canvasHeight);
  }

  /**
   * Convert Leaflet LatLng to storage coordinates
   */
  toStorageCoords(latlng: L.LatLng): StoragePoint {
    return leafletToStorage(latlng, this.config.canvasHeight);
  }

  /**
   * Get the Leaflet map instance (for advanced usage)
   */
  getMap(): L.Map | null {
    return this.map;
  }

  /**
   * Get configuration
   */
  getConfig(): ResolvedLeaflet2DConfig {
    return { ...this.config };
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.map !== null;
  }

  // ============================================
  // CLEANUP
  // ============================================

  /**
   * Destroy the manager and clean up resources
   */
  destroy(): void {
    this.log('Destroying Leaflet2DManager...');

    // Clear all data
    this.clearPins();
    this.clearConnections();
    this.clearBackground();

    // Remove map
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    // Clear layers
    this.backgroundLayer = null;
    this.connectionsLayer = null;
    this.pinsLayer = null;
    this.labelsLayer = null;

    // Clear callbacks
    this.eventCallbacks = {};

    this.log('Destroyed');
  }

  // ============================================
  // DEBUG
  // ============================================

  private log(...args: unknown[]): void {
    if (this.config.debug) {
      console.log('[Leaflet2D]', ...args);
    }
  }
}
