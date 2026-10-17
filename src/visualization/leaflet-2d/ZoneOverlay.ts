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
 * Coords on input are storage-space (bottom-left origin, y grows UP, the
 * schema's; S361) — the same coord space as Marker.x / Marker.y. Conversion to Leaflet LatLng
 * happens inside the overlay.
 */

import L from 'leaflet';
import { storageToLeaflet } from './CoordinateUtils';
import type { Point } from './ZoneGeometry';
import { escapeText } from '../../core/dom-utils';
import { inkPoints, inkMinSegment, type InkTreatment } from '../../core/map-ink';

const DEFAULT_COLOR = '#22d3ee';
const DEFAULT_OPACITY = 0.4;
const SELECTED_WEIGHT = 3;
const UNSELECTED_WEIGHT = 2;
const LINE_HIT_WEIGHT = 20;

// Lazy-init shared SVG renderer for zone shapes. Stored per-map at module
// level because each Leaflet map needs its own renderer instance, but
// within a single map all zones share. Map keyed by the L.Map instance.
//
// Exported so zone-edit-mode's segment overlays can use the SAME renderer —
// putting them in the same SVG element as the polygon, which makes
// bringToFront() actually reorder them above the polygon (Captain smoke
// session 219 wave 6 — "hover cuts off as soon as mouse ENTERS the zone").
const svgRendererByMap = new WeakMap<L.Map, L.Renderer>();
export function getZoneSvgRendererForMap(map: L.Map): L.Renderer {
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
  /**
   * When true, the label sits just BELOW the zone (its bottom edge, centred)
   * rather than over the centroid — the default (Captain, S313): a centred
   * label sits on top of the fill and markers and gets blocked. `'center'`
   * keeps the old behaviour.
   */
  labelBelow?: boolean;
  /** Stroke width at rest (world style rule, S356); selected/hovered add one. */
  weight?: number;
  /** Stroke pattern (world style rule, S356); edit mode's dash overrides. */
  dash?: 'solid' | 'dashed' | 'dotted';
  /**
   * The kind's treatment on a styled map (S423, `core/map-ink.ts`): it wins
   * over colour, opacity, weight and dash. Its ink exists only on screen;
   * the stored points are drawn plain while the zone is being edited.
   */
  ink?: InkTreatment;
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
  /** Shore bands under an inked landmass (S423), non-interactive. */
  underLayers: L.Path[];
  /** An inked line's name along it (S423): an SVG text on the hit layer's path. */
  labelAlong?: SVGTextElement;
}

let overlaySeq = 0;

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
  /**
   * When this reads true, a click on a zone falls THROUGH to the map instead
   * of selecting the zone. Set to "is pin placement armed?" so a user placing
   * a pin over a zone lands the pin there rather than selecting the region —
   * the zone otherwise `stopPropagation`s the click and the map never sees it.
   * (Surfaced by the tour's pin-over-swamps beat, but correct app-wide.)
   */
  private clickFallsThrough?: () => boolean;

  /** Unique per overlay: a zone can sit on two mounted map tabs, and an id must name one path. */
  private readonly seq = ++overlaySeq;

  constructor(
    private map: L.Map,
    private canvasHeight: number,
  ) {
    this.layerGroup = L.layerGroup().addTo(this.map);
    this.map.on('zoomend', this.reinkOnZoom);
  }

  /** The ink's detail follows the zoom (about ten screen pixels a piece). */
  private reinkOnZoom = (): void => {
    for (const entry of this.entries.values()) {
      if (entry.shape.ink && entry.shape.ink.rough > 0 && !entry.editing) this.setDrawnPoints(entry);
    }
  };

  /** What the visible path draws: the ink on a styled map, the stored points otherwise and while editing. */
  private drawnLatLngs(shape: ZoneShape, editing: boolean): L.LatLng[] {
    const ink = shape.ink;
    const pts = ink && ink.rough > 0 && !editing
      ? inkPoints(shape.points, inkMinSegment(this.map.getZoom()), ink.rough, shape.mode === 'polygon')
      : shape.points;
    return pts.map(p => storageToLeaflet(p, this.canvasHeight));
  }

  /** The hit layer's points: stored, and left to right when a name runs along them (never upside down). */
  private hitLatLngs(shape: ZoneShape): L.LatLng[] {
    let pts = shape.points;
    if (shape.ink?.labelAlong && pts.length > 1 && pts[0].x > pts[pts.length - 1].x) pts = pts.slice().reverse();
    return pts.map(p => storageToLeaflet(p, this.canvasHeight));
  }

  private setDrawnPoints(entry: ZoneEntry): void {
    const latLngs = this.drawnLatLngs(entry.shape, entry.editing);
    for (const layer of [entry.visibleLayer, ...entry.underLayers]) {
      (layer as L.Path & { setLatLngs?: (l: L.LatLng[]) => void }).setLatLngs?.(latLngs);
    }
  }

  /**
   * Paint order on a styled map (S423): seas, then land and its shore, then
   * the areas on it, then the lines; names along lines on top. Zones without
   * a kind sit between the areas and the lines.
   */
  applyInkOrder(plainLayer: number): void {
    const ordered = Array.from(this.entries.values())
      .sort((a, b) => (a.shape.ink?.layer ?? plainLayer) - (b.shape.ink?.layer ?? plainLayer));
    for (const e of ordered) {
      for (const u of e.underLayers) u.bringToFront();
      e.visibleLayer.bringToFront();
      e.hitLayer?.bringToFront();
    }
    for (const e of ordered) {
      if (e.labelAlong?.parentNode) e.labelAlong.parentNode.appendChild(e.labelAlong);
    }
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
    // A styled map's treatment builds layers of its own (shore bands, a name
    // along a line): a change of treatment rebuilds, like a change of shape.
    const inkChanged = 'ink' in patch && patch.ink !== entry.shape.ink;

    if (modeChanged || inkChanged) {
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
      const layer = entry.visibleLayer as L.Path & {
        setLatLngs?: (latlngs: L.LatLng[]) => void;
      };
      if (typeof layer.setLatLngs === 'function') {
        entry.shape = nextShape;
        this.setDrawnPoints(entry);
        if (entry.hitLayer) entry.hitLayer.setLatLngs(this.hitLatLngs(nextShape));
        this.applyStyle(entry);
        // Vertex dots reposition on next selection/edit state change; cheap
        // to re-show when selected.
        if (entry.selected) this.showVertexDots(entry);
        // Label position should follow centroid/midpoint for selected zones.
        if (entry.labelMarker && nextShape.labelText) {
          const anchor = labelAnchorFor(nextShape);
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
    if (alongLine(nextShape)) {
      this.setLabelAlong(entry);
    } else if (patch.labelText !== undefined || ('labelText' in patch)) {
      const desired = nextShape.labelText;
      if (desired && entry.labelMarker) {
        entry.labelMarker.setIcon(this.buildLabelIcon(desired, nextShape.labelBelow, nextShape.ink));
        entry.labelMarker.setLatLng(storageToLeaflet(labelAnchorFor(nextShape), this.canvasHeight));
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
    for (const u of entry.underLayers) this.layerGroup.removeLayer(u);
    this.layerGroup.removeLayer(entry.visibleLayer);
    if (entry.hitLayer) this.layerGroup.removeLayer(entry.hitLayer);
    if (entry.labelMarker) this.layerGroup.removeLayer(entry.labelMarker);
    entry.labelAlong?.remove();
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

  isZoneVisible(id: string): boolean {
    const entry = this.entries.get(id);
    return Boolean(entry && entry.visible && this.layerVisible);
  }

  /** Programmatic hover (the zone panel's rows light the map the way the cursor does). */
  setZoneHovered(id: string, hovered: boolean): void {
    const entry = this.entries.get(id);
    if (!entry || entry.hovered === hovered) return;
    entry.hovered = hovered;
    this.applyStyle(entry);
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

  /** The label's DOM element (undefined when the zone has no label or the
   *  marker is not on the map yet). The density layer culls by class on it. */
  getLabelElement(id: string): HTMLElement | undefined {
    return this.entries.get(id)?.labelMarker?.getElement() as HTMLElement | undefined;
  }

  getZoneMode(id: string): 'polygon' | 'line' | undefined {
    return this.entries.get(id)?.shape.mode;
  }

  /** Where the label marker sits, in container pixels (undefined without a label). */
  getLabelPoint(id: string): { x: number; y: number } | undefined {
    const marker = this.entries.get(id)?.labelMarker;
    if (!marker) return undefined;
    const pt = this.map.latLngToContainerPoint(marker.getLatLng());
    return { x: pt.x, y: pt.y };
  }

  /**
   * How big the zone is ON SCREEN right now: the diagonal of its bounding
   * box in container pixels. The density layer ranks zone labels by it
   * (a river across the map keeps its name; a forty-pixel route drops).
   * Zero for an entry without geometry.
   */
  getZoneScreenExtent(id: string): number {
    const entry = this.entries.get(id);
    if (!entry) return 0;
    const layer = entry.visibleLayer as L.Path & { getBounds?: () => L.LatLngBounds };
    const bounds = layer.getBounds?.();
    if (!bounds || !bounds.isValid()) return 0;
    const a = this.map.latLngToContainerPoint(bounds.getNorthWest());
    const b = this.map.latLngToContainerPoint(bounds.getSouthEast());
    return Math.hypot(b.x - a.x, b.y - a.y);
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

  /** See `clickFallsThrough`: when `fn()` is true, zone clicks reach the map. */
  setClickFallsThrough(fn: () => boolean): void {
    this.clickFallsThrough = fn;
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
    this.map.off('zoomend', this.reinkOnZoom);
    this.map.removeLayer(this.layerGroup);
  }

  // ----- internals -----

  private buildEntry(shape: ZoneShape): ZoneEntry {
    const latLngs = this.drawnLatLngs(shape, false);
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

    // Shore bands go in first, so they sit under the land they ring (S423).
    const underLayers: L.Path[] = [];
    if (shape.mode === 'polygon' && shape.ink?.shore) {
      for (const band of shape.ink.shore) {
        const u = L.polygon(latLngs, {
          color: band.color, weight: band.width, opacity: 1, fill: false, interactive: false, renderer,
        });
        u.addTo(this.layerGroup);
        underLayers.push(u);
      }
    }

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
      hitLayer = L.polyline(this.hitLatLngs(shape), {
        color: '#000000',
        weight: LINE_HIT_WEIGHT,
        opacity: 0,
        interactive: true,
        renderer,
      });
    }

    visibleLayer.addTo(this.layerGroup);
    hitLayer?.addTo(this.layerGroup);
    if (shape.ink) ensureInkDefs(renderer);

    // Wire interaction handlers. Both the visible and hit layers forward
    // clicks to the same zone callback. Leaflet natively suppresses the
    // single `click` event that would otherwise precede a `dblclick`, so
    // separate handlers don't need a manual timeout dance.
    const self = this;
    const wire = (layer: L.Layer) => {
      layer.on('click', (e: L.LeafletMouseEvent) => {
        // Pin placement armed → let the click reach the map so the pin lands
        // here, instead of eating it to select the zone. Not stopping
        // propagation is what lets the map's own click handler fire.
        if (self.clickFallsThrough?.()) return;
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
      underLayers,
    };

    if (alongLine(shape)) {
      this.setLabelAlong(entry);
    } else if (shape.labelText) {
      entry.labelMarker = this.buildLabelMarker(shape);
      entry.labelMarker.addTo(this.layerGroup);
    }

    return entry;
  }

  /**
   * An inked line's name, written along it (S423): an SVG `<textPath>` on the
   * hit layer's path, which runs left to right. Kept beside the paths in the
   * zone renderer's svg; created, renamed or removed to match `labelText`.
   */
  private setLabelAlong(entry: ZoneEntry): void {
    const text = entry.shape.labelText;
    const path = (entry.hitLayer as (L.Path & { _path?: SVGPathElement }) | undefined)?._path;
    if (!text || !path?.parentNode) {
      entry.labelAlong?.remove();
      entry.labelAlong = undefined;
      return;
    }
    const NS = 'http://www.w3.org/2000/svg';
    if (!path.id) path.id = `atlas-ink-line-${this.seq}-${entry.shape.id}`;
    if (!entry.labelAlong) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('class', 'atlas-ink-line-label');
      t.setAttribute('dy', '-4');
      const tp = document.createElementNS(NS, 'textPath');
      tp.setAttribute('href', `#${path.id}`);
      tp.setAttribute('startOffset', '50%');
      tp.setAttribute('text-anchor', 'middle');
      t.appendChild(tp);
      path.parentNode.appendChild(t);
      entry.labelAlong = t;
    }
    // textContent: world text never becomes markup (conv. 93).
    (entry.labelAlong.firstChild as SVGTextPathElement).textContent = text;
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
    // Inked: the handles sit on the stored points, so the path draws them plain while editing.
    if (entry.shape.ink && entry.shape.ink.rough > 0) this.setDrawnPoints(entry);
    this.applyStyle(entry);
  }

  private applyStyle(entry: ZoneEntry): void {
    const color = entry.shape.color ?? DEFAULT_COLOR;
    const opacity = entry.shape.opacity ?? DEFAULT_OPACITY;
    const showShape = entry.visible && this.layerVisible;
    // Hover reads like a light selection (Captain, S356: "hover would
    // highlight the whole road, river, chora"): selected weight, full
    // stroke opacity, a notch more fill, and the label revealed even when
    // the density layer culled it.
    const lit = entry.selected || entry.hovered;
    const restWeight = entry.shape.weight ?? UNSELECTED_WEIGHT;
    const weight = lit ? restWeight + (SELECTED_WEIGHT - UNSELECTED_WEIGHT) : restWeight;
    const style: L.PathOptions = {
      color,
      weight,
      opacity: showShape ? (lit ? 1 : 0.9) : 0,
      // Editing state renders dashed outline (ZC6) so the user sees at a
      // glance "this zone's geometry is mutable right now." Same dash pattern
      // as the draft-mode preview for visual continuity (zone-drawing).
      // Otherwise the kind's own pattern (routes dashed, rivers solid).
      dashArray: entry.editing ? '5, 5'
        : entry.shape.dash === 'dashed' ? '8, 6'
        : entry.shape.dash === 'dotted' ? '2, 5'
        : undefined,
    };
    if (entry.shape.mode === 'polygon') {
      style.fillColor = color;
      style.fillOpacity = showShape ? (entry.hovered && !entry.selected ? Math.min(1, opacity + 0.15) : opacity) : 0;
    }
    const ink = entry.shape.ink;
    if (ink) {
      // A styled map: the kind's treatment draws the zone (S423). Lit adds a
      // pixel of ink, so a stroke-less forest still answers the cursor.
      style.color = ink.stroke;
      style.weight = ink.weight + (lit ? 1 : 0);
      style.opacity = showShape ? (ink.weight > 0 ? ink.strokeOpacity : lit ? 0.6 : 0) : 0;
      style.dashArray = entry.editing ? '5, 5' : ink.dash;
      if (entry.shape.mode === 'polygon') {
        const fill = ink.pattern ? `url(#atlas-ink-${ink.pattern})` : ink.fill;
        style.fillColor = fill ?? ink.stroke;
        style.fillOpacity = showShape && fill ? 1 : 0;
      }
      for (const u of entry.underLayers) u.setStyle({ opacity: showShape ? 1 : 0 });
      if (entry.labelAlong) {
        const shown = showShape && !(entry.shape.labelHoverOnly && !entry.hovered);
        entry.labelAlong.style.opacity = shown ? '1' : '0';
      }
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
        labelEl.classList.toggle('atlas-label-revealed', Boolean(entry.hovered && showShape));
        // The chip's hairline takes the zone's colour (S356): with kinds
        // coloured, a river's name reads as a river's name.
        const span = labelEl.querySelector('span') as HTMLElement | null;
        if (span && !ink) span.style.borderColor = color;
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
      visibleEl.classList.toggle('atlas-zone-hovered', Boolean(entry.hovered && !entry.selected && showShape));
      visibleEl.classList.toggle('atlas-zone-ink', Boolean(ink));
    }
    if (entry.selected && showShape) {
      this.showVertexDots(entry);
    } else {
      this.hideVertexDots(entry);
    }
    // A hidden zone is drawn at opacity 0, so it must stop taking the pointer
    // too (#280): an earlier era lying over the one on show stole its clicks
    // and hovers, and a kind hidden by its eye still selected on a click.
    const hitEl = (entry.hitLayer as (L.Path & { _path?: SVGElement }) | null | undefined)?._path;
    for (const el of [visibleEl, hitEl]) {
      if (el) el.style.pointerEvents = showShape ? '' : 'none';
    }
  }

  private buildLabelMarker(shape: ZoneShape): L.Marker {
    const anchor = labelAnchorFor(shape);
    const latlng = storageToLeaflet(anchor, this.canvasHeight);
    return L.marker(latlng, {
      icon: this.buildLabelIcon(shape.labelText ?? '', shape.labelBelow, shape.ink),
      interactive: false,
      keyboard: false,
    });
  }

  private buildLabelIcon(text: string, below?: boolean, ink?: InkTreatment): L.DivIcon {
    const safe = escapeText(text);
    return L.divIcon({
      className: 'atlas-zone-label' + (below ? ' atlas-zone-label-below' : '')
        + (ink ? ` atlas-zone-label-ink atlas-ink-${ink.kind}` : ''),
      html: `<span>${safe}</span>`,
      iconSize: undefined as unknown as L.PointExpression,
      iconAnchor: [0, 0] as L.PointTuple,
    });
  }
}

/** An inked line whose kind writes its name along it (rivers, roads). */
function alongLine(shape: ZoneShape): boolean {
  return shape.mode === 'line' && Boolean(shape.ink?.labelAlong);
}

/**
 * The fill patterns a styled map uses (S423), once per zone renderer's svg.
 * `userSpaceOnUse` puts them in the renderer's layer-pixel space, which a pan
 * does not move: the hatch travels with its shape and stays the same size on
 * screen at every zoom. Two mounted maps carry identical copies under the
 * same ids, so whichever one a `url(#…)` resolves to draws the same.
 */
function ensureInkDefs(renderer: L.Renderer): void {
  const svg = (renderer as L.Renderer & { _container?: SVGSVGElement })._container;
  if (!svg || svg.querySelector('defs[data-atlas-ink]')) return;
  const NS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(NS, 'defs');
  defs.setAttribute('data-atlas-ink', '');
  const ink = '#3b2a1a';
  defs.innerHTML = `
    <pattern id="atlas-ink-hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="6" stroke="${ink}" stroke-width="1.1" stroke-opacity="0.75"/></pattern>
    <pattern id="atlas-ink-stipple" patternUnits="userSpaceOnUse" width="9" height="9">
      <circle cx="2" cy="2" r="1.1" fill="#4a5a2e"/><circle cx="6.5" cy="6" r="0.9" fill="#4a5a2e"/></pattern>
    <pattern id="atlas-ink-marsh" patternUnits="userSpaceOnUse" width="14" height="8">
      <line x1="1" y1="4" x2="7" y2="4" stroke="${ink}" stroke-width="0.9"/><line x1="8" y1="8" x2="12" y2="8" stroke="${ink}" stroke-width="0.9"/></pattern>
    <pattern id="atlas-ink-dots" patternUnits="userSpaceOnUse" width="12" height="12">
      <circle cx="3" cy="3" r="0.8" fill="${ink}"/><circle cx="9" cy="9" r="0.8" fill="${ink}"/></pattern>`;
  svg.prepend(defs);
}

/** Where a zone's label anchors: bottom-centre when `labelBelow`, else the
 *  centroid (polygon) / longest-segment midpoint (line). */
function labelAnchorFor(shape: ZoneShape): Point {
  // A LINE always anchors at its midpoint. The `below` anchor is a bounding-box
  // bottom edge, which for a line drifts the label far under the lowest
  // endpoint (Captain's launch note: the line label sat too far below the
  // line). A line has no interior to sit a label "inside", so midpoint + the
  // small CSS below-nudge keeps it reading against the line itself. Polygons
  // keep the below/centroid choice.
  if (shape.mode === 'line') return lineMidAnchor(shape.points);
  if (shape.labelBelow) return bottomCenter(shape.points);
  return centroid(shape.points);
}

/** Bottom-centre of the points' bounding box. Screen-bottom = MIN storage-y
 *  (storage is bottom-left since S361: lat = y), so the label hangs off the
 *  zone's lowest edge, horizontally centred. */
export function bottomCenter(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let minX = Infinity, maxX = -Infinity, minY = Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
  }
  return { x: (minX + maxX) / 2, y: minY };
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

