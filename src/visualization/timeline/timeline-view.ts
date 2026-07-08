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
const ZOOM_MAX = 200;
const ZOOM_STEP = 1.2;

export interface TimelineViewOptions {
  /** A dot or card chip was clicked → focus that element (unified select=focus;
   *  the room turns this into a `/timeline/<id>` route change). Empty id clears. */
  onSelect: (elementId: string) => void;
  /** The card's "Open" action → jump to that element's full room. */
  onOpenElement: (elementId: string) => void;
}

export interface TimelineViewHandle {
  /** The room passes already-scoped nodes (it owns the ChartConfig/scope). */
  setNodes(nodes: TimelineNode[]): void;
  setSelection(elementId: string | null): void;
  redraw(): void;
  destroy(): void;
}

interface ViewState {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  card: HTMLElement;
  nodes: TimelineNode[];
  placedDots: PlacedDot[];
  hoveredDot: PlacedDot | null;
  selectedId: string | null;
  // zoom/pan
  zoom: number;
  panCenter: number | null;   // date the view is centred on (null = base centre)
  baseRange: { min: number; max: number } | null;
  // layout cache — the density-fan is deterministic per geometry; recompute only
  // when size / range / node set changes, NOT on every mousemove redraw.
  layoutSig: string | null;
  layoutNodes: TimelineNode[] | null;
  // cursor (canvas coords; null when outside) — drives proximity labels
  mouseX: number | null;
  mouseY: number | null;
  // drag-pan
  dragging: boolean;
  dragStartX: number;
  dragStartCenter: number;
  dragMoved: boolean;
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
    nodes: [], placedDots: [], hoveredDot: null, selectedId: null,
    zoom: 1, panCenter: null, baseRange: null,
    layoutSig: null, layoutNodes: null,
    mouseX: null, mouseY: null,
    dragging: false, dragStartX: 0, dragStartCenter: 0, dragMoved: false,
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
    setNodes(nodes: TimelineNode[]): void {
      state.nodes = nodes;
      state.layoutSig = null; // new node set → re-pack
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

// ====== Zoom helpers ======

export function effectiveRange(
  base: { min: number; max: number },
  zoom: number,
  panCenter: number | null,
): { min: number; max: number } {
  const span = base.max - base.min;
  if (span <= 0 || zoom <= 1) return base;
  const effSpan = span / zoom;
  const center = panCenter ?? (base.min + span / 2);
  const pad = span * 0.05;
  let min = center - effSpan / 2;
  let max = center + effSpan / 2;
  if (min < base.min - pad) { min = base.min - pad; max = min + effSpan; }
  if (max > base.max + pad) { max = base.max + pad; min = max - effSpan; }
  return { min, max };
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
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Nothing dated in this view.', w / 2, h / 2);
    return;
  }

  const base = calculateTimeRange(state.nodes);
  state.baseRange = base;
  const range = effectiveRange(base, state.zoom, state.panCenter);
  const dateToX = createDateToX(range, w);
  const ticks = calculateTicks(range, w);
  const axisY = h - AXIS_LABEL_HEIGHT;

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

  // Tick labels
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const tick of ticks) {
    const x = dateToX(tick);
    ctx.beginPath();
    ctx.moveTo(x, axisY - 3);
    ctx.lineTo(x, axisY + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
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
  const detail = state.zoom > RUNG_CLOSE ? 2 : state.zoom > RUNG_MID ? 1 : 0;
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

  positionCard(state);
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
  chip.title = `${link.fieldLabel}: ${link.name} (${link.type}) — focus`;
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
  return found;
}

function handleMouseMove(state: ViewState, e: MouseEvent): void {
  const rect = state.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  state.mouseX = mx;
  state.mouseY = my;

  if (state.dragging && state.baseRange) {
    const w = rect.width;
    const range = effectiveRange(state.baseRange, state.zoom, state.panCenter);
    const dateToX = createDateToX(range, w);
    const pxPerUnit = dateToX(range.min + 1) - dateToX(range.min);
    if (pxPerUnit !== 0) {
      const dx = mx - state.dragStartX;
      if (Math.abs(dx) > 3) state.dragMoved = true;
      state.panCenter = state.dragStartCenter - dx / pxPerUnit;
    }
    state.canvas.style.cursor = 'grabbing';
    draw(state);
    return;
  }

  const found = hitTest(state, mx, my);
  state.hoveredDot = found;
  state.canvas.style.cursor = found ? 'pointer' : (state.zoom > 1 ? 'grab' : 'default');
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
  state.dragging = true;
  state.dragMoved = false;
  state.dragStartX = e.clientX - rect.left;
  const base = state.baseRange;
  state.dragStartCenter = state.panCenter ?? (base ? (base.min + base.max) / 2 : 0);
}

function handleMouseUp(state: ViewState): void {
  if (!state.dragging) return;
  state.dragging = false;
  state.canvas.style.cursor = state.hoveredDot ? 'pointer' : (state.zoom > 1 ? 'grab' : 'default');
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
  const base = state.baseRange;
  const span = base.max - base.min;
  if (span <= 0) return;

  const range = effectiveRange(base, state.zoom, state.panCenter);
  const dateToX = createDateToX(range, w);
  const pxPerUnit = dateToX(range.min + 1) - dateToX(range.min);
  if (pxPerUnit === 0) return;
  const dateAtCursor = range.min + (mx - dateToX(range.min)) / pxPerUnit;
  const frac = (dateAtCursor - range.min) / (range.max - range.min);

  const newZoom = Math.min(ZOOM_MAX, Math.max(1, state.zoom * (e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)));
  state.zoom = newZoom;
  if (newZoom <= 1) {
    state.panCenter = null; // back to full fit
  } else {
    const newEffSpan = span / newZoom;
    const newMin = dateAtCursor - frac * newEffSpan;
    state.panCenter = newMin + newEffSpan / 2; // effectiveRange will clamp
  }
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
