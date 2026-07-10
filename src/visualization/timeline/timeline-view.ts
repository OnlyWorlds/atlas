/**
 * Timeline view — the interactive, room-grade chart renderer (vs the compact
 * home bar in `timeline-bar.ts`). Canvas + DOM hybrid, the context-graph pattern:
 *
 *   - CANVAS layer: fill-space axis, ticks, grid, dots, range-lines, with
 *     wheel-zoom + drag-pan and cursor-proximity labels (so a dense world reads
 *     instead of becoming a wall of overlapping text).
 *   - DOM overlay:  the selected-node CARD — date + role-grouped linked-element
 *                   chips (the wedge), a "focus" action (re-scope the chart to
 *                   this element = filter-by-element, D5), and "open element".
 *
 * The room owns the ChartConfig/scope and passes already-scoped NODES in via
 * `setNodes`; this renderer is a dumb projector. Selection round-trips through
 * the URL (room → `/timeline/<id>`) so the right-pane context graph focuses the
 * same element. See DESIGN_CHARTS.md.
 */

import type { ElementType } from '../../core/types';
import type { LinkedRef, PlacedDot, TimelineNode } from './types';
import { calculateTicks, calculateTimeRange, createDateToX } from './axis-calculator';
import { escapeText } from '../../core/dom-utils';
import { ELEMENT_ICONS } from '../../core/constants';
import { rankAnchors, ANCHOR_CAP } from './degree';
import { applyAlpha, ensureIconFont } from './canvas-utils';
import { completeWaypoint } from '../../core/waypoints';

const DOT_RADIUS = 4;             // placement radius for binning + hit-test base
const DOT_RADIUS_HOVER = 6;       // hit-test tolerance (px)
// Node glyphs — type-tinted Material Symbols, sizes in px (Identity, chart #2).
const ICON_BASE = 14;
const ICON_HOVER = 18;
const ICON_ANCHOR = 20;          // significance "anchor beats" — bigger glyph + halo
const ICON_SELECTED = 22;
const RUNG_MID = 1.5;            // LOD: above this zoom, non-anchor labels fill in
const RUNG_CLOSE = 3;            // LOD: above this zoom, glyphs grow further
const TOP_PAD = 20;
const AXIS_LABEL_HEIGHT = 22;
const NODE_X_GAP = 42;           // density-fan: x-window within which nodes bloom vertically
const NODE_Y_GAP = 34;           // density-fan: vertical step between stacked nodes (breathing room)
const LABEL_MAX_CHARS = 24;
const LABEL_NEAR_RADIUS = 150;   // px — cursor neighbourhood that gets labels
const LABEL_NEAR_MAX = 9;        // most labels to reveal around the cursor
const ZOOM_MAX = 200;            // max magnification vs the fitted span
const ZOOM_STEP = 1.2;
// Overview strip (sitdown S2) — the always-visible full-world reference frame
// under the main axis. The bright band is the viewport; drag/resize it there.
const STRIP_H = 26;
const STRIP_GAP = 8;
const STRIP_EDGE_GRAB = 5;       // px — band-edge resize hit tolerance
const GHOST_MS = 2500;           // previous-window ghost fade duration
const TRAVEL_MS = 280;           // focus-jump window animation

export interface TimelineViewOptions {
  /** A dot or card chip was clicked → focus that element (unified select=focus;
   *  the room turns this into a `/timeline/<id>` route change). Empty id clears. */
  onSelect: (elementId: string) => void;
  /** The card's "Open" action → jump to that element's full room. */
  onOpenElement: (elementId: string) => void;
}

export interface TimelineViewHandle {
  /**
   * The room passes already-scoped nodes (it owns the ChartConfig/scope), plus
   * the FULL dated universe for the overview strip's constant reference frame.
   */
  setNodes(nodes: TimelineNode[], universe?: TimelineNode[]): void;
  setSelection(elementId: string | null): void;
  redraw(): void;
  destroy(): void;
}

/** The one viewport state: a visible time window in world-date units (S3). */
export interface TimeWindow { start: number; end: number }

interface LabelBox { x0: number; x1: number; y0: number; y1: number; nodeId: string }

interface ViewState {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  card: HTMLElement;
  nodes: TimelineNode[];
  universe: TimelineNode[];     // full dated world (strip reference frame)
  placedDots: PlacedDot[];
  hoveredDot: PlacedDot | null;
  selectedId: string | null;
  // THE viewport: null = auto-fit the scoped node set. There is no separate
  // camera — wheel resizes this window around the cursor date, drag slides it
  // (sitdown S3; replaced zoom+panCenter).
  window: TimeWindow | null;
  baseRange: { min: number; max: number } | null;
  // Focus-jump travel: animate the window between fits so a jump reads as
  // camera travel, not a teleport (S6).
  anim: { from: TimeWindow; to: TimeWindow; t0: number } | null;
  // Previous window's ghost on the strip, fading over GHOST_MS (S2).
  ghost: { win: TimeWindow; bornAt: number } | null;
  rafPending: boolean;
  // layout cache — the density-fan is deterministic per geometry; recompute only
  // when size / range / node set changes, NOT on every mousemove redraw.
  layoutSig: string | null;
  layoutNodes: TimelineNode[] | null;
  // Placed label boxes from the last draw — labels are click targets too (S6).
  labelBoxes: LabelBox[];
  // cursor (canvas coords; null when outside) — drives proximity labels
  mouseX: number | null;
  mouseY: number | null;
  // drag-pan (main canvas) + strip drags
  dragging: boolean;
  dragStartX: number;
  dragStartWindow: TimeWindow | null;
  dragMoved: boolean;
  stripDrag: { mode: 'move' | 'left' | 'right'; startX: number; startWin: TimeWindow } | null;
  destroyed: boolean;           // set on destroy(); guards late async redraws
  onSelect: (id: string) => void;
  onOpenElement: (id: string) => void;
}

export function mountTimelineView(target: HTMLElement, opts: TimelineViewOptions): TimelineViewHandle {
  target.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'atlas-timeline-view';
  target.appendChild(container);

  const canvas = document.createElement('canvas');
  canvas.className = 'atlas-timeline-view-canvas';
  container.appendChild(canvas);

  const card = document.createElement('div');
  card.className = 'atlas-timeline-card';
  card.style.display = 'none';
  container.appendChild(card);

  const state: ViewState = {
    container, canvas, card,
    nodes: [], universe: [], placedDots: [], hoveredDot: null, selectedId: null,
    window: null, baseRange: null,
    anim: null, ghost: null, rafPending: false,
    layoutSig: null, layoutNodes: null,
    labelBoxes: [],
    mouseX: null, mouseY: null,
    dragging: false, dragStartX: 0, dragStartWindow: null, dragMoved: false,
    stripDrag: null,
    destroyed: false,
    onSelect: opts.onSelect,
    onOpenElement: opts.onOpenElement,
  };

  const onMove = (e: MouseEvent): void => handleMouseMove(state, e);
  const onLeave = (): void => handleMouseLeave(state);
  const onDown = (e: MouseEvent): void => handleMouseDown(state, e);
  const onUp = (): void => handleMouseUp(state);
  const onWheel = (e: WheelEvent): void => handleWheel(state, e);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const ro = new ResizeObserver(() => { draw(state); positionCard(state); });
  ro.observe(container);

  // Material Symbols may not be in the FontFaceSet at first paint (the DOM card
  // that also uses it starts hidden) — load it, then redraw so any first-frame
  // fallback glyphs upgrade in place. (craft #89)
  void ensureIconFont().then(() => draw(state));

  return {
    setNodes(nodes: TimelineNode[], universe?: TimelineNode[]): void {
      const prevView = currentViewRange(state);
      const prevBase = state.baseRange;
      state.nodes = nodes;
      if (universe) state.universe = universe;
      state.layoutSig = null; // new node set → re-pack
      // Focus travel (S6): when the scope's fitted range changes while a
      // window (or prior fit) is on screen, animate to the new fit instead of
      // teleporting, and leave the old window as a fading ghost on the strip.
      const nextBase = nodes.length > 0 ? calculateTimeRange(nodes) : null;
      if (
        prevView && prevBase && nextBase &&
        (Math.abs(nextBase.min - prevBase.min) > 1e-9 || Math.abs(nextBase.max - prevBase.max) > 1e-9)
      ) {
        state.ghost = { win: prevView, bornAt: performance.now() };
        state.anim = {
          from: prevView,
          to: { start: nextBase.min, end: nextBase.max },
          t0: performance.now(),
        };
        state.window = null; // settle on auto-fit when travel completes
        scheduleMotion(state);
      }
      draw(state);
      renderCard(state);
    },
    setSelection(elementId: string | null): void {
      // Normalize the clear sentinel: the card's close button routes through an
      // empty-string id — coerce to null so hit-tests/labels have one no-selection
      // value, not a mix of '' and null.
      const next = elementId ? elementId : null;
      if (next === state.selectedId) return;
      state.selectedId = next;
      draw(state);
      renderCard(state);
    },
    redraw(): void { draw(state); },
    destroy(): void {
      state.destroyed = true;
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('wheel', onWheel);
      target.innerHTML = '';
    },
  };
}

// ====== Window helpers (S3 — the band IS the camera) ======

/**
 * Clamp a window inside padded bounds, preserving its span where possible.
 * `bounds` is the full navigable range (the universe when present, else the
 * scoped fit); a 5% pad lets the edges breathe like the old zoom clamp did.
 */
export function clampWindow(
  win: TimeWindow,
  bounds: { min: number; max: number },
): TimeWindow {
  const boundSpan = bounds.max - bounds.min;
  if (boundSpan <= 0) return { start: bounds.min, end: bounds.max };
  const pad = boundSpan * 0.05;
  const lo = bounds.min - pad;
  const hi = bounds.max + pad;
  let span = Math.min(win.end - win.start, hi - lo);
  if (span <= 0) span = hi - lo;
  let start = win.start;
  if (start < lo) start = lo;
  if (start + span > hi) start = hi - span;
  return { start, end: start + span };
}

/**
 * Resize a window by `factor` (>1 zooms out, <1 zooms in) around `anchorDate`
 * so the date under the cursor stays put. Span is clamped to
 * [boundsSpan/ZOOM_MAX, boundsSpan·1.1].
 */
export function zoomWindow(
  win: TimeWindow,
  factor: number,
  anchorDate: number,
  bounds: { min: number; max: number },
): TimeWindow {
  const boundSpan = Math.max(1e-9, bounds.max - bounds.min);
  const span = win.end - win.start;
  const nextSpan = Math.min(boundSpan * 1.1, Math.max(boundSpan / ZOOM_MAX, span * factor));
  const frac = span > 0 ? (anchorDate - win.start) / span : 0.5;
  const start = anchorDate - frac * nextSpan;
  return clampWindow({ start, end: start + nextSpan }, bounds);
}

/** Fit range for the scoped nodes as a window. */
function fitWindow(state: ViewState): TimeWindow | null {
  if (!state.baseRange) return null;
  return { start: state.baseRange.min, end: state.baseRange.max };
}

/** The navigable bounds: the universe when present (pan across the whole
 *  world's history, not just the scope), else the scoped fit. */
function navBounds(state: ViewState): { min: number; max: number } | null {
  if (state.universe.length > 0) return calculateTimeRange(state.universe);
  return state.baseRange;
}

/** The window currently ON SCREEN: animation frame > explicit window > fit. */
function currentViewRange(state: ViewState): TimeWindow | null {
  if (state.anim) {
    const t = Math.min(1, (performance.now() - state.anim.t0) / TRAVEL_MS);
    const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
    const { from, to } = state.anim;
    return {
      start: from.start + (to.start - from.start) * e,
      end: from.end + (to.end - from.end) * e,
    };
  }
  return state.window ?? fitWindow(state);
}

/** Zoom magnification vs the fitted span — drives the LOD rungs. */
function zoomFactorOf(state: ViewState, view: TimeWindow): number {
  if (!state.baseRange) return 1;
  const baseSpan = state.baseRange.max - state.baseRange.min;
  const span = view.end - view.start;
  return span > 0 && baseSpan > 0 ? Math.max(1, baseSpan / span) : 1;
}

/** One rAF driver for travel + ghost fade; stops itself when both are done. */
function scheduleMotion(state: ViewState): void {
  if (state.rafPending || state.destroyed) return;
  state.rafPending = true;
  requestAnimationFrame(() => {
    state.rafPending = false;
    if (state.destroyed) return;
    if (state.anim && performance.now() - state.anim.t0 >= TRAVEL_MS) state.anim = null;
    if (state.ghost && performance.now() - state.ghost.bornAt >= GHOST_MS) state.ghost = null;
    draw(state);
    if (state.anim || state.ghost) scheduleMotion(state);
  });
}

/**
 * Centered density-fan (beeswarm) vertical layout. X = date (the only meaningful
 * axis); Y is anti-overlap. A node is placed at the axis midline unless that slot
 * is taken by a near-in-time neighbour, in which case it steps up/down to the
 * nearest free level — so crowded periods bloom to fill the height and sparse
 * periods stay a thin spine. Anchors are laid FIRST so the significant beats hold
 * the centre. Pure + deterministic (stable across redraws → no flicker).
 */
export function computeBeeswarm(
  nodes: TimelineNode[],
  anchorIds: Set<string>,
  dateToX: (d: number) => number,
  w: number,
  axisY: number,
): PlacedDot[] {
  const top = TOP_PAD;
  const bottom = axisY - 8;
  // Degenerate band (container shorter than the top padding + axis strip) — no
  // usable vertical room, so bail instead of stacking every node on one line
  // (which draws an unusable, non-interactive chart).
  if (bottom <= top) return [];
  const centerY = (top + bottom) / 2;
  const span = Math.max(1, bottom - top);
  const order = [...nodes].sort((a, b) =>
    (anchorIds.has(a.id) ? 0 : 1) - (anchorIds.has(b.id) ? 0 : 1)
    || a.startDate - b.startDate
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const placed: PlacedDot[] = [];
  for (const node of order) {
    const x = dateToX(node.startDate);
    if (x < -40 || x > w + 40) continue;
    const free = (cy: number): boolean =>
      cy >= top && cy <= bottom
      && !placed.some(p => Math.abs(p.x - x) < NODE_X_GAP && Math.abs(p.y - cy) < NODE_Y_GAP);
    let y = centerY;
    if (!free(y)) {
      let found = false;
      const maxK = Math.ceil(span / NODE_Y_GAP) + 1;
      for (let k = 1; k <= maxK && !found; k++) {
        const up = centerY - k * NODE_Y_GAP;
        const down = centerY + k * NODE_Y_GAP;
        if (free(up)) { y = up; found = true; }
        else if (free(down)) { y = down; found = true; }
      }
      if (!found) {
        // Everything in this x-window is occupied (extreme local density) —
        // overlap is unavoidable, so step out alternately from the centre,
        // CLAMPED to the band. Deterministic + bounded (the old modulo spread
        // could fling a node into otherwise-empty canvas).
        const k = (placed.length % maxK) + 1;
        const dir = placed.length % 2 === 0 ? -1 : 1;
        y = Math.min(bottom, Math.max(top, centerY + dir * k * NODE_Y_GAP));
      }
    }
    placed.push({ node, x, y, radius: DOT_RADIUS });
  }
  return placed;
}

// ====== Drawing ======

function draw(state: ViewState): void {
  if (state.destroyed) return; // a late font-load/ResizeObserver tick after destroy()
  const { canvas, container } = state;
  const rect = container.getBoundingClientRect();
  const w = Math.max(0, rect.width);
  const h = Math.max(0, rect.height);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0 || h === 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  ctx.fillStyle = 'rgba(255,255,255,0.012)';
  ctx.fillRect(0, 0, w, h);

  if (state.nodes.length === 0) {
    state.placedDots = [];
    state.baseRange = null;
    state.labelBoxes = [];
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nothing dated in this view.', w / 2, h / 2);
    return;
  }

  const base = calculateTimeRange(state.nodes);
  state.baseRange = base;
  const view = currentViewRange(state) ?? { start: base.min, end: base.max };
  const range = { min: view.start, max: view.end };
  const dateToX = createDateToX(range, w);
  const ticks = calculateTicks(range, w);
  // The overview strip reserves the bottom band (S2).
  const axisY = h - AXIS_LABEL_HEIGHT - STRIP_H - STRIP_GAP;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,0.03)';
  ctx.lineWidth = 1;
  for (const tick of ticks) {
    const x = dateToX(tick);
    ctx.beginPath();
    ctx.moveTo(x, TOP_PAD);
    ctx.lineTo(x, axisY);
    ctx.stroke();
  }

  // Axis line
  ctx.beginPath();
  ctx.moveTo(0, axisY);
  ctx.lineTo(w, axisY);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.stroke();

  // Tick labels — brighter than the old 0.30 wash (S6: "the time below is
  // barely readable"); dates are navigation, not decoration.
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const tick of ticks) {
    const x = dateToX(tick);
    ctx.beginPath();
    ctx.moveTo(x, axisY - 3);
    ctx.lineTo(x, axisY + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(String(Math.round(tick)), x, axisY + 15);
  }

  // Significance first — the most-connected nodes ("anchor beats") get a bigger
  // glyph + halo + always-on label, AND claim the central spine in the layout.
  const anchorIds = rankAnchors(state.nodes, ANCHOR_CAP);

  // Vertical layout — a centered DENSITY FAN (beeswarm): nodes bloom up/down from
  // the axis midline only as the local time-neighbourhood gets crowded, so dense
  // periods use the full height while sparse periods stay a thin spine — instead
  // of everything stacking at the top. Cached per geometry so the per-mousemove
  // redraw (proximity labels) never re-runs the O(n·k) packing.
  // Degree fingerprint guards a latent desync: if a node's degree mutates in
  // place (same array ref) the geometry signature alone wouldn't re-pack, and
  // the anchor set feeds the layout order.
  let degreeHash = 0;
  for (const n of state.nodes) degreeHash = (degreeHash * 31 + n.degree) | 0;
  const layoutSig = `${w.toFixed(1)}|${axisY.toFixed(1)}|${range.min.toFixed(2)}|${range.max.toFixed(2)}|${state.nodes.length}|${degreeHash}`;
  if (state.layoutSig !== layoutSig || state.layoutNodes !== state.nodes) {
    state.placedDots = computeBeeswarm(state.nodes, anchorIds, dateToX, w, axisY);
    state.layoutSig = layoutSig;
    state.layoutNodes = state.nodes;
  }
  const placed = state.placedDots;

  // Range lines (endDate)
  for (const dot of placed) {
    if (dot.node.endDate == null) continue;
    const x2 = dateToX(dot.node.endDate);
    ctx.beginPath();
    ctx.moveTo(dot.x, dot.y);
    ctx.lineTo(x2, dot.y);
    ctx.strokeStyle = applyAlpha(dot.node.color, 0.30);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Labels — PROXIMITY REVEAL: selected + hovered always; otherwise only the
  // dots nearest the cursor. Dots-only at rest keeps a dense world legible
  // (the overlapping-wall fix). Collision-avoided within the labelled set.
  drawLabels(ctx, state, placed, w, anchorIds);

  // Nodes → type-tinted category glyphs (selected + hovered emphasised).
  // Identity over anonymity: a glance distinguishes event / character /
  // location / narrative… instead of a wall of identical dots. Canvas
  // Material Symbols per craft #18 (see pin-visuals.ts); chart #2 "The Landing".
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // LOD: glyphs grow a little as you zoom in (overview stays light, detail on
  // demand). Anchors stay prominent at every rung.
  const zf = zoomFactorOf(state, view);
  const detail = zf > RUNG_CLOSE ? 2 : zf > RUNG_MID ? 1 : 0;
  for (const dot of placed) {
    const isSel = dot.node.id === state.selectedId;
    const isHover = dot === state.hoveredDot;
    const isAnchor = anchorIds.has(dot.node.id);
    const size = isSel ? ICON_SELECTED
      : isAnchor ? ICON_ANCHOR + detail
      : isHover ? ICON_HOVER
      : ICON_BASE - 1 + detail * 2;   // 13 (overview) → 15 → 17 (close)
    const ringR = size * 0.6;
    // Anchor halo — two faint rings behind the glyph (reuses the selected-ring
    // pattern). Skipped when selected so the two rings don't double up.
    if (isAnchor && !isSel) {
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, ringR + 8, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, ringR + 4, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.32);
      ctx.stroke();
    }
    if (isSel) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, ringR + 4, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.55);
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (isHover) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, ringR + 3, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const icon = ELEMENT_ICONS[dot.node.elementType as ElementType] ?? 'category';
    ctx.font = `${size}px "Material Symbols Outlined"`;
    // Dark backing stroke keeps overlapping glyphs legible on the near-black canvas.
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(icon, dot.x, dot.y);
    ctx.fillStyle = dot.node.color;
    ctx.fillText(icon, dot.x, dot.y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  drawStrip(ctx, state, w, h, view);

  positionCard(state);
}

// ====== The overview strip (S2) ======

/** Strip x-mapping over the FULL universe range (constant reference frame). */
function stripScale(state: ViewState, w: number): { toX: (d: number) => number; toDate: (x: number) => number; bounds: { min: number; max: number } } | null {
  const bounds = navBounds(state);
  if (!bounds) return null;
  const span = Math.max(1e-9, bounds.max - bounds.min);
  const pad = 10;
  const usable = Math.max(1, w - pad * 2);
  return {
    toX: (d) => pad + ((d - bounds.min) / span) * usable,
    toDate: (x) => bounds.min + ((x - pad) / usable) * span,
    bounds,
  };
}

function stripTop(h: number): number { return h - STRIP_H; }

function drawStrip(ctx: CanvasRenderingContext2D, state: ViewState, w: number, h: number, view: TimeWindow): void {
  const scale = stripScale(state, w);
  if (!scale) return;
  const top = stripTop(h);
  const midY = top + STRIP_H / 2;

  // Track
  ctx.fillStyle = 'rgba(255,255,255,0.025)';
  ctx.fillRect(0, top, w, STRIP_H);
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.strokeRect(0.5, top + 0.5, w - 1, STRIP_H - 1);

  // Density marks — every dated element in the world, faint; overlap builds
  // visible mass so the strip reads as the shape of the world's history.
  const marks = state.universe.length > 0 ? state.universe : state.nodes;
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  for (const n of marks) {
    const x = scale.toX(n.startDate);
    ctx.fillRect(x - 0.75, midY - 4, 1.5, 8);
  }

  // Ghost of the previous window, fading (S2).
  if (state.ghost) {
    const age = performance.now() - state.ghost.bornAt;
    const alpha = Math.max(0, 0.22 * (1 - age / GHOST_MS));
    if (alpha > 0.005) {
      const g0 = scale.toX(state.ghost.win.start);
      const g1 = scale.toX(state.ghost.win.end);
      ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.fillRect(g0, top + 2, Math.max(2, g1 - g0), STRIP_H - 4);
    }
  }

  // The viewport band — bright, draggable, edge-resizable.
  const b0 = scale.toX(view.start);
  const b1 = scale.toX(view.end);
  const bw = Math.max(4, b1 - b0);
  ctx.fillStyle = 'rgba(34,211,238,0.14)';
  ctx.fillRect(b0, top + 1, bw, STRIP_H - 2);
  ctx.strokeStyle = 'rgba(34,211,238,0.65)';
  ctx.lineWidth = 1;
  ctx.strokeRect(b0 + 0.5, top + 1.5, bw - 1, STRIP_H - 3);
  // Edge grips
  ctx.fillStyle = 'rgba(34,211,238,0.85)';
  ctx.fillRect(b0 - 1, midY - 5, 2, 10);
  ctx.fillRect(b0 + bw - 1, midY - 5, 2, 10);
}

/** Which strip control is under (mx,my), if any. */
function stripHit(state: ViewState, mx: number, my: number, w: number, h: number, view: TimeWindow):
  | { kind: 'left' | 'right' | 'band' | 'track' }
  | null {
  if (my < stripTop(h)) return null;
  const scale = stripScale(state, w);
  if (!scale) return null;
  const b0 = scale.toX(view.start);
  const b1 = scale.toX(view.end);
  if (Math.abs(mx - b0) <= STRIP_EDGE_GRAB) return { kind: 'left' };
  if (Math.abs(mx - b1) <= STRIP_EDGE_GRAB) return { kind: 'right' };
  if (mx > b0 && mx < b1) return { kind: 'band' };
  return { kind: 'track' };
}

function drawLabels(ctx: CanvasRenderingContext2D, state: ViewState, placed: PlacedDot[], w: number, anchorIds: Set<string>): void {
  // Build label candidates in PRIORITY order, then place greedily: a higher-
  // priority label claims its row-space first and any lower-priority label that
  // would collide simply drops. This keeps anchors legible even when several
  // cluster at the same dates (no overlapping-label smear) without forcing every
  // anchor to draw on top of its neighbour.
  const byId = new Map(placed.map(d => [d.node.id, d]));
  const cands: { dot: PlacedDot; pri: number }[] = [];
  const seen = new Set<string>();
  const push = (dot: PlacedDot | undefined, pri: number): void => {
    if (!dot || seen.has(dot.node.id)) return;
    seen.add(dot.node.id);
    cands.push({ dot, pri });
  };
  push(state.selectedId ? byId.get(state.selectedId) : undefined, 0);
  push(state.hoveredDot ?? undefined, 0);
  // anchors by degree desc (highest significance wins a contested row slot)
  for (const d of placed.filter(d => anchorIds.has(d.node.id)).sort((a, b) => b.node.degree - a.node.degree)) push(d, 1);
  // proximity reveal — the "explore the rest" layer, nearest first
  if (state.mouseX != null && state.mouseY != null) {
    const near = placed
      .map(d => ({ d, dist: Math.hypot(d.x - state.mouseX!, d.y - state.mouseY!) }))
      .filter(x => x.dist < LABEL_NEAR_RADIUS)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, LABEL_NEAR_MAX);
    for (const x of near) push(x.d, 2);
  }
  // Labels by default: offer EVERY on-screen node as a low-priority candidate;
  // the collision-avoider below fills in as many names as actually fit. More
  // become legible as you zoom because the density-fan spreads rows apart.
  // (Captain: "labels in the default view too.")
  for (const d of placed) push(d, 3);
  cands.sort((a, b) => a.pri - b.pri);

  // TRUE 2D placement: a label's bounding box must clear every already-placed
  // label AND every node glyph (except its own). The old check only compared
  // x within the same rounded y-row, so labels overprinted neighbouring glyphs
  // and labels one fan-level up/down — the dense-band smear. Greedy in priority
  // order: anchors + selection claim their space first, the rest fill the gaps.
  const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const glyphHalf = (d: PlacedDot): number => (anchorIds.has(d.node.id) ? ICON_ANCHOR : ICON_BASE) * 0.5 + 2;
  const glyphBoxes = placed.map(d => ({ id: d.node.id, box: boxAround(d.x, d.y, glyphHalf(d)) }));
  const placedBoxes: Box[] = [];
  state.labelBoxes = []; // rebuilt each draw — labels are click targets (S6)

  ctx.textBaseline = 'middle';
  for (const { dot } of cands) {
    const isSel = dot.node.id === state.selectedId;
    const isAnchor = anchorIds.has(dot.node.id);
    ctx.font = isAnchor ? '600 12px system-ui, sans-serif' : '11px system-ui, sans-serif';
    const text = truncate(dot.node.name, LABEL_MAX_CHARS);
    const tw = ctx.measureText(text).width;
    // Flip the label to the LEFT of the dot in the right third so it never clips
    // the panel edge (self-inspection finding).
    const flip = dot.x > w * 0.66;
    const off = isAnchor ? 12 : 9;
    const x0 = flip ? dot.x - off - tw : dot.x + off;
    const box: Box = { x0, x1: x0 + tw, y0: dot.y - 7, y1: dot.y + 7 };
    if (placedBoxes.some(b => overlaps(box, b))) continue;
    if (glyphBoxes.some(g => g.id !== dot.node.id && overlaps(box, g.box))) continue;
    placedBoxes.push(box);
    state.labelBoxes.push({ ...box, nodeId: dot.node.id });
    ctx.fillStyle = isSel ? 'rgba(255,255,255,0.95)' : isAnchor ? 'rgba(255,255,255,0.86)' : 'rgba(255,255,255,0.6)';
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(text, dot.x + (flip ? -off : off), dot.y);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ====== The DOM card (the wedge) ======

function renderCard(state: ViewState): void {
  const { card } = state;
  const node = state.selectedId ? state.nodes.find(n => n.id === state.selectedId) ?? null : null;
  if (!node) { card.style.display = 'none'; card.innerHTML = ''; return; }

  const dateStr = node.endDate != null ? `${node.startDate} – ${node.endDate}` : String(node.startDate);
  const icon = ELEMENT_ICONS[node.elementType as ElementType] ?? 'category';

  card.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'atlas-timeline-card-head';
  head.innerHTML =
    `<span class="material-symbols-outlined atlas-timeline-card-icon">${escapeText(icon)}</span>` +
    `<span class="atlas-timeline-card-title">${escapeText(node.name)}</span>` +
    `<button type="button" class="atlas-timeline-card-close" title="Close">×</button>`;
  head.querySelector('.atlas-timeline-card-close')!
    .addEventListener('click', () => state.onSelect('')); // empty → room clears selection
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'atlas-timeline-card-meta';
  meta.textContent = `${node.elementType} · ${dateStr}`;
  card.appendChild(meta);

  // Reverse links — elements that point AT this node (within the visible set; in
  // focus mode that's the full neighbourhood). `node.links` is the wedge FROM the
  // element; for link-TARGET elements (Locations, Species…) the story is who
  // points at them — so an empty forward card isn't a dead end.
  const reverse: LinkedRef[] = [];
  const seenRev = new Set<string>();
  for (const other of state.nodes) {
    if (other.id === node.id) continue;
    const l = other.links.find(x => x.id === node.id);
    if (l && !seenRev.has(other.id)) {
      seenRev.add(other.id);
      reverse.push({ id: other.id, type: other.elementType, name: other.name, fieldLabel: l.fieldLabel });
    }
  }

  const links = node.links;
  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'atlas-timeline-card-chips';
  if (links.length === 0 && reverse.length === 0) {
    const none = document.createElement('div');
    none.className = 'atlas-timeline-card-nolinks';
    none.textContent = 'No linked elements.';
    chipsWrap.appendChild(none);
  } else {
    // Forward links grouped by ROLE (fieldLabel) — Simmer's molecule: the event
    // is a hub, its links are spokes grouped by typed bond. 10 chips in 4 labeled
    // clusters reads; 10 bare chips don't.
    const groups = new Map<string, LinkedRef[]>();
    for (const link of links) {
      const g = groups.get(link.fieldLabel);
      if (g) g.push(link);
      else groups.set(link.fieldLabel, [link]);
    }
    for (const [label, refs] of groups) chipsWrap.appendChild(buildChipGroup(state, label, refs));
    // Reverse links — one "Referenced by" group (who points at this node).
    if (reverse.length > 0) chipsWrap.appendChild(buildChipGroup(state, 'Referenced by', reverse));
  }
  card.appendChild(chipsWrap);

  const actions = document.createElement('div');
  actions.className = 'atlas-timeline-card-actions';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'atlas-timeline-card-action';
  open.innerHTML = '<span>Open</span><span class="material-symbols-outlined">arrow_forward</span>';
  open.title = 'Open this element';
  open.addEventListener('click', () => state.onOpenElement(node.id));
  actions.appendChild(open);
  card.appendChild(actions);

  card.style.display = 'block';
  positionCard(state);
}

/** A labelled chip cluster (one role group) inside the card. */
function buildChipGroup(state: ViewState, label: string, refs: LinkedRef[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'atlas-timeline-card-group';
  const gl = document.createElement('div');
  gl.className = 'atlas-timeline-card-grouplabel';
  gl.textContent = label;
  group.appendChild(gl);
  const row = document.createElement('div');
  row.className = 'atlas-timeline-card-chiprow';
  for (const link of refs) row.appendChild(buildChip(state, link));
  group.appendChild(row);
  return group;
}

function buildChip(state: ViewState, link: LinkedRef): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'atlas-timeline-chip';
  chip.title = `${link.fieldLabel}: ${link.name} (${link.type}) · focus`;
  const icon = ELEMENT_ICONS[link.type as ElementType] ?? 'category';
  chip.innerHTML =
    `<span class="material-symbols-outlined">${escapeText(icon)}</span>` +
    `<span class="atlas-timeline-chip-name">${escapeText(link.name)}</span>`;
  chip.addEventListener('click', () => state.onSelect(link.id));
  return chip;
}

/** Anchor the card near the selected dot, kept inside the container bounds. */
function positionCard(state: ViewState): void {
  if (state.card.style.display === 'none') return;
  const dot = state.placedDots.find(d => d.node.id === state.selectedId);
  const rect = state.container.getBoundingClientRect();
  const cw = state.card.offsetWidth || 240;
  const ch = state.card.offsetHeight || 120;
  let left: number;
  let top: number;
  if (dot) {
    left = dot.x + 14;
    top = dot.y - 8;
    if (left + cw > rect.width - 8) left = dot.x - cw - 14; // flip left
    if (left < 8) left = 8;
    if (top + ch > rect.height - 8) top = rect.height - ch - 8;
    if (top < 8) top = 8;
  } else {
    left = rect.width - cw - 12;
    top = 12;
  }
  state.card.style.left = `${Math.round(left)}px`;
  state.card.style.top = `${Math.round(top)}px`;
}

// ====== Mouse / zoom / pan ======

function hitTest(state: ViewState, mx: number, my: number): PlacedDot | null {
  let found: PlacedDot | null = null;
  let bestDist = Infinity;
  for (const dot of state.placedDots) {
    const dist = Math.hypot(dot.x - mx, dot.y - my);
    if (dist < DOT_RADIUS_HOVER + 5 && dist < bestDist) { bestDist = dist; found = dot; }
  }
  if (found) return found;
  // Labels are click targets too (S6) — a name is a bigger, friendlier hit
  // area than a 14px glyph.
  for (const lb of state.labelBoxes) {
    if (mx >= lb.x0 && mx <= lb.x1 && my >= lb.y0 && my <= lb.y1) {
      return state.placedDots.find(d => d.node.id === lb.nodeId) ?? null;
    }
  }
  return null;
}

/** The date under a main-canvas x (uses the current on-screen window). */
function dateAtX(state: ViewState, x: number, w: number): number | null {
  const view = currentViewRange(state);
  if (!view) return null;
  const span = view.end - view.start;
  return span > 0 && w > 0 ? view.start + (x / w) * span : view.start;
}

function handleMouseMove(state: ViewState, e: MouseEvent): void {
  const rect = state.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const w = rect.width;
  const h = rect.height;
  state.mouseX = mx;
  state.mouseY = my;

  // Strip drags own the mouse while active (S2: the band is a control).
  if (state.stripDrag) {
    const scale = stripScale(state, w);
    if (scale) {
      const { mode, startX, startWin } = state.stripDrag;
      const dDate = scale.toDate(mx) - scale.toDate(startX);
      const bounds = scale.bounds;
      const minSpan = (bounds.max - bounds.min) / ZOOM_MAX;
      if (mode === 'move') {
        state.window = clampWindow({ start: startWin.start + dDate, end: startWin.end + dDate }, bounds);
      } else if (mode === 'left') {
        const start = Math.min(startWin.start + dDate, startWin.end - minSpan);
        state.window = clampWindow({ start, end: startWin.end }, bounds);
      } else {
        const end = Math.max(startWin.end + dDate, startWin.start + minSpan);
        state.window = clampWindow({ start: startWin.start, end }, bounds);
      }
      state.anim = null;
      draw(state);
    }
    return;
  }

  if (state.dragging && state.baseRange) {
    const view = currentViewRange(state);
    if (view) {
      const span = view.end - view.start;
      const pxPerUnit = span > 0 ? w / span : 0;
      if (pxPerUnit !== 0) {
        const dx = mx - state.dragStartX;
        if (Math.abs(dx) > 3) state.dragMoved = true;
        const startWin = state.dragStartWindow ?? view;
        const bounds = navBounds(state) ?? state.baseRange;
        state.window = clampWindow(
          { start: startWin.start - dx / pxPerUnit, end: startWin.end - dx / pxPerUnit },
          bounds,
        );
        state.anim = null;
      }
    }
    state.canvas.style.cursor = 'grabbing';
    draw(state);
    return;
  }

  // Hover cursor: strip controls get resize/grab affordances.
  const view = currentViewRange(state);
  if (view) {
    const sh = stripHit(state, mx, my, w, h, view);
    if (sh) {
      state.hoveredDot = null;
      state.canvas.style.cursor =
        sh.kind === 'left' || sh.kind === 'right' ? 'ew-resize'
        : sh.kind === 'band' ? 'grab'
        : 'pointer';
      draw(state);
      return;
    }
  }

  const found = hitTest(state, mx, my);
  state.hoveredDot = found;
  state.canvas.style.cursor = found ? 'pointer' : 'grab';
  draw(state); // redraw for hover + proximity labels following the cursor
}

function handleMouseLeave(state: ViewState): void {
  state.hoveredDot = null;
  state.mouseX = null;
  state.mouseY = null;
  state.canvas.style.cursor = 'default';
  draw(state);
}

function handleMouseDown(state: ViewState, e: MouseEvent): void {
  if (e.button !== 0) return;
  const rect = state.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const view = currentViewRange(state);

  // Strip interactions first (the strip owns its vertical band).
  if (view) {
    const sh = stripHit(state, mx, my, rect.width, rect.height, view);
    if (sh) {
      if (sh.kind === 'track') {
        // Jump: center the band on the clicked date, then drag continues as a move.
        const scale = stripScale(state, rect.width);
        if (scale) {
          const span = view.end - view.start;
          const c = scale.toDate(mx);
          state.window = clampWindow({ start: c - span / 2, end: c + span / 2 }, scale.bounds);
          state.anim = null;
          draw(state);
        }
        state.stripDrag = { mode: 'move', startX: mx, startWin: currentViewRange(state) ?? view };
      } else {
        state.stripDrag = { mode: sh.kind === 'band' ? 'move' : sh.kind, startX: mx, startWin: view };
      }
      return;
    }
  }

  state.dragging = true;
  state.dragMoved = false;
  state.dragStartX = mx;
  state.dragStartWindow = view;
}

function handleMouseUp(state: ViewState): void {
  if (state.stripDrag) {
    state.stripDrag = null;
    state.canvas.style.cursor = 'default';
    return;
  }
  if (!state.dragging) return;
  state.dragging = false;
  state.canvas.style.cursor = state.hoveredDot ? 'pointer' : 'grab';
  if (!state.dragMoved && state.hoveredDot) {
    state.onSelect(state.hoveredDot.node.id); // a click (not a drag) selects
    // Waypoint (hookmap wp6): a true canvas click — the URL-derived anchor
    // default and programmatic onSelect calls never pass through here.
    completeWaypoint('time');
  }
}

function handleWheel(state: ViewState, e: WheelEvent): void {
  if (!state.baseRange) return;
  e.preventDefault();
  const rect = state.canvas.getBoundingClientRect();
  const w = rect.width;
  const mx = e.clientX - rect.left;
  const view = currentViewRange(state);
  const bounds = navBounds(state) ?? state.baseRange;
  if (!view) return;
  const anchor = dateAtX(state, mx, w);
  if (anchor == null) return;
  const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
  state.window = zoomWindow(view, factor, anchor, bounds);
  state.anim = null;
  draw(state);
}

// ====== utils ======

/** An axis-aligned bounding box (label/glyph collision). */
interface Box { x0: number; x1: number; y0: number; y1: number; }

function boxAround(cx: number, cy: number, half: number): Box {
  return { x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

// icon-font readiness + applyAlpha now live in ./canvas-utils (shared with the
// static share renderer). Imported above.
