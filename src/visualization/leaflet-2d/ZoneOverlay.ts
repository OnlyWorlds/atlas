/**
 * ZoneOverlay — manages zone polygon/polyline rendering on a Leaflet map.
 *
 * Separate from Leaflet2DManager (pin-focused) to keep concerns clean. The
 * overlay reads zone definitions from the caller and renders them to a
 * dedicated LayerGroup on the supplied map. By default zone shapes sit in
 * Leaflet's `overlayPane` (z-index 400) — below the markerPane (z-index 600)
 * — so they render BELOW pins automatically without manual z-order work.
 *
 * For LINE zones an invisible "hit-overlay" polyline (20px stroke, opacity 0)
 * accompanies the visible 2px line so click target is comfortable. Polygons
 * use Leaflet's native fill click — no hit-overlay needed.
 *
 * Coords on input are storage-space (top-left origin, y grows down) — the
 * same coord space as Marker.x / Marker.y. Conversion to Leaflet LatLng
 * happens inside the overlay.
 */

import L from 'leaflet';
import { storageToLeaflet } from './CoordinateUtils';
import type { Point } from './ZoneGeometry';

const DEFAULT_COLOR = '#22d3ee';
const DEFAULT_OPACITY = 0.4;
const SELECTED_WEIGHT = 3;
const UNSELECTED_WEIGHT = 2;
const LINE_HIT_WEIGHT = 20;

export interface ZoneShape {
  id: string;
  mode: 'polygon' | 'line';
  points: Point[];          // storage-space coords
  color?: string;           // hex, defaults to DEFAULT_COLOR
  opacity?: number;         // 0..1, defaults to DEFAULT_OPACITY
  labelText?: string;       // optional label rendered at centroid / line midpoint
}

interface ZoneEntry {
  // L.Polygon extends L.Polyline at runtime, but @types/leaflet parameterizes
  // them differently on the GeoJSON geometry generic. We widen to L.Path
  // (the common ancestor with setStyle) for type-checking; both polygon and
  // polyline subclass it.
  visibleLayer: L.Path;
  hitLayer?: L.Polyline;    // invisible polyline for line hit-testing
  labelMarker?: L.Marker;
  /**
   * Vertex dots rendered when the zone is selected (DESIGN_ZONES.md §4.3).
   * Read-only here — they become drag handles in edit mode via a separate
   * module (`zone-edit-mode.ts`) which TEMPORARILY hides these dots while
   * its own draggable handles render in their place at the same coords.
   *
   * Implementation: L.Marker + DivIcon (HTML in markerPane), NOT L.CircleMarker
   * (SVG in overlayPane). Using the same primitive as edit-mode handles
   * ensures consistent sub-pixel rendering — circleMarker vs divIcon in
   * different panes was visually misaligned in smoke (session 215).
   */
  vertexDots: L.Marker[];
  /**
   * When true, the vertex dots are suppressed by the edit module — its own
   * draggable handles take over at the same coords. Polygon outline + glow
   * remain visible (selection is unchanged). Default false.
   */
  vertexDotsSuppressed: boolean;
  shape: ZoneShape;
  selected: boolean;
  visible: boolean;
}

type ZoneClickHandler = (zoneId: string, event: L.LeafletMouseEvent) => void;
type ZoneContextHandler = (zoneId: string, event: L.LeafletMouseEvent) => void;
type ZoneDblClickHandler = (zoneId: string, event: L.LeafletMouseEvent) => void;

export class ZoneOverlay {
  private layerGroup: L.LayerGroup;
  private entries = new Map<string, ZoneEntry>();
  private layerVisible = true;
  private onClick?: ZoneClickHandler;
  private onContext?: ZoneContextHandler;
  private onDblClick?: ZoneDblClickHandler;

  constructor(
    private map: L.Map,
    private canvasHeight: number,
  ) {
    this.layerGroup = L.layerGroup().addTo(this.map);
  }

  /** Add or replace a zone shape. Idempotent — calling twice for the same id replaces. */
  addZone(shape: ZoneShape): void {
    if (this.entries.has(shape.id)) {
      this.updateZone(shape.id, shape);
      return;
    }
    const entry = this.buildEntry(shape);
    this.entries.set(shape.id, entry);
    if (!this.layerVisible) entry.visibleLayer.setStyle({ opacity: 0, fillOpacity: 0 });
  }

  /** Update a zone's points / color / opacity / label. */
  updateZone(id: string, patch: Partial<ZoneShape>): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const nextShape: ZoneShape = { ...entry.shape, ...patch };

    // Geometry change?
    const pointsChanged =
      patch.points !== undefined &&
      !pointsEqual(entry.shape.points, patch.points);
    const modeChanged = patch.mode !== undefined && patch.mode !== entry.shape.mode;

    if (pointsChanged || modeChanged) {
      // Rebuild shape (cheaper than mutating Leaflet primitives).
      this.removeZone(id);
      this.addZone(nextShape);
      // Preserve selection.
      if (entry.selected) this.setZoneSelected(id, true);
      return;
    }

    // Style-only update.
    entry.shape = nextShape;
    this.applyStyle(entry);
    if (entry.labelMarker && patch.labelText !== undefined) {
      entry.labelMarker.setIcon(this.buildLabelIcon(patch.labelText));
    }
  }

  removeZone(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.hideVertexDots(entry);
    this.layerGroup.removeLayer(entry.visibleLayer);
    if (entry.hitLayer) this.layerGroup.removeLayer(entry.hitLayer);
    if (entry.labelMarker) this.layerGroup.removeLayer(entry.labelMarker);
    this.entries.delete(id);
  }

  setZoneSelected(id: string, selected: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.selected = selected;
    this.applyStyle(entry);
  }

  setZoneVisible(id: string, visible: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.visible = visible;
    this.applyStyle(entry);
  }

  /** Toggle the entire zones layer (used by canvas toolbar "show/hide zones"). */
  setLayerVisible(visible: boolean): void {
    this.layerVisible = visible;
    for (const entry of this.entries.values()) {
      this.applyStyle(entry);
    }
  }

  isLayerVisible(): boolean {
    return this.layerVisible;
  }

  /** Number of zones currently rendered. */
  count(): number {
    return this.entries.size;
  }

  hasZone(id: string): boolean {
    return this.entries.has(id);
  }

  onZoneClick(handler: ZoneClickHandler): void {
    this.onClick = handler;
  }

  onZoneContextMenu(handler: ZoneContextHandler): void {
    this.onContext = handler;
  }

  onZoneDoubleClick(handler: ZoneDblClickHandler): void {
    this.onDblClick = handler;
  }

  /** Tear down — removes all layers and event subscriptions. */
  dispose(): void {
    for (const id of Array.from(this.entries.keys())) this.removeZone(id);
    this.map.removeLayer(this.layerGroup);
  }

  // ----- internals -----

  private buildEntry(shape: ZoneShape): ZoneEntry {
    const latLngs = shape.points.map(p => storageToLeaflet(p, this.canvasHeight));
    const color = shape.color ?? DEFAULT_COLOR;
    const opacity = shape.opacity ?? DEFAULT_OPACITY;

    let visibleLayer: L.Path;
    let hitLayer: L.Polyline | undefined;

    if (shape.mode === 'polygon') {
      visibleLayer = L.polygon(latLngs, {
        color,
        fillColor: color,
        fillOpacity: opacity,
        weight: UNSELECTED_WEIGHT,
        opacity: 0.9,
      });
    } else {
      visibleLayer = L.polyline(latLngs, {
        color,
        weight: UNSELECTED_WEIGHT,
        opacity: 0.9,
      });
      // Invisible hit-overlay for line zones (wider click target).
      hitLayer = L.polyline(latLngs, {
        color: '#000000',
        weight: LINE_HIT_WEIGHT,
        opacity: 0,
        interactive: true,
      });
    }

    visibleLayer.addTo(this.layerGroup);
    hitLayer?.addTo(this.layerGroup);

    // Wire interaction handlers. Both the visible and hit layers forward
    // clicks to the same zone callback. Leaflet natively suppresses the
    // single `click` event that would otherwise precede a `dblclick`, so
    // separate handlers don't need a manual timeout dance.
    const wire = (layer: L.Layer) => {
      layer.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        this.onClick?.(shape.id, e);
      });
      layer.on('dblclick', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        this.onDblClick?.(shape.id, e);
      });
      layer.on('contextmenu', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        this.onContext?.(shape.id, e);
      });
    };
    wire(visibleLayer);
    if (hitLayer) wire(hitLayer);

    const entry: ZoneEntry = {
      visibleLayer,
      hitLayer,
      shape,
      selected: false,
      visible: true,
      vertexDots: [],
      vertexDotsSuppressed: false,
    };

    if (shape.labelText) {
      entry.labelMarker = this.buildLabelMarker(shape);
      entry.labelMarker.addTo(this.layerGroup);
    }

    return entry;
  }

  /**
   * Show vertex dots on a selected zone. Each marker position gets a small
   * cyan dot rendered above the polygon. Read-only — drag-edit handles are
   * rendered by the edit module which suppresses these dots via
   * `setVertexDotsSuppressed`. Idempotent — calling repeatedly rebuilds.
   *
   * Uses L.Marker + DivIcon (NOT L.CircleMarker) so the dots render in
   * markerPane alongside any edit-mode handles, ensuring identical
   * sub-pixel positioning between the two visual states.
   */
  private showVertexDots(entry: ZoneEntry): void {
    this.hideVertexDots(entry);
    if (entry.vertexDotsSuppressed) return;
    // Vertex dots include their 1-indexed order number so you can see at a
    // glance which marker is which (matches the edit-mode handles and the
    // draft-mode markers — same visual language across all three states).
    entry.shape.points.forEach((p, i) => {
      const latlng = storageToLeaflet(p, this.canvasHeight);
      const displayOrder = i + 1;
      const icon = L.divIcon({
        className: 'atlas-zone-vertex-dot',
        html: `<span class="atlas-zone-vertex-dot-num">${displayOrder}</span>`,
        iconSize: [12, 12],
        iconAnchor: [6, 6],
      });
      const dot = L.marker(latlng, {
        icon,
        interactive: false,
        keyboard: false,
      });
      dot.addTo(this.layerGroup);
      entry.vertexDots.push(dot);
    });
  }

  private hideVertexDots(entry: ZoneEntry): void {
    for (const d of entry.vertexDots) {
      this.layerGroup.removeLayer(d);
    }
    entry.vertexDots = [];
  }

  /**
   * Suppress / unsuppress the read-only vertex dots for a zone. Called by
   * the edit module on enter (suppress, then render its own draggable
   * handles in their place) and exit (unsuppress, dots come back).
   *
   * Polygon outline + selection glow remain unchanged.
   */
  setVertexDotsSuppressed(id: string, suppressed: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.vertexDotsSuppressed === suppressed) return;
    entry.vertexDotsSuppressed = suppressed;
    if (suppressed) {
      this.hideVertexDots(entry);
    } else if (entry.selected) {
      this.showVertexDots(entry);
    }
  }

  private applyStyle(entry: ZoneEntry): void {
    const color = entry.shape.color ?? DEFAULT_COLOR;
    const opacity = entry.shape.opacity ?? DEFAULT_OPACITY;
    const showShape = entry.visible && this.layerVisible;
    const weight = entry.selected ? SELECTED_WEIGHT : UNSELECTED_WEIGHT;
    const style: L.PathOptions = {
      color,
      weight,
      opacity: showShape ? (entry.selected ? 1 : 0.9) : 0,
    };
    if (entry.shape.mode === 'polygon') {
      style.fillColor = color;
      style.fillOpacity = showShape ? opacity : 0;
    }
    entry.visibleLayer.setStyle(style);
    if (entry.labelMarker) {
      const labelEl = entry.labelMarker.getElement();
      if (labelEl) {
        (labelEl as HTMLElement).style.opacity = showShape ? '1' : '0';
      }
    }
    // Selected styling: drop-shadow glow on the SVG path + show vertex dots.
    // The glow uses a CSS class on the underlying SVG element so it can be
    // toggled without re-applying style on every notification.
    const visibleEl = (entry.visibleLayer as L.Path & { _path?: SVGElement })._path;
    if (visibleEl) {
      if (entry.selected && showShape) {
        visibleEl.classList.add('atlas-zone-selected');
      } else {
        visibleEl.classList.remove('atlas-zone-selected');
      }
    }
    if (entry.selected && showShape) {
      this.showVertexDots(entry);
    } else {
      this.hideVertexDots(entry);
    }
  }

  private buildLabelMarker(shape: ZoneShape): L.Marker {
    const anchor = shape.mode === 'polygon'
      ? centroid(shape.points)
      : lineMidAnchor(shape.points);
    const latlng = storageToLeaflet(anchor, this.canvasHeight);
    return L.marker(latlng, {
      icon: this.buildLabelIcon(shape.labelText ?? ''),
      interactive: false,
      keyboard: false,
    });
  }

  private buildLabelIcon(text: string): L.DivIcon {
    const safe = escapeHtml(text);
    return L.divIcon({
      className: 'atlas-zone-label',
      html: `<span>${safe}</span>`,
      iconSize: undefined as unknown as L.PointExpression,
      iconAnchor: [0, 0] as L.PointTuple,
    });
  }
}

function pointsEqual(a: Point[], b: Point[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].x !== b[i].x || a[i].y !== b[i].y) return false;
  }
  return true;
}

function centroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / points.length, y: sy / points.length };
}

function lineMidAnchor(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  let bestIdx = 0;
  let bestLen2 = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    const l2 = dx * dx + dy * dy;
    if (l2 > bestLen2) {
      bestLen2 = l2;
      bestIdx = i;
    }
  }
  const a = points[bestIdx];
  const b = points[bestIdx + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}
