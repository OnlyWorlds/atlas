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

// Lazy-init shared SVG renderer for zone shapes. Stored per-map at module
// level because each Leaflet map needs its own renderer instance, but
// within a single map all zones share. Map keyed by the L.Map instance.
const svgRendererByMap = new WeakMap<L.Map, L.Renderer>();
function getZoneSvgRendererForMap(map: L.Map): L.Renderer {
  let r = svgRendererByMap.get(map);
  if (!r) {
    r = L.svg({ pane: 'overlayPane' });
    svgRendererByMap.set(map, r);
  }
  return r;
}

export interface ZoneShape {
  id: string;
  mode: 'polygon' | 'line';
  points: Point[];          // storage-space coords
  color?: string;           // hex, defaults to DEFAULT_COLOR
  opacity?: number;         // 0..1, defaults to DEFAULT_OPACITY
  labelText?: string;       // optional label rendered at centroid / line midpoint
  /**
   * When true, the label exists in the DOM but starts hidden; mouseover on
   * the zone outline (or hit-overlay for lines) fades it in, mouseout fades
   * it out. When false/undefined, label visibility follows the zone's normal
   * visible state (always visible when zone visible). Captain session 219:
   * 'hover' zone_labels mode now actually does something.
   */
  labelHoverOnly?: boolean;
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
  /**
   * Mirrors the editing state for THIS zone. Set by `setZoneEditing` from
   * zone-edit-mode on enter/exit. When true, applyStyle renders the outline
   * dashed (parity with create-mode preview, ZC6).
   */
  editing: boolean;
  /**
   * When the user is hovering this zone's outline (or its hit-overlay for
   * line zones). Toggled by mouseover/out handlers wired in buildEntry.
   * Used by applyStyle to fade hover-only labels in/out.
   */
  hovered: boolean;
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

    if (modeChanged) {
      // Mode change → rebuild (different primitive: polygon vs polyline).
      this.removeZone(id);
      this.addZone(nextShape);
      if (entry.selected) this.setZoneSelected(id, true);
      return;
    }
    if (pointsChanged && patch.points) {
      // Points-only change — mutate the existing SVG path in place via
      // setLatLngs. Avoids the dragend visual flicker the previous rebuild
      // path caused (Captain smoke session 219: "in editmode, when i drag a
      // marker, the lines look a bit glitchy"). The handlers and selection
      // state stay intact since the primitive doesn't change.
      const latLngs = patch.points.map(p => storageToLeaflet(p, this.canvasHeight));
      const layer = entry.visibleLayer as L.Path & {
        setLatLngs?: (latlngs: L.LatLng[]) => void;
      };
      if (typeof layer.setLatLngs === 'function') {
        layer.setLatLngs(latLngs);
        if (entry.hitLayer) entry.hitLayer.setLatLngs(latLngs);
        entry.shape = nextShape;
        this.applyStyle(entry);
        // Vertex dots reposition on next selection/edit state change; cheap
        // to re-show when selected.
        if (entry.selected) this.showVertexDots(entry);
        // Label position should follow centroid/midpoint for selected zones.
        if (entry.labelMarker && nextShape.labelText) {
          const anchor = nextShape.mode === 'polygon'
            ? centroid(nextShape.points)
            : lineMidAnchor(nextShape.points);
          entry.labelMarker.setLatLng(storageToLeaflet(anchor, this.canvasHeight));
        }
        return;
      }
      // Fallback path (shouldn't happen for polygon/polyline — both have setLatLngs).
      this.removeZone(id);
      this.addZone(nextShape);
      if (entry.selected) this.setZoneSelected(id, true);
      return;
    }

    // Style-only update.
    entry.shape = nextShape;
    this.applyStyle(entry);
    // Label create/update/remove. The popover toggles zone_labels mode at
    // runtime, which flips labelText between zone.name and undefined for the
    // SAME existing zone — so updateZone must dynamically build OR tear down
    // the labelMarker, not just patch the icon of an existing one. Without
    // this branch, switching from 'never' → 'always' did nothing on already-
    // rendered zones (labelMarker was never created during buildEntry).
    if (patch.labelText !== undefined || ('labelText' in patch)) {
      const desired = nextShape.labelText;
      if (desired && entry.labelMarker) {
        entry.labelMarker.setIcon(this.buildLabelIcon(desired));
      } else if (desired && !entry.labelMarker) {
        entry.labelMarker = this.buildLabelMarker(nextShape);
        entry.labelMarker.addTo(this.layerGroup);
      } else if (!desired && entry.labelMarker) {
        this.layerGroup.removeLayer(entry.labelMarker);
        entry.labelMarker = undefined;
      }
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

  /** Snapshot of zone ids currently rendered. Used by syncZones to detect
   * overlays that no longer correspond to an existing zone (deletion). */
  getZoneIds(): string[] {
    return Array.from(this.entries.keys());
  }

  /**
   * Fast live-update of a zone's polygon/polyline points without rebuilding
   * the underlying Leaflet primitive (ZD4 — live outline during edit-mode
   * drags). Uses L.Polyline.setLatLngs which mutates the existing SVG path
   * in place; cheap enough to fire per drag frame. Does NOT update the
   * cached `shape.points` (caller is in a transient state — the canonical
   * write happens on dragend through the normal store flow → applyStyle).
   *
   * If `id` isn't tracked or the layer doesn't expose setLatLngs, no-op.
   */
  setZonePointsLive(id: string, points: Point[]): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const layer = entry.visibleLayer as L.Path & {
      setLatLngs?: (latlngs: L.LatLng[]) => void;
    };
    if (typeof layer.setLatLngs !== 'function') return;
    const latLngs = points.map(p => storageToLeaflet(p, this.canvasHeight));
    layer.setLatLngs(latLngs);
    // Hit-overlay (line zones) needs the same update so click target stays
    // accurate during drag.
    if (entry.hitLayer) entry.hitLayer.setLatLngs(latLngs);
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

    // Force SVG renderer for zone shapes. Leaflet2DManager defaults to
    // L.canvas() which has unreliable dashArray support for polygons —
    // edit-mode's dashed outline (applyStyle sets dashArray: '5, 5' when
    // editing) renders as solid under canvas. SVG renderer guarantees
    // dashed strokes for both polygon AND polyline (Captain smoke
    // session 219). One shared renderer per map.
    const renderer = getZoneSvgRendererForMap(this.map);

    if (shape.mode === 'polygon') {
      visibleLayer = L.polygon(latLngs, {
        color,
        fillColor: color,
        fillOpacity: opacity,
        weight: UNSELECTED_WEIGHT,
        opacity: 0.9,
        renderer,
      });
    } else {
      visibleLayer = L.polyline(latLngs, {
        color,
        weight: UNSELECTED_WEIGHT,
        opacity: 0.9,
        renderer,
      });
      // Invisible hit-overlay for line zones (wider click target).
      hitLayer = L.polyline(latLngs, {
        color: '#000000',
        weight: LINE_HIT_WEIGHT,
        opacity: 0,
        interactive: true,
        renderer,
      });
    }

    visibleLayer.addTo(this.layerGroup);
    hitLayer?.addTo(this.layerGroup);

    // Wire interaction handlers. Both the visible and hit layers forward
    // clicks to the same zone callback. Leaflet natively suppresses the
    // single `click` event that would otherwise precede a `dblclick`, so
    // separate handlers don't need a manual timeout dance.
    const self = this;
    const wire = (layer: L.Layer) => {
      layer.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        self.onClick?.(shape.id, e);
      });
      layer.on('dblclick', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stop(e);
        self.onDblClick?.(shape.id, e);
      });
      layer.on('contextmenu', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        self.onContext?.(shape.id, e);
      });
      // Hover events for hover-only labels (session 219). Mouseover fades the
      // label in; mouseout fades it out. Cheap — opacity on the divIcon's DOM
      // element. Wired on BOTH visible + hit layers since line zones have a
      // wider invisible hit area than the visible stroke.
      layer.on('mouseover', () => {
        const e = self.entries.get(shape.id);
        if (!e || e.hovered) return;
        e.hovered = true;
        self.applyStyle(e);
      });
      layer.on('mouseout', () => {
        const e = self.entries.get(shape.id);
        if (!e || !e.hovered) return;
        e.hovered = false;
        self.applyStyle(e);
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
      editing: false,
      hovered: false,
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
    // Read-only vertex dots: plain cyan circles, NO inner order number.
    // Numbers are reserved for actionable states (draft + edit handles) where
    // the order matters operationally. Outside edit, they're visual noise.
    // (Session 217 — Captain's read: "maybe DONT show the little number labels
    // when a zone is selected but not edit mode. only when editmode.")
    entry.shape.points.forEach((p) => {
      const latlng = storageToLeaflet(p, this.canvasHeight);
      const icon = L.divIcon({
        className: 'atlas-zone-vertex-dot',
        html: '',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
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

  /**
   * Mark a zone as editing or not. Editing-state changes outline to dashed
   * (parity with create-mode preview) without touching color or weight.
   * Idempotent — safe to call repeatedly with the same value.
   */
  setZoneEditing(id: string, editing: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (entry.editing === editing) return;
    entry.editing = editing;
    this.applyStyle(entry);
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
      // Editing state renders dashed outline (ZC6) so the user sees at a
      // glance "this zone's geometry is mutable right now." Same dash pattern
      // as the draft-mode preview for visual continuity (zone-drawing).
      dashArray: entry.editing ? '5, 5' : undefined,
    };
    if (entry.shape.mode === 'polygon') {
      style.fillColor = color;
      style.fillOpacity = showShape ? opacity : 0;
    }
    entry.visibleLayer.setStyle(style);
    if (entry.labelMarker) {
      const labelEl = entry.labelMarker.getElement();
      if (labelEl) {
        // Label visibility rules (session 219):
        //   - Zone hidden / layer hidden → always 0
        //   - labelHoverOnly + not hovered → 0
        //   - Otherwise → 1
        // CSS transition on the label span gives a smooth fade.
        let opacity: string;
        if (!showShape) opacity = '0';
        else if (entry.shape.labelHoverOnly && !entry.hovered) opacity = '0';
        else opacity = '1';
        (labelEl as HTMLElement).style.opacity = opacity;
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
