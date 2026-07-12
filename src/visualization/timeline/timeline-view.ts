/**
 * Timeline view — the interactive, room-grade chart renderer. Canvas + DOM
 * hybrid, the context-graph pattern:
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
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../../core/constants';
import { rankAnchors, ANCHOR_CAP } from './degree';
import { applyAlpha, ensureIconFont } from './canvas-utils';
import { completeWaypoint } from '../../core/waypoints';
import { openFieldEditPopover } from '../../ui/field-edit-popover';

const DOT_RADIUS = 4;             // placement radius for binning + hit-test base
const DOT_RADIUS_HOVER = 14;      // hit-test tolerance (px) — covers the WHOLE
                                  // drawn circle incl. ring, not just the icon
                                  // (S256, Captain: "icons a bit hard to click")
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
// S4 label budget: fan columns are NODE_X_GAP wide; each column may label at
// most one node per this many px of band height (weight-ranked; favorites +
// anchors are exempt). The remainder surfaces as a "+N" badge under the column.
const LABEL_BUDGET_PX_PER_ROW = 56;
const PLUS_BADGE_H = 14;         // badge hit-box height
const ZOOM_MAX = 200;            // max magnification vs the fitted span
const ZOOM_STEP = 1.2;
// Overview strip (sitdown S2) — the always-visible full-world reference frame
// under the main axis. The bright band is the viewport; drag/resize it there.
const STRIP_H = 26;
const STRIP_GAP = 8;
const STRIP_EDGE_GRAB = 5;       // px — band-edge resize hit tolerance
const GHOST_MS = 2500;           // previous-window ghost fade duration
const TRAVEL_MS = 280;           // focus-jump window animation
// The now-line (Act 1 / S11) — the seam between past and the forward half.
// Warm gold: "now" is consequential (craft: warm = consequential, cyan =
// appreciation), and it reads distinct from the cyan viewport band + cast marks.
const NOW_COLOR = '245, 180, 90';
const NOW_GRAB_PX = 6;           // px tolerance to grab the now-line for dragging
const FUTURE_NODE_ALPHA = 0.4;   // ahead-of-now glyphs render dim/hollow (S11)

export interface TimelineViewOptions {
  /**
   * PEEK (the 2026-07-10 split): a dot, label, or card chip was clicked →
   * show that element's card. NO routing — reading is free. Empty id clears.
   * The room may still route when the id isn't in the current scope.
   */
  onSelect: (elementId: string) => void;
  /** FOCUS — the explicit narrowing verb (the card's Focus action). The room
   *  turns this into a `/timeline/<id>` route change (Back walks the chain). */
  onFocus: (elementId: string) => void;
  /** The card's "Edit" action → the element's full inspect room. */
  onOpenElement: (elementId: string) => void;
  /**
   * The now-line was established or dragged (Act 1). The room persists this to
   * `World.time_current` (local — World-meta doesn't sync today) and re-renders.
   * null clears the now (removes the seam).
   */
  onSetNow?: (value: number | null) => void;
  /**
   * An undated rail element was dragged onto the axis and dropped at `date`
   * (Bout 1.2). The room writes the type's start-date field, refreshes, and
   * makes the element visible (peek-or-focus — it may fall outside the current
   * scope, so a bare write would silently vanish it, gate finding).
   */
  onDateElement?: (id: string, date: number) => void;
}

/** Render extras the room threads in alongside the node set (S4/S5). */
export interface TimelineViewExtras {
  /** The cast (protagonist/home nexus). Their labels always win the budget
   *  (S4) and their glyphs carry a persistent cyan mark + pin badge at every
   *  scope and zoom. Re-passed each render; last value sticks. */
  cast?: { protagonistId?: string | null; nexusId?: string | null };
  /**
   * The world's "now" (`World.time_current`) — draws the now-line + the forward
   * half (Act 1 / S11). `undefined` leaves the current value untouched; `null`
   * means the world has no now (no seam, no forward half — S11's "doesn't engage").
   */
  now?: number | null;
  /**
   * The work queue (Act 1, Bout 1.1): elements of dateable types with no date
   * yet. Shown in the ambient rail as the undated backlog so the gap between
   * "in the world" and "on the axis" is legible. `undefined` leaves it untouched.
   */
  undated?: Array<{ id: string; type: string; name: string }>;
}

export interface TimelineViewHandle {
  /**
   * The room passes already-scoped nodes (it owns the ChartConfig/scope), plus
   * the FULL dated universe for the overview strip's constant reference frame.
   */
  setNodes(nodes: TimelineNode[], universe?: TimelineNode[], extras?: TimelineViewExtras): void;
  setSelection(elementId: string | null): void;
  redraw(): void;
  destroy(): void;
}

/** The one viewport state: a visible time window in world-date units (S3). */
export interface TimeWindow { start: number; end: number }

interface LabelBox { x0: number; x1: number; y0: number; y1: number; nodeId: string }

/** A "+N" cluster badge — the label budget's honest remainder (S4). Click =
 *  zoom the window to that fan column's dates. */
interface PlusBadge { x0: number; x1: number; y0: number; y1: number; dateMin: number; dateMax: number; hidden: number }

interface ViewState {
  container: HTMLElement;
  canvasWrap: HTMLElement;      // the canvas's own flex cell — sizing reads THIS (the card dock is a sibling)
  canvas: HTMLCanvasElement;
  card: HTMLElement;
  // Expanded chip groups on the docked card ("+N more" toggles); reset on
  // selection change so every card opens in its budgeted state.
  expandedGroups: Set<string>;
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
  // "+N" cluster badges from the last draw — click targets (zoom to cluster).
  plusBadges: PlusBadge[];
  // Cast favorites (S4): labels always win the budget; glyphs get the mark.
  favoriteIds: Set<string>;
  protagonistId: string | null;
  nexusId: string | null;
  onFocus: (id: string) => void;
  // cursor (canvas coords; null when outside) — drives proximity labels
  mouseX: number | null;
  mouseY: number | null;
  // drag-pan (main canvas) + strip drags
  dragging: boolean;
  dragStartX: number;
  dragStartWindow: TimeWindow | null;
  dragMoved: boolean;
  stripDrag: { mode: 'move' | 'left' | 'right'; startX: number; startWin: TimeWindow } | null;
  // The world's now (Act 1). null = no now set (no seam). During a now-line drag
  // this holds the live preview; committed to disk on mouseup via onSetNow.
  now: number | null;
  nowDrag: boolean;             // a now-line drag is in progress (owns the mouse)
  onSetNow: ((value: number | null) => void) | null;
  // The undated backlog (Bout 1.1) — dateable elements with no date, shown in
  // the ambient rail. Expanded type groups persist across re-renders.
  undated: Array<{ id: string; type: string; name: string }>;
  undatedExpanded: Set<string>;
  // Drag-to-date (Bout 1.2): a rail item is being dragged onto the axis. Holds
  // the element DATA (not the DOM node — survives a mid-drag rail rebuild), the
  // start point + moved-past-threshold flag (click vs drag), and the floating
  // ghost. `dropDate` = the snapped date under the cursor when over the band.
  dateDrag: {
    id: string; type: string; name: string;
    startX: number; startY: number; active: boolean; ghost: HTMLElement | null;
  } | null;
  dropDate: number | null;
  onDateElement: ((id: string, date: number) => void) | null;
  // Bound window listeners for an in-flight date-drag — stored so both
  // endDateDrag() and destroy() can remove them (they're added per-drag).
  dateDragMove: ((e: MouseEvent) => void) | null;
  dateDragUp: ((e: MouseEvent) => void) | null;
  destroyed: boolean;           // set on destroy(); guards late async redraws
  onSelect: (id: string) => void;
  onOpenElement: (id: string) => void;
}

export function mountTimelineView(target: HTMLElement, opts: TimelineViewOptions): TimelineViewHandle {
  target.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'atlas-timeline-view';
  // S7: the card DOCKS on the right — it reserves layout space beside the
  // canvas and never floats over data. (Right-vs-bottom was prototyped
  // 2026-07-10; right won: full group visibility, vertical scan.)
  container.dataset.dock = 'right';
  target.appendChild(container);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'atlas-timeline-view-canvaswrap';
  container.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.className = 'atlas-timeline-view-canvas';
  canvasWrap.appendChild(canvas);

  const card = document.createElement('div');
  card.className = 'atlas-timeline-card';
  card.style.display = 'none';
  container.appendChild(card);

  const state: ViewState = {
    container, canvasWrap, canvas, card,
    expandedGroups: new Set(),
    nodes: [], universe: [], placedDots: [], hoveredDot: null, selectedId: null,
    window: null, baseRange: null,
    anim: null, ghost: null, rafPending: false,
    layoutSig: null, layoutNodes: null,
    labelBoxes: [],
    plusBadges: [],
    favoriteIds: new Set(),
    protagonistId: null,
    nexusId: null,
    onFocus: opts.onFocus,
    mouseX: null, mouseY: null,
    dragging: false, dragStartX: 0, dragStartWindow: null, dragMoved: false,
    stripDrag: null,
    now: null, nowDrag: false, onSetNow: opts.onSetNow ?? null,
    undated: [], undatedExpanded: new Set(),
    dateDrag: null, dropDate: null, onDateElement: opts.onDateElement ?? null,
    dateDragMove: null, dateDragUp: null,
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

  // Observe the canvas CELL — when the docked card mounts/unmounts, the cell
  // reflows and the chart redraws to its new width/height.
  const ro = new ResizeObserver(() => draw(state));
  ro.observe(canvasWrap);

  // Material Symbols may not be in the FontFaceSet at first paint (the DOM card
  // that also uses it starts hidden) — load it, then redraw so any first-frame
  // fallback glyphs upgrade in place. (craft #89)
  void ensureIconFont().then(() => draw(state));

  return {
    setNodes(nodes: TimelineNode[], universe?: TimelineNode[], extras?: TimelineViewExtras): void {
      const prevView = currentViewRange(state);
      const prevBase = state.baseRange;
      state.nodes = nodes;
      if (universe) state.universe = universe;
      if (extras?.cast) {
        state.protagonistId = extras.cast.protagonistId ?? null;
        state.nexusId = extras.cast.nexusId ?? null;
        state.favoriteIds = new Set([state.protagonistId, state.nexusId]
          .filter((x): x is string => !!x));
      }
      // `undefined` = leave as-is; `null`/number = set. Never clobber a live
      // drag preview (a background re-render mid-drag would snap the line back).
      if (extras && 'now' in extras && !state.nowDrag) state.now = extras.now ?? null;
      if (extras && 'undated' in extras) state.undated = extras.undated ?? [];
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
      state.expandedGroups.clear(); // every card opens budgeted (S7)
      draw(state);
      renderCard(state);
    },
    redraw(): void { draw(state); },
    destroy(): void {
      state.destroyed = true;
      endDateDrag(state); // remove per-drag window listeners + the floating ghost (gate: no leak on mid-drag unmount)
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

// ====== The now-line / forward half (Act 1, S11) ======

/** Where a node sits relative to the world's now. Pure — the load-bearing
 *  classification for forward-half rendering (dim future glyphs, split
 *  straddling range-lines at the seam). No now → everything is 'past' (solid,
 *  unchanged behavior). A point node exactly AT now counts as past (the seam is
 *  inclusive-past); a range is 'straddle' only when now falls strictly inside. */
export type NowRelation = 'past' | 'future' | 'straddle';
export function rangeVsNow(startDate: number, endDate: number | null, now: number | null): NowRelation {
  if (now == null) return 'past';
  if (endDate != null && endDate > startDate) {
    if (endDate <= now) return 'past';
    if (startDate >= now) return 'future';
    return 'straddle';
  }
  return startDate > now ? 'future' : 'past';
}

/** The y of the axis line = top of the reserved axis-labels + strip band. */
function axisYOf(h: number): number { return h - AXIS_LABEL_HEIGHT - STRIP_H - STRIP_GAP; }

/** Canvas x for a world date under the current on-screen window (inverse of
 *  dateAtX). null when there's no view yet. */
function xAtDate(state: ViewState, date: number, w: number): number | null {
  const view = currentViewRange(state);
  if (!view) return null;
  const span = view.end - view.start;
  return span > 0 ? ((date - view.start) / span) * w : 0;
}

/** A default axis range for an EMPTY chart (no dated nodes) so the first
 *  element can still be dragged onto it. Centers on the now if set, else neutral. */
function emptyChartRange(state: ViewState): { min: number; max: number } {
  if (state.now != null) return { min: state.now - 50, max: state.now + 50 };
  return { min: 0, max: 100 };
}

/** The now-line's canvas x, or null when there's no now or it's off-screen. */
function nowLineX(state: ViewState, w: number): number | null {
  if (state.now == null) return null;
  const x = xAtDate(state, state.now, w);
  if (x == null || x < -1 || x > w + 1) return null;
  return x;
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
  gaps?: { x: number; y: number },
): PlacedDot[] {
  const gapX = gaps?.x ?? NODE_X_GAP;
  const gapY = gaps?.y ?? NODE_Y_GAP;
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
  // Range-bearing nodes (narrative/construct/title spans) OCCUPY their whole
  // x-span as a lane (S256, Captain on fx-2: point-events sitting exactly ON a
  // range line read as membership, which is a coincidence of the midline rule,
  // not a fact). Later nodes whose date falls inside a placed span step off
  // that lane — near-the-line stays (related in time); on-the-line stops lying.
  const lanes: { x0: number; x1: number; y: number }[] = [];
  for (const node of order) {
    const x = dateToX(node.startDate);
    if (x < -40 || x > w + 40) continue;
    const free = (cy: number): boolean =>
      cy >= top && cy <= bottom
      && !placed.some(p => Math.abs(p.x - x) < gapX && Math.abs(p.y - cy) < gapY)
      && !lanes.some(r => x >= r.x0 - gapX && x <= r.x1 + gapX && r.y !== undefined && Math.abs(r.y - cy) < gapY);
    let y = centerY;
    if (!free(y)) {
      let found = false;
      const maxK = Math.ceil(span / gapY) + 1;
      for (let k = 1; k <= maxK && !found; k++) {
        const up = centerY - k * gapY;
        const down = centerY + k * gapY;
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
        y = Math.min(bottom, Math.max(top, centerY + dir * k * gapY));
      }
    }
    placed.push({ node, x, y, radius: DOT_RADIUS });
    if (node.endDate != null && node.endDate > node.startDate) {
      const x1 = Math.min(w + 40, dateToX(node.endDate));
      if (x1 > x) lanes.push({ x0: x, x1, y });
    }
  }
  return placed;
}

// ====== Drawing ======

function draw(state: ViewState): void {
  if (state.destroyed) return; // a late font-load/ResizeObserver tick after destroy()
  const { canvas, canvasWrap } = state;
  const rect = canvasWrap.getBoundingClientRect();
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

  // An EMPTY chart still draws a droppable axis (Bout 1.2): you can drag the
  // FIRST element onto it, even with nothing dated yet. The range comes from the
  // universe (dated elsewhere but filtered out here), else a sensible default
  // around the now / a neutral span. The node rendering is skipped below.
  const emptyChart = state.nodes.length === 0;
  const base = emptyChart
    ? (state.universe.length > 0 ? calculateTimeRange(state.universe) : emptyChartRange(state))
    : calculateTimeRange(state.nodes);
  state.baseRange = base;
  if (emptyChart) { state.placedDots = []; state.labelBoxes = []; }
  const view = currentViewRange(state) ?? { start: base.min, end: base.max };
  const range = { min: view.start, max: view.end };
  const dateToX = createDateToX(range, w);
  const ticks = calculateTicks(range, w);
  // The overview strip reserves the bottom band (S2).
  const axisY = axisYOf(h);
  // The now (Act 1): its canvas x, and the forward-half tint. null when unset.
  const nowX = state.now != null ? xAtDate(state, state.now, w) : null;

  // The forward half (S11): everything ahead of now sits in a faint cool haze,
  // so past and future read as different regions before you even see a glyph.
  if (nowX != null && nowX < w) {
    const fx = Math.max(0, nowX);
    ctx.fillStyle = 'rgba(150, 170, 200, 0.05)';
    ctx.fillRect(fx, TOP_PAD, w - fx, axisY - TOP_PAD);
  }

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

  // Empty chart: a hint over the droppable axis (no nodes to render). The
  // now-line, drop-guide, and strip still draw so a first drag reads + lands.
  if (emptyChart) {
    ctx.textAlign = 'center';
    ctx.font = '13px system-ui, sans-serif';
    const midY = (TOP_PAD + axisY) / 2;
    if (state.undated.length > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.42)';
      ctx.fillText('Drag an element from the list onto the line to give it a date.', w / 2, midY);
    } else if (state.universe.length === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillText('Nothing in this world has a date yet.', w / 2, midY - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillText('Add an event above, then drag it onto the line.', w / 2, midY + 10);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillText('Nothing dated in this view.', w / 2, midY);
    }
    ctx.textAlign = 'left';
    drawNowLine(ctx, state, w, axisY);
    drawDropGuide(ctx, state, w, axisY);
    drawStrip(ctx, state, w, h, view);
    return;
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
    // Sparse sets (the tableau, small worlds) spread out — the default gaps
    // are tuned for dense sets, and at ~22 nodes they cram the middle while
    // the band sits empty (Captain: "space it all out better"). Node count is
    // part of layoutSig, so the gap choice re-derives with the set.
    const gaps = state.nodes.length <= 30 ? { x: 84, y: 60 } : undefined;
    state.placedDots = computeBeeswarm(state.nodes, anchorIds, dateToX, w, axisY, gaps);
    state.layoutSig = layoutSig;
    state.layoutNodes = state.nodes;
  }
  const placed = state.placedDots;

  // Range lines (endDate). A range that spans the now-line renders half-solid
  // (past) / half-dim (future) — the seam runs through the bar (Act 1).
  for (const dot of placed) {
    if (dot.node.endDate == null) continue;
    const x2 = dateToX(dot.node.endDate);
    const rel = rangeVsNow(dot.node.startDate, dot.node.endDate, state.now);
    ctx.lineWidth = 2;
    if (rel === 'straddle' && nowX != null) {
      ctx.beginPath();
      ctx.moveTo(dot.x, dot.y);
      ctx.lineTo(nowX, dot.y);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.30);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(nowX, dot.y);
      ctx.lineTo(x2, dot.y);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.12);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(dot.x, dot.y);
      ctx.lineTo(x2, dot.y);
      ctx.strokeStyle = applyAlpha(dot.node.color, rel === 'future' ? 0.12 : 0.30);
      ctx.stroke();
    }
  }

  // Labels — priority tiers (selected/hover → favorites → anchors → proximity),
  // then a WEIGHT-RANKED PER-COLUMN BUDGET for the rest (S4): each fan column
  // labels its heaviest nodes up to a space-proportional budget; the remainder
  // surfaces as a clickable "+N" badge (zoom to cluster) instead of a smear.
  drawLabels(ctx, state, placed, w, axisY, anchorIds);

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
    const isCast = dot.node.id === state.protagonistId || dot.node.id === state.nexusId;
    // Ahead of now → dim/hollow (S11 fieldless forward render), unless the user
    // is reading it (selected/hover stays full so it's legible on interaction).
    const isFuture = rangeVsNow(dot.node.startDate, dot.node.endDate, state.now) === 'future'
      && !isSel && !isHover;
    // The cast outranks anchors visually — a protagonist that's hard to find
    // defeats the whole cast system (Captain, 2026-07-10).
    const size = isSel ? ICON_SELECTED
      : isCast ? ICON_ANCHOR + detail + 5
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
      // Two-ring selection mark (S256, Captain: the old single 0.55-alpha ring
      // "only has a slightly different border" — hard to find): a soft outer
      // halo in the type color + a crisp near-white inner ring. Still quiet at
      // canvas scale, but unmistakable when you look for it.
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, ringR + 8, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.3);
      ctx.lineWidth = 3.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, ringR + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
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
    ctx.fillStyle = isFuture ? applyAlpha(dot.node.color, FUTURE_NODE_ALPHA) : dot.node.color;
    ctx.fillText(icon, dot.x, dot.y);

    // The cast signal (revised 2026-07-10, Captain: ring + corner badge were
    // "a bit much"): a modest size boost (above) + the BRIGHT CYAN LABEL do
    // the signifying — quiet, fitting the style, still unmistakable.
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // The now-line — drawn over the glyphs, the seam between past and future.
  drawNowLine(ctx, state, w, axisY);

  // The drop guide (Bout 1.2) — a cyan dashed seam + "= N" while dragging a
  // rail element onto the axis. Cyan = "you're placing this" (vs the warm now).
  drawDropGuide(ctx, state, w, axisY);

  // Cluster badges LAST in the band — they must read over the glyphs they count.
  drawClusterBadges(ctx, state, placed, w, axisY);

  drawStrip(ctx, state, w, h, view);
}

/** The drop guide (Bout 1.2) — a cyan dashed line + "= N" tag at the snapped
 *  drop date while dragging a rail element over the axis. */
function drawDropGuide(ctx: CanvasRenderingContext2D, state: ViewState, w: number, axisY: number): void {
  if (state.dropDate == null) return;
  const x = xAtDate(state, state.dropDate, w);
  if (x == null || x < 0 || x > w) return;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = 'rgba(34,211,238,0.9)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, TOP_PAD - 4);
  ctx.lineTo(x, axisY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '600 11px system-ui, sans-serif';
  const label = `= ${state.dropDate}`;
  const tw = ctx.measureText(label).width;
  const tagW = tw + 12;
  const tagH = 16;
  const tagX = Math.min(w - tagW - 2, Math.max(2, x - tagW / 2));
  const tagY = axisY - tagH - 2; // sit just above the axis, clear of the now-tag up top
  ctx.fillStyle = 'rgba(34,211,238,0.95)';
  ctx.beginPath();
  ctx.roundRect(tagX, tagY, tagW, tagH, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(8,12,16,0.98)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, tagX + tagW / 2, tagY + tagH / 2 + 0.5);
  ctx.restore();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** The now-line + its live value tag (Act 1). A soft warm glow under a crisp
 *  line; the tag shows the raw value (calendar formatting arrives in Act 2). */
function drawNowLine(ctx: CanvasRenderingContext2D, state: ViewState, w: number, axisY: number): void {
  const x = nowLineX(state, w);
  if (x == null || state.now == null) return;
  const top = TOP_PAD - 4;
  ctx.strokeStyle = `rgba(${NOW_COLOR}, 0.14)`;
  ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, axisY); ctx.stroke();
  ctx.strokeStyle = `rgba(${NOW_COLOR}, 0.72)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, axisY); ctx.stroke();

  // "now" tag riding the top of the line (clamped inside the canvas).
  ctx.font = '600 10px system-ui, sans-serif';
  const label = `now · ${Math.round(state.now)}`;
  const tw = ctx.measureText(label).width;
  const tagW = tw + 12;
  const tagH = 15;
  const tagX = Math.min(w - tagW - 2, Math.max(2, x - tagW / 2));
  const tagY = 1;
  ctx.fillStyle = `rgba(${NOW_COLOR}, 0.92)`;
  ctx.beginPath();
  ctx.roundRect(tagX, tagY, tagW, tagH, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(12,14,18,0.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, tagX + tagW / 2, tagY + tagH / 2 + 0.5);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
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

  // The now marker on the strip — the seam, visible however narrow the window (S2).
  if (state.now != null) {
    const nx = scale.toX(state.now);
    if (nx >= 0 && nx <= w) {
      ctx.strokeStyle = `rgba(${NOW_COLOR}, 0.8)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nx, top);
      ctx.lineTo(nx, top + STRIP_H);
      ctx.stroke();
    }
  }
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

/** S4 label weight: connectivity + how much is actually written about it.
 *  Favorites don't need a boost here — they're pushed as their own tier. */
function labelWeight(n: TimelineNode): number {
  return n.degree + Math.log10(1 + n.contentMass);
}

function drawLabels(ctx: CanvasRenderingContext2D, state: ViewState, placed: PlacedDot[], w: number, axisY: number, anchorIds: Set<string>): void {
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
  // favorites always win (S4) — ahead of anchors, exempt from the budget
  for (const d of placed.filter(d => state.favoriteIds.has(d.node.id))) push(d, 1);
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
  // S4: the rest go through a WEIGHT-RANKED PER-COLUMN BUDGET (this replaced
  // the offer-everything tier, which at broad spans degraded into a first-come
  // smear — the label wall was a scale problem, but the budget is what makes
  // the default window honest about what it drops).
  const colOf = (d: PlacedDot): number => Math.floor(d.x / NODE_X_GAP);
  const byCol = new Map<number, PlacedDot[]>();
  for (const d of placed) {
    if (seen.has(d.node.id)) continue;
    const c = colOf(d);
    const arr = byCol.get(c);
    if (arr) arr.push(d); else byCol.set(c, [d]);
  }
  const budget = Math.max(1, Math.floor((axisY - TOP_PAD) / LABEL_BUDGET_PX_PER_ROW));
  for (const dots of byCol.values()) {
    dots.sort((a, b) => labelWeight(b.node) - labelWeight(a.node));
    for (const d of dots.slice(0, budget)) push(d, 3);
  }
  cands.sort((a, b) => a.pri - b.pri);

  // TRUE 2D placement: a label's bounding box must clear every already-placed
  // label AND every node glyph (except its own). The old check only compared
  // x within the same rounded y-row, so labels overprinted neighbouring glyphs
  // and labels one fan-level up/down — the dense-band smear. Greedy in priority
  // order: anchors + selection claim their space first, the rest fill the gaps.
  const overlaps = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
  const isCastId = (id: string): boolean => id === state.protagonistId || id === state.nexusId;
  // Collision extent must include the RINGS, not just the glyph — labels were
  // overprinting anchor halos and the cast rings (Captain's "labels are weird").
  const glyphHalf = (d: PlacedDot): number =>
    isCastId(d.node.id) ? 16
    : anchorIds.has(d.node.id) ? 21
    : ICON_BASE * 0.5 + 2;
  const glyphBoxes = placed.map(d => ({ id: d.node.id, box: boxAround(d.x, d.y, glyphHalf(d)) }));
  const placedBoxes: Box[] = [];
  state.labelBoxes = []; // rebuilt each draw — labels are click targets (S6)

  ctx.textBaseline = 'middle';
  for (const { dot } of cands) {
    const isSel = dot.node.id === state.selectedId;
    const isAnchor = anchorIds.has(dot.node.id);
    const isCast = isCastId(dot.node.id);
    ctx.font = isCast ? '600 12.5px system-ui, sans-serif'
      : isAnchor ? '600 12px system-ui, sans-serif'
      : '11px system-ui, sans-serif';
    const text = truncate(dot.node.name, LABEL_MAX_CHARS);
    const tw = ctx.measureText(text).width;
    // Offsets clear the visual extent (anchor halos reach ~ringR+8).
    const off = isCast ? 18 : isAnchor ? 16 : 10;
    const gh = glyphHalf(dot);
    // Candidate positions in preference order: beside the glyph first (panel-
    // edge flip preserved), then ABOVE/BELOW it. In multi-column eras a side
    // label always crosses the next column, so without the vertical fallbacks
    // whole columns starve while half the band sits empty (live finding).
    // RANGE nodes flip the preference: a side label sits ON the range line
    // and reads struck-through, so they try above/below first.
    const sideFirst: Array<'right' | 'left'> = dot.x > w * 0.66 ? ['left', 'right'] : ['right', 'left'];
    const sideAttempts: Array<{ box: Box; align: CanvasTextAlign; tx: number; ty: number }> = [];
    for (const side of sideFirst) {
      const x0 = side === 'left' ? dot.x - off - tw : dot.x + off;
      sideAttempts.push({
        box: { x0, x1: x0 + tw, y0: dot.y - 7, y1: dot.y + 7 },
        align: side === 'left' ? 'right' : 'left',
        tx: dot.x + (side === 'left' ? -off : off), ty: dot.y,
      });
    }
    // BELOW before above — one consistent direction reads as a system where a
    // mix reads as scatter (Captain: "labels are still random").
    const vertAttempts: Array<{ box: Box; align: CanvasTextAlign; tx: number; ty: number }> = [];
    for (const dir of [1, -1]) {
      const cy = dot.y + dir * (gh + 8);
      vertAttempts.push({
        box: { x0: dot.x - tw / 2, x1: dot.x + tw / 2, y0: cy - 7, y1: cy + 7 },
        align: 'center', tx: dot.x, ty: cy,
      });
    }
    // Point nodes: right → below → left → above (the S256 lab sliver). A
    // left-side label sits BETWEEN two dots and reads as ambiguous ownership;
    // below is the clearer second choice. Range nodes keep vertical-first
    // (a side label sits ON the range line and reads struck-through).
    const attempts = dot.node.endDate != null
      ? [...vertAttempts, ...sideAttempts]
      : [sideAttempts[0], vertAttempts[0], sideAttempts[1], vertAttempts[1]];
    // Collision test with a 5px horizontal breathing pad — a label ENDING
    // flush at the next glyph reads as one word ("Captain SnootPip", live).
    const padded = (b: Box): Box => ({ x0: b.x0 - 5, x1: b.x1 + 5, y0: b.y0, y1: b.y1 });
    // Vertical bounds keep labels INSIDE the band — an above-label near the
    // top edge was getting clipped mid-glyph (Captain's sshot).
    const fit = attempts.find(a =>
      a.box.x0 >= 2 && a.box.x1 <= w - 2
      && a.box.y0 >= 2 && a.box.y1 <= axisY - 2
      && !placedBoxes.some(b => overlaps(padded(a.box), b))
      && !glyphBoxes.some(g => g.id !== dot.node.id && overlaps(padded(a.box), g.box)));
    if (!fit) continue;
    placedBoxes.push(fit.box);
    state.labelBoxes.push({ ...fit.box, nodeId: dot.node.id });
    ctx.fillStyle = isSel ? 'rgba(255,255,255,0.95)'
      : isCast ? 'rgba(34,211,238,0.95)'   // bright cyan = the cast signal
      : isAnchor ? 'rgba(255,255,255,0.86)'
      : 'rgba(255,255,255,0.6)';
    ctx.textAlign = fit.align;
    ctx.fillText(text, fit.tx, fit.ty);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/**
 * "+N" cluster badges — the budget's honest remainder (S4). Adjacent starved
 * columns merge into one badge (a dense era reads as one cluster, and the
 * zoom-to-cluster target is that era's whole span, not one 42px sliver).
 * Drawn AFTER the glyph pass — a badge buried under glyphs is a silent drop,
 * which is exactly what the badge exists to prevent (live-inspection finding).
 */
function drawClusterBadges(ctx: CanvasRenderingContext2D, state: ViewState, placed: PlacedDot[], w: number, axisY: number): void {
  state.plusBadges = [];
  const labelled = new Set(state.labelBoxes.map(b => b.nodeId));
  const colOf2 = (d: PlacedDot): number => Math.floor(d.x / NODE_X_GAP);
  const colDots = new Map<number, PlacedDot[]>();
  for (const d of placed) {
    const c = colOf2(d);
    const arr = colDots.get(c);
    if (arr) arr.push(d); else colDots.set(c, [d]);
  }
  const starved = [...colDots.entries()]
    .map(([c, dots]) => ({ c, dots, hidden: dots.filter(d => !labelled.has(d.node.id)).length }))
    .filter(e => e.hidden > 0)
    .sort((a, b) => a.c - b.c);
  type Run = { dots: PlacedDot[]; hidden: number; lastCol: number };
  const runs: Run[] = [];
  for (const e of starved) {
    const prev = runs[runs.length - 1];
    if (prev && e.c - prev.lastCol <= 1) {
      prev.dots.push(...e.dots);
      prev.hidden += e.hidden;
      prev.lastCol = e.c;
    } else {
      runs.push({ dots: [...e.dots], hidden: e.hidden, lastCol: e.c });
    }
  }
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const run of runs) {
    const xs = run.dots.map(d => d.x);
    const dates = run.dots.map(d => d.node.startDate);
    const text = `+${run.hidden}`;
    const tw = ctx.measureText(text).width;
    // Clamp inside the canvas — edge clusters otherwise clip their badge
    // (live-inspection finding: the right-edge "+29" was half off-screen).
    const cx = Math.min(w - tw / 2 - 6, Math.max(tw / 2 + 6, (Math.min(...xs) + Math.max(...xs)) / 2));
    const y = axisY - 6;
    const box: PlusBadge = {
      x0: cx - tw / 2 - 5, x1: cx + tw / 2 + 5,
      y0: y - PLUS_BADGE_H / 2, y1: y + PLUS_BADGE_H / 2,
      dateMin: Math.min(...dates), dateMax: Math.max(...dates),
      hidden: run.hidden,
    };
    // Dark pill backing keeps the badge legible over bottom-row glyphs.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.roundRect(box.x0, box.y0, box.x1 - box.x0, PLUS_BADGE_H, 7);
    ctx.fill();
    ctx.fillStyle = 'rgba(34,211,238,0.75)';
    ctx.fillText(text, cx, y + 0.5);
    state.plusBadges.push(box);
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

/** The "+N" badge under (mx,my), if any — badges are zoom-to-cluster targets. */
function badgeAt(state: ViewState, mx: number, my: number): PlusBadge | null {
  return state.plusBadges.find(b => mx >= b.x0 && mx <= b.x1 && my >= b.y0 && my <= b.y1) ?? null;
}

/** Animate the window to a cluster's span (the "+N" click, S4). */
function zoomToCluster(state: ViewState, badge: PlusBadge): void {
  const view = currentViewRange(state);
  const bounds = navBounds(state) ?? state.baseRange;
  if (!view || !bounds) return;
  const boundsSpan = Math.max(1e-9, bounds.max - bounds.min);
  const pad = Math.max((badge.dateMax - badge.dateMin) * 0.2, boundsSpan / 200);
  const target = clampWindow({ start: badge.dateMin - pad, end: badge.dateMax + pad }, bounds);
  state.ghost = { win: view, bornAt: performance.now() };
  state.anim = { from: view, to: target, t0: performance.now() };
  state.window = target;
  scheduleMotion(state);
}

// ====== The DOM card (the wedge) ======

function renderCard(state: ViewState): void {
  const { card } = state;
  const node = state.selectedId ? state.nodes.find(n => n.id === state.selectedId) ?? null : null;
  // The rail is ALWAYS reserved (no canvas reflow when a peek opens — the
  // "jump" complaint, 2026-07-10). Nothing peeked → ambient content.
  if (!node) { renderAmbientRail(state); return; }

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

  // Description snippet (S7 content budget) — the one-breath answer to
  // "what is this?" before the chips answer "what does it touch?".
  if (node.snippet) {
    const snip = document.createElement('div');
    snip.className = 'atlas-timeline-card-snippet';
    snip.textContent = node.snippet;
    card.appendChild(snip);
  }

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

  // Focus = the routing verb (narrows the chart to this element's
  // neighbourhood, URL-backed so browser Back walks out). Edit = the full
  // inspect room. Peek (just clicking) stays free of both.
  const actions = document.createElement('div');
  actions.className = 'atlas-timeline-card-actions';
  const focus = document.createElement('button');
  focus.type = 'button';
  focus.className = 'atlas-timeline-card-action';
  focus.innerHTML = '<span class="material-symbols-outlined">filter_center_focus</span><span>Focus</span>';
  focus.title = 'Narrow the chart to this element and its connections';
  focus.addEventListener('click', () => state.onFocus(node.id));
  actions.appendChild(focus);
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'atlas-timeline-card-action';
  edit.innerHTML = '<span class="material-symbols-outlined">edit</span><span>Edit</span>';
  edit.title = 'Open this element for editing';
  edit.addEventListener('click', () => state.onOpenElement(node.id));
  actions.appendChild(edit);
  card.appendChild(actions);

  card.style.display = 'flex';
}

/**
 * The rail's resting state: a quiet legend of what's on the chart, the cast,
 * and the interaction hint. Ambient orientation, not chrome — the rail exists
 * so peeks never reflow the canvas.
 */
function renderAmbientRail(state: ViewState): void {
  const { card } = state;
  card.innerHTML = '';

  // Nothing charted (dateless or empty world): the canvas empty state teaches
  // the next step. Stay quiet about the chart itself, but the undated backlog
  // is exactly the "here's what you could place" call to action (Bout 1.1).
  if (state.nodes.length === 0) {
    const undated = buildUndatedSection(state);
    if (undated) card.appendChild(undated);
    card.style.display = 'flex';
    return;
  }

  const head = document.createElement('div');
  head.className = 'atlas-timeline-rail-head';
  head.textContent = 'This chart';
  card.appendChild(head);

  // Cast lines — only when the cast is actually on the chart.
  const castRows: Array<{ icon: string; label: string; node: TimelineNode }> = [];
  const prot = state.protagonistId ? state.nodes.find(n => n.id === state.protagonistId) : undefined;
  const nex = state.nexusId ? state.nodes.find(n => n.id === state.nexusId) : undefined;
  if (prot) castRows.push({ icon: 'person_pin', label: 'protagonist', node: prot });
  if (nex) castRows.push({ icon: 'home_pin', label: 'home', node: nex });
  for (const row of castRows) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'atlas-timeline-rail-cast';
    el.innerHTML =
      `<span class="material-symbols-outlined">${row.icon}</span>` +
      `<span class="atlas-timeline-rail-cast-name">${escapeText(row.node.name)}</span>` +
      `<span class="atlas-timeline-rail-cast-role">${row.label}</span>`;
    el.title = `Read ${row.node.name}`;
    el.addEventListener('click', () => state.onSelect(row.node.id));
    card.appendChild(el);
  }

  // Type legend — what the marks mean, with in-view counts.
  const counts = new Map<string, number>();
  for (const n of state.nodes) counts.set(n.elementType, (counts.get(n.elementType) ?? 0) + 1);
  const legend = document.createElement('div');
  legend.className = 'atlas-timeline-rail-legend';
  for (const [type, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    const row = document.createElement('div');
    row.className = 'atlas-timeline-rail-legend-row';
    const color = ELEMENT_TYPE_COLORS[type as ElementType] ?? '#94a3b8';
    row.innerHTML =
      `<span class="material-symbols-outlined" style="color:${color}">${ELEMENT_ICONS[type as ElementType] ?? 'category'}</span>` +
      `<span>${escapeText(type)}</span><span class="atlas-timeline-rail-legend-count">${count}</span>`;
    legend.appendChild(row);
  }
  card.appendChild(legend);

  // The work queue (Bout 1.1): the undated backlog, below the legend.
  const undated = buildUndatedSection(state);
  if (undated) card.appendChild(undated);

  card.style.display = 'flex';
}

/**
 * The undated backlog section for the ambient rail (Bout 1.1) — dateable
 * elements with no date, grouped by type, each opening its element room to be
 * dated. Returns null when nothing is undated. (Bout 1.2 makes these draggable
 * straight onto the axis; for now, click-through to the editor.)
 */
function buildUndatedSection(state: ViewState): HTMLElement | null {
  if (state.undated.length === 0) return null;
  const PER_TYPE_CAP = 6;

  const wrap = document.createElement('div');
  wrap.className = 'atlas-timeline-rail-undated';

  const head = document.createElement('div');
  head.className = 'atlas-timeline-rail-undated-head';
  head.innerHTML =
    `<span>Undated</span>` +
    `<span class="atlas-timeline-rail-undated-count">${state.undated.length}</span>`;
  wrap.appendChild(head);

  const sub = document.createElement('div');
  sub.className = 'atlas-timeline-rail-undated-sub';
  sub.textContent = 'Drag onto the timeline to date it';
  wrap.appendChild(sub);

  const byType = new Map<string, Array<{ id: string; type: string; name: string }>>();
  for (const u of state.undated) {
    const arr = byType.get(u.type);
    if (arr) arr.push(u); else byType.set(u.type, [u]);
  }
  // The time-native types float to the top — you date events and narratives far
  // more than anything else (Captain). The rest follow by count.
  const TYPE_PRIORITY = ['event', 'narrative'];
  const rank = (t: string): number => { const i = TYPE_PRIORITY.indexOf(t); return i === -1 ? TYPE_PRIORITY.length : i; };
  const groups = [...byType.entries()].sort((a, b) =>
    rank(a[0]) - rank(b[0]) || b[1].length - a[1].length);
  for (const [type, items] of groups) {
    const group = document.createElement('div');
    group.className = 'atlas-timeline-rail-undated-group';
    const color = ELEMENT_TYPE_COLORS[type as ElementType] ?? '#94a3b8';
    const gh = document.createElement('div');
    gh.className = 'atlas-timeline-rail-undated-grouphead';
    gh.innerHTML =
      `<span class="material-symbols-outlined" style="color:${color}">${ELEMENT_ICONS[type as ElementType] ?? 'category'}</span>` +
      `<span>${escapeText(type)}</span>` +
      `<span class="atlas-timeline-rail-undated-groupcount">${items.length}</span>`;
    group.appendChild(gh);

    const expanded = state.undatedExpanded.has(type);
    const shown = expanded ? items : items.slice(0, PER_TYPE_CAP);
    for (const it of shown) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'atlas-timeline-rail-undated-item';
      b.title = `Drag onto the timeline to date ${it.name}, or click to open it`;
      // A grip glyph + the name — the grip is the "you can drag this" signal.
      b.innerHTML =
        `<span class="material-symbols-outlined atlas-timeline-rail-undated-grip">drag_indicator</span>` +
        `<span class="atlas-timeline-rail-undated-name">${escapeText(it.name)}</span>`;
      // mousedown starts the drag lifecycle; a no-move mouseup is treated as a
      // click (opens the element). No separate click listener — that would
      // double-fire onOpenElement with the pointerup path (gate finding).
      b.addEventListener('mousedown', (e) => startItemDrag(state, it, e));
      group.appendChild(b);
    }
    if (!expanded && items.length > PER_TYPE_CAP) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'atlas-timeline-rail-undated-more';
      more.textContent = `+${items.length - PER_TYPE_CAP} more`;
      more.addEventListener('click', () => { state.undatedExpanded.add(type); renderCard(state); });
      group.appendChild(more);
    }
    wrap.appendChild(group);
  }
  return wrap;
}

// ====== Drag-to-date (Bout 1.2) ======

const DATE_DRAG_THRESHOLD = 4; // px before a mousedown becomes a drag (vs a click)

/** mousedown on a rail item: arm a PENDING drag. Captures element DATA (not the
 *  DOM node — survives a mid-drag rail rebuild). Becomes a drag past the
 *  threshold, else a click (open) on mouseup. */
function startItemDrag(state: ViewState, item: { id: string; type: string; name: string }, e: MouseEvent): void {
  if (e.button !== 0) return;
  e.preventDefault(); // no text-selection / focus flicker while dragging
  endDateDrag(state); // clear any stale drag defensively
  state.dateDrag = {
    id: item.id, type: item.type, name: item.name,
    startX: e.clientX, startY: e.clientY, active: false, ghost: null,
  };
  state.dateDragMove = (ev: MouseEvent) => handleDateDragMove(state, ev);
  state.dateDragUp = (ev: MouseEvent) => handleDateDragUp(state, ev);
  window.addEventListener('mousemove', state.dateDragMove);
  window.addEventListener('mouseup', state.dateDragUp);
}

/** window mousemove during a pending/active date-drag. */
function handleDateDragMove(state: ViewState, e: MouseEvent): void {
  const d = state.dateDrag;
  if (!d) return;
  if (!d.active) {
    if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DATE_DRAG_THRESHOLD) return;
    // Activate: floating ghost + freeze any in-flight camera animation so the
    // guide date is stable under a held cursor (gate finding).
    d.active = true;
    state.anim = null;
    d.ghost = buildDragGhost(d.type, d.name);
    document.body.appendChild(d.ghost);
    document.body.style.cursor = 'grabbing';
  }
  if (d.ghost) {
    d.ghost.style.left = `${e.clientX + 12}px`;
    d.ghost.style.top = `${e.clientY + 12}px`;
  }
  state.dropDate = dropDateAt(state, e.clientX, e.clientY);
  draw(state);
}

/** window mouseup ending a date-drag: click (no move) / drop-on-axis / cancel. */
function handleDateDragUp(state: ViewState, e: MouseEvent): void {
  const d = state.dateDrag;
  if (!d) return;
  const wasActive = d.active;
  const dropDate = state.dropDate;
  const id = d.id;
  endDateDrag(state);
  if (!wasActive) { state.onOpenElement(id); return; } // a click → open the element
  if (dropDate == null) return; // released off the axis → cancel, no write
  openDropDatePopover(state, id, dropDate, e.clientX, e.clientY);
}

/** Tear down an in-flight date-drag (window listeners + ghost + state). Safe to
 *  call when nothing is dragging. Called on drop, cancel, AND from destroy(). */
function endDateDrag(state: ViewState): void {
  if (state.dateDragMove) { window.removeEventListener('mousemove', state.dateDragMove); state.dateDragMove = null; }
  if (state.dateDragUp) { window.removeEventListener('mouseup', state.dateDragUp); state.dateDragUp = null; }
  if (state.dateDrag?.ghost?.parentNode) state.dateDrag.ghost.remove();
  document.body.style.cursor = '';
  const had = state.dateDrag != null || state.dropDate != null;
  state.dateDrag = null;
  state.dropDate = null;
  if (had && !state.destroyed) draw(state);
}

/** The snapped drop date if (cx,cy) is over the main axis band, else null. */
function dropDateAt(state: ViewState, cx: number, cy: number): number | null {
  const rect = state.canvas.getBoundingClientRect();
  const x = cx - rect.left;
  const y = cy - rect.top;
  const w = rect.width;
  if (x < 0 || x > w) return null;
  if (y < TOP_PAD - 6 || y > axisYOf(rect.height)) return null; // the fan band only
  const d = dateAtX(state, x, w);
  return d == null ? null : Math.round(d);
}

/** The floating drag chip that follows the cursor. */
function buildDragGhost(type: string, name: string): HTMLElement {
  const g = document.createElement('div');
  g.className = 'atlas-timeline-drag-ghost';
  const icon = ELEMENT_ICONS[type as ElementType] ?? 'category';
  const color = ELEMENT_TYPE_COLORS[type as ElementType] ?? '#94a3b8';
  g.innerHTML =
    `<span class="material-symbols-outlined" style="color:${color}">${escapeText(icon)}</span>` +
    `<span>${escapeText(name)}</span>`;
  return g;
}

/** Drop-confirm popover (reuses the field-edit popover — number input, Enter
 *  saves, Esc/backdrop cancels; the backdrop intercepts click-away so the
 *  canvas mouse handlers never fire, gate finding). */
function openDropDatePopover(state: ViewState, id: string, dropDate: number, cx: number, cy: number): void {
  const anchor = document.createElement('div');
  anchor.style.cssText = `position:fixed;left:${cx}px;top:${cy}px;width:1px;height:1px;pointer-events:none;`;
  document.body.appendChild(anchor);
  openFieldEditPopover({
    anchor,
    label: 'Date',
    value: String(dropDate),
    widget: 'number',
    onSave: (v: unknown) => {
      anchor.remove();
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) state.onDateElement?.(id, Math.round(n));
    },
    onCancel: () => { anchor.remove(); },
  });
}

// S7 content budget: chips shown per role group before the "+N more" toggle.
const CARD_GROUP_CHIP_CAP = 5;

/** A labelled chip cluster (one role group) inside the card — capped at
 *  CARD_GROUP_CHIP_CAP with a "+N more" expander (S7 content budget). */
function buildChipGroup(state: ViewState, label: string, refs: LinkedRef[]): HTMLElement {
  const group = document.createElement('div');
  group.className = 'atlas-timeline-card-group';
  const gl = document.createElement('div');
  gl.className = 'atlas-timeline-card-grouplabel';
  gl.textContent = label;
  group.appendChild(gl);
  const row = document.createElement('div');
  row.className = 'atlas-timeline-card-chiprow';
  const key = `${state.selectedId}·${label}`;
  const expanded = state.expandedGroups.has(key);
  const shown = expanded ? refs : refs.slice(0, CARD_GROUP_CHIP_CAP);
  for (const link of shown) row.appendChild(buildChip(state, link));
  if (!expanded && refs.length > CARD_GROUP_CHIP_CAP) {
    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'atlas-timeline-chip atlas-timeline-chip-more';
    more.textContent = `+${refs.length - CARD_GROUP_CHIP_CAP} more`;
    more.title = `Show all ${refs.length}`;
    more.addEventListener('click', () => {
      state.expandedGroups.add(key);
      renderCard(state);
    });
    row.appendChild(more);
  }
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

// (The old float-near-the-dot positioning is gone — S7: the card is a docked
// flex sibling of the canvas cell; CSS owns its geometry entirely.)

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

/** Is (mx,my) close enough to grab the now-line for a drag? (Act 1) */
function nearNowLine(state: ViewState, mx: number, my: number, w: number, h: number): boolean {
  if (state.now == null) return false;
  const x = nowLineX(state, w);
  if (x == null) return false;
  return my >= TOP_PAD - 6 && my <= axisYOf(h) && Math.abs(mx - x) <= NOW_GRAB_PX;
}

/** The date under a main-canvas x (uses the current on-screen window). */
function dateAtX(state: ViewState, x: number, w: number): number | null {
  const view = currentViewRange(state);
  if (!view) return null;
  const span = view.end - view.start;
  return span > 0 && w > 0 ? view.start + (x / w) * span : view.start;
}

function handleMouseMove(state: ViewState, e: MouseEvent): void {
  // A date-drag owns the pointer — the window-level drag handler draws the
  // guide; the canvas hover/pan must stay out of the way (gate finding: two
  // "what's under the cursor" systems fighting + a cursor tug-of-war).
  if (state.dateDrag?.active) return;
  const rect = state.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const w = rect.width;
  const h = rect.height;
  state.mouseX = mx;
  state.mouseY = my;

  // A now-line drag owns the mouse (Act 1): the line follows the cursor date;
  // committed to disk on mouseup.
  if (state.nowDrag) {
    const d = dateAtX(state, mx, w);
    if (d != null) { state.now = d; draw(state); }
    return;
  }

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

  if (badgeAt(state, mx, my)) {
    state.hoveredDot = null;
    state.canvas.style.cursor = 'pointer';
    draw(state);
    return;
  }

  const found = hitTest(state, mx, my);
  state.hoveredDot = found;
  // A dot under the cursor wins the pointer; otherwise the now-line offers its
  // resize grip (Act 1); otherwise the canvas pans.
  state.canvas.style.cursor = found ? 'pointer'
    : nearNowLine(state, mx, my, w, h) ? 'ew-resize'
    : 'grab';
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
  if (state.dateDrag) return; // a date-drag owns the pointer
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

  // Now-line grab (Act 1) — after the strip, before pan. A dot under the cursor
  // wins (it's the more common intent, and a dot can sit right on the seam).
  if (nearNowLine(state, mx, my, rect.width, rect.height) && !hitTest(state, mx, my)) {
    state.nowDrag = true;
    return;
  }

  state.dragging = true;
  state.dragMoved = false;
  state.dragStartX = mx;
  state.dragStartWindow = view;
}

function handleMouseUp(state: ViewState): void {
  // A date-drag's own window mouseup handler does the drop — this canvas-level
  // one (registered first) must bail so it can't also pan/select/dismiss.
  if (state.dateDrag) return;
  // Commit a now-line drag (Act 1): persist the rounded value; the room writes
  // it to World.time_current and re-renders with the settled value.
  if (state.nowDrag) {
    state.nowDrag = false;
    state.canvas.style.cursor = 'default';
    if (state.onSetNow && state.now != null) state.onSetNow(Math.round(state.now));
    return;
  }
  if (state.stripDrag) {
    state.stripDrag = null;
    state.canvas.style.cursor = 'default';
    return;
  }
  if (!state.dragging) return;
  state.dragging = false;
  state.canvas.style.cursor = state.hoveredDot ? 'pointer' : 'grab';
  // "+N" badge click → zoom to that cluster (S4); checked before dot selection
  // (badges sit in the axis gutter where no dot hit-test fires anyway).
  if (!state.dragMoved && state.mouseX != null && state.mouseY != null) {
    const badge = badgeAt(state, state.mouseX, state.mouseY);
    if (badge) { zoomToCluster(state, badge); return; }
  }
  if (!state.dragMoved && state.hoveredDot) {
    // Click progression (S256, revising the 2026-07-10 re-click-deselects
    // lock — reopened by Captain's own live use, which is the lock working):
    // click = peek · click the peeked node AGAIN = FOCUS · click empty canvas
    // (below), Esc, or the card × = dismiss.
    if (state.hoveredDot.node.id === state.selectedId) {
      state.onFocus(state.hoveredDot.node.id);
      return;
    }
    state.onSelect(state.hoveredDot.node.id); // a click (not a drag) selects
    // Waypoint (hookmap wp6): a true canvas click — the URL-derived anchor
    // default and programmatic onSelect calls never pass through here.
    completeWaypoint('time');
  } else if (!state.dragMoved && !state.hoveredDot && state.selectedId) {
    // Click on empty canvas → dismiss the peek (S256 — dismissal moved here
    // from the re-click, which now escalates to focus instead).
    state.onSelect('');
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
