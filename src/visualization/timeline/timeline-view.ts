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

const DOT_RADIUS = 4;
const DOT_RADIUS_HOVER = 6;
const DOT_RADIUS_SELECTED = 7;
const TOP_PAD = 20;
const AXIS_LABEL_HEIGHT = 22;
const ROW_HEIGHT = 30;
const LABEL_MAX_CHARS = 24;
const LABEL_NEAR_RADIUS = 150;   // px — cursor neighbourhood that gets labels
const LABEL_NEAR_MAX = 9;        // most labels to reveal around the cursor
const ZOOM_MAX = 200;
const ZOOM_STEP = 1.2;

export interface TimelineViewOptions {
  /** A dot was clicked → select it (room turns this into a route change). */
  onSelect: (elementId: string) => void;
  /** The card's "focus" action → re-scope the chart to this element (D5). */
  onFocus: (elementId: string) => void;
  /** A chip / "open element" → jump to that element's room. */
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
  // cursor (canvas coords; null when outside) — drives proximity labels
  mouseX: number | null;
  mouseY: number | null;
  // drag-pan
  dragging: boolean;
  dragStartX: number;
  dragStartCenter: number;
  dragMoved: boolean;
  onSelect: (id: string) => void;
  onFocus: (id: string) => void;
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
    mouseX: null, mouseY: null,
    dragging: false, dragStartX: 0, dragStartCenter: 0, dragMoved: false,
    onSelect: opts.onSelect,
    onFocus: opts.onFocus,
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

  return {
    setNodes(nodes: TimelineNode[]): void {
      state.nodes = nodes;
      draw(state);
      renderCard(state);
    },
    setSelection(elementId: string | null): void {
      if (elementId === state.selectedId) return;
      state.selectedId = elementId;
      draw(state);
      renderCard(state);
    },
    redraw(): void { draw(state); },
    destroy(): void {
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

function effectiveRange(state: ViewState, base: { min: number; max: number }): { min: number; max: number } {
  const span = base.max - base.min;
  if (span <= 0 || state.zoom <= 1) return base;
  const effSpan = span / state.zoom;
  const center = state.panCenter ?? (base.min + span / 2);
  const pad = span * 0.05;
  let min = center - effSpan / 2;
  let max = center + effSpan / 2;
  if (min < base.min - pad) { min = base.min - pad; max = min + effSpan; }
  if (max > base.max + pad) { max = base.max + pad; min = max - effSpan; }
  return { min, max };
}

// ====== Drawing ======

function draw(state: ViewState): void {
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
  const range = effectiveRange(state, base);
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

  // Place dots via multi-row binning across the full height.
  const usableHeight = axisY - TOP_PAD - 8;
  const numRows = Math.max(2, Math.floor(usableHeight / ROW_HEIGHT));
  const sorted = [...state.nodes].sort((a, b) => a.startDate - b.startDate);
  const placed: PlacedDot[] = [];

  for (const node of sorted) {
    const x = dateToX(node.startDate);
    if (x < -40 || x > w + 40) continue;

    let bestY = TOP_PAD;
    let bestDist = -1;
    for (let row = 0; row < numRows; row++) {
      const candidateY = TOP_PAD + row * ROW_HEIGHT + ROW_HEIGHT / 2;
      let minXDist = Infinity;
      for (const p of placed) {
        if (Math.abs(p.y - candidateY) < ROW_HEIGHT * 0.8) {
          const xd = Math.abs(p.x - x);
          if (xd < minXDist) minXDist = xd;
        }
      }
      if (minXDist > 30) { bestY = candidateY; bestDist = minXDist; break; }
      if (minXDist > bestDist) { bestDist = minXDist; bestY = candidateY; }
    }
    placed.push({ node, x, y: bestY, radius: DOT_RADIUS });
  }
  state.placedDots = placed;

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
  drawLabels(ctx, state, placed, w);

  // Dots (selected + hovered emphasised)
  for (const dot of placed) {
    const isSel = dot.node.id === state.selectedId;
    const isHover = dot === state.hoveredDot;
    const radius = isSel ? DOT_RADIUS_SELECTED : isHover ? DOT_RADIUS_HOVER : DOT_RADIUS;
    if (isSel) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.55);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = dot.node.color;
    ctx.fill();
    if (isHover && !isSel) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  positionCard(state);
}

function drawLabels(ctx: CanvasRenderingContext2D, state: ViewState, placed: PlacedDot[], w: number): void {
  const toLabel = new Set<string>();
  if (state.selectedId) toLabel.add(state.selectedId);
  if (state.hoveredDot) toLabel.add(state.hoveredDot.node.id);
  if (state.mouseX != null && state.mouseY != null) {
    const near = placed
      .map(d => ({ d, dist: Math.hypot(d.x - state.mouseX!, d.y - state.mouseY!) }))
      .filter(x => x.dist < LABEL_NEAR_RADIUS)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, LABEL_NEAR_MAX);
    for (const x of near) toLabel.add(x.d.node.id);
  }

  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  const lastLabelXByRow: Record<number, number> = {};
  for (const dot of placed) {
    if (!toLabel.has(dot.node.id)) continue;
    const rowKey = Math.round(dot.y);
    const last = lastLabelXByRow[rowKey];
    if (last != null && dot.x - last < 70) continue; // collide-avoid within labelled set
    const isSel = dot.node.id === state.selectedId;
    ctx.fillStyle = isSel ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.62)';
    // Flip the label to the LEFT of the dot in the right third, so it never
    // clips the panel edge (self-inspection finding).
    const flip = dot.x > w * 0.66;
    ctx.textAlign = flip ? 'right' : 'left';
    ctx.fillText(truncate(dot.node.name, LABEL_MAX_CHARS), dot.x + (flip ? -9 : 9), dot.y);
    lastLabelXByRow[rowKey] = dot.x;
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

  const links = node.links;
  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'atlas-timeline-card-chips';
  if (links.length === 0) {
    const none = document.createElement('div');
    none.className = 'atlas-timeline-card-nolinks';
    none.textContent = 'No linked elements.';
    chipsWrap.appendChild(none);
  } else {
    // Group chips by ROLE (fieldLabel), first-seen order — Simmer's molecule:
    // the event is a hub, its links are spokes grouped by typed bond. 10 chips
    // in 4 labeled clusters reads; 10 bare chips don't.
    const groups = new Map<string, LinkedRef[]>();
    for (const link of links) {
      const g = groups.get(link.fieldLabel);
      if (g) g.push(link);
      else groups.set(link.fieldLabel, [link]);
    }
    for (const [label, refs] of groups) {
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
      chipsWrap.appendChild(group);
    }
  }
  card.appendChild(chipsWrap);

  const actions = document.createElement('div');
  actions.className = 'atlas-timeline-card-actions';
  const focusBtn = document.createElement('button');
  focusBtn.type = 'button';
  focusBtn.className = 'atlas-timeline-card-action';
  focusBtn.innerHTML = '<span class="material-symbols-outlined">filter_center_focus</span><span>Focus</span>';
  focusBtn.title = 'Focus the timeline on this element and what it touches';
  focusBtn.addEventListener('click', () => state.onFocus(node.id));
  actions.appendChild(focusBtn);
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

function buildChip(state: ViewState, link: LinkedRef): HTMLElement {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'atlas-timeline-chip';
  chip.title = `${link.fieldLabel}: ${link.name} (${link.type}) — open`;
  const icon = ELEMENT_ICONS[link.type as ElementType] ?? 'category';
  chip.innerHTML =
    `<span class="material-symbols-outlined">${escapeText(icon)}</span>` +
    `<span class="atlas-timeline-chip-name">${escapeText(link.name)}</span>`;
  chip.addEventListener('click', () => state.onOpenElement(link.id));
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
    const range = effectiveRange(state, state.baseRange);
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

  const range = effectiveRange(state, base);
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

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function applyAlpha(hex: string, alpha: number): string {
  if (!hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
