/**
 * Timeline view — the interactive, room-grade timeline (vs the compact home
 * bar in `timeline-bar.ts`). Canvas + DOM hybrid, the context-graph pattern:
 *
 *   - CANVAS layer: fill-space axis, ticks, grid, labeled dots, range-lines.
 *   - DOM overlay:  the selected-event CARD — date + type + its linked
 *                   elements as clickable chips (the wedge: every element an
 *                   event touches, surfaced from the graph, not capped at one).
 *
 * Selection flows up via `onSelect`; the room turns that into a route change
 * (`/timeline/<id>`) so the right-pane context graph focuses the same event.
 * Chip clicks flow via `onNavigateToElement` (jump to the element room).
 *
 * Shares the DOMAIN (data-normalizer + axis-calculator pure functions) with
 * the compact bar; does NOT share the renderer. See DESIGN_TIMELINE.md.
 */

import type { Element, ElementType } from '../../core/types';
import type { LinkedRef, PlacedDot, TimelineNode } from './types';
import { calculateTicks, calculateTimeRange, createDateToX } from './axis-calculator';
import { extractTemporalNodes } from './data-normalizer';
import { escapeText } from '../../core/dom-utils';
import { ELEMENT_ICONS } from '../../core/constants';

const DOT_RADIUS = 4;
const DOT_RADIUS_HOVER = 6;
const DOT_RADIUS_SELECTED = 7;
const TOP_PAD = 20;
const AXIS_LABEL_HEIGHT = 22;
const ROW_HEIGHT = 30;
const LABEL_MAX_CHARS = 22;

export interface TimelineViewOptions {
  /** A dot was clicked → select it (room turns this into a route change). */
  onSelect: (elementId: string) => void;
  /** A linked-element chip was clicked → jump to that element. */
  onNavigateToElement: (elementId: string) => void;
}

export interface TimelineViewHandle {
  setElements(elements: Element[]): void;
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
  onSelect: (id: string) => void;
  onNavigateToElement: (id: string) => void;
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
    onSelect: opts.onSelect,
    onNavigateToElement: opts.onNavigateToElement,
  };

  const onMove = (e: MouseEvent): void => handleMouseMove(state, e);
  const onLeave = (): void => handleMouseLeave(state);
  const onClick = (): void => {
    if (state.hoveredDot) state.onSelect(state.hoveredDot.node.id);
  };
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);

  const ro = new ResizeObserver(() => { draw(state); positionCard(state); });
  ro.observe(container);

  return {
    setElements(elements: Element[]): void {
      state.nodes = extractTemporalNodes(elements);
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
      canvas.removeEventListener('click', onClick);
      target.innerHTML = '';
    },
  };
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
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No elements with temporal data yet.', w / 2, h / 2);
    return;
  }

  const range = calculateTimeRange(state.nodes);
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
    ctx.fillText(String(tick), x, axisY + 15);
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

  // Labels (room readability) — draw to the right of each dot, muted; skip if
  // it would collide with a label already drawn on the same row.
  const lastLabelXByRow: Record<number, number> = {};
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const dot of placed) {
    const rowKey = Math.round(dot.y);
    const last = lastLabelXByRow[rowKey];
    if (last != null && dot.x - last < 80) continue; // too close to prior label
    const isSel = dot.node.id === state.selectedId;
    ctx.fillStyle = isSel ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.45)';
    ctx.fillText(truncate(dot.node.name, LABEL_MAX_CHARS), dot.x + 9, dot.y);
    lastLabelXByRow[rowKey] = dot.x;
  }
  ctx.textBaseline = 'alphabetic';

  // Dots (selected + hovered emphasized)
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

  state.placedDots = placed;
  positionCard(state);
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
    for (const link of links) {
      chipsWrap.appendChild(buildChip(state, link));
    }
  }
  card.appendChild(chipsWrap);

  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'atlas-timeline-card-open';
  open.textContent = 'Open element →';
  open.addEventListener('click', () => state.onNavigateToElement(node.id));
  card.appendChild(open);

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
  chip.addEventListener('click', () => state.onNavigateToElement(link.id));
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

// ====== Mouse ======

function handleMouseMove(state: ViewState, e: MouseEvent): void {
  const rect = state.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  let found: PlacedDot | null = null;
  let bestDist = Infinity;
  for (const dot of state.placedDots) {
    const dx = dot.x - mx;
    const dy = dot.y - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < DOT_RADIUS_HOVER + 5 && dist < bestDist) { bestDist = dist; found = dot; }
  }
  if (found !== state.hoveredDot) {
    state.hoveredDot = found;
    state.canvas.style.cursor = found ? 'pointer' : 'default';
    draw(state);
  }
}

function handleMouseLeave(state: ViewState): void {
  if (state.hoveredDot) { state.hoveredDot = null; draw(state); }
  state.canvas.style.cursor = 'default';
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
