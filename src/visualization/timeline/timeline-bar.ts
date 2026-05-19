/**
 * Timeline bar — compact or expanded horizontal timeline of temporal elements.
 *
 * Embedded by World Home (compact) and by the dedicated Timeline room
 * (expanded). Click a dot → navigates to the element. Hover → tooltip.
 *
 * Adapted from `tools/little-element-viewer/src/timeline/timeline-bar.ts`
 * (744 lines) — atlas v1 keeps the multi-row dot binning algorithm and the
 * canvas rendering but defers: narrative bars, narrative filter, zoom/pan,
 * expand/collapse toggle, narrative-aware row affinity. See DESIGN_HOME.md
 * "Compact timeline" and PROGRESS.md for deferred items.
 */

import type { Element } from '../../core/types';
import type { PlacedDot, TimelineNode } from './types';
import { calculateTicks, calculateTimeRange, createDateToX } from './axis-calculator';
import { extractTemporalNodes } from './data-normalizer';
import { escapeText } from '../../core/dom-utils';

const DOT_RADIUS = 4;
const DOT_RADIUS_HOVER = 6;
const DOT_AREA_TOP = 10;
const AXIS_LABEL_HEIGHT = 18;

export interface TimelineBarOptions {
  /** Compact = ~100px tall, expanded = ~240px tall. */
  mode?: 'compact' | 'expanded';
  /** Click handler — typically navigates to element-detail. */
  onNavigate: (elementId: string) => void;
  /** Click on the empty axis (expand affordance) — typically opens the
   *  dedicated timeline room. Compact only. */
  onExpand?: () => void;
}

interface BarState {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  tooltip: HTMLElement;
  mode: 'compact' | 'expanded';
  nodes: TimelineNode[];
  placedDots: PlacedDot[];
  hoveredDot: PlacedDot | null;
  onNavigate: (id: string) => void;
  onExpand: (() => void) | null;
  resizeObserver: ResizeObserver | null;
}

export interface TimelineBarHandle {
  setElements(elements: Element[]): void;
  redraw(): void;
  destroy(): void;
}

export function mountTimelineBar(target: HTMLElement, opts: TimelineBarOptions): TimelineBarHandle {
  target.innerHTML = '';

  const container = document.createElement('div');
  container.className = 'atlas-timeline-bar';
  container.dataset.mode = opts.mode ?? 'compact';
  target.appendChild(container);

  const canvas = document.createElement('canvas');
  canvas.className = 'atlas-timeline-bar-canvas';
  container.appendChild(canvas);

  const tooltip = document.createElement('div');
  tooltip.className = 'atlas-timeline-bar-tooltip';
  tooltip.style.display = 'none';
  container.appendChild(tooltip);

  const state: BarState = {
    container,
    canvas,
    tooltip,
    mode: opts.mode ?? 'compact',
    nodes: [],
    placedDots: [],
    hoveredDot: null,
    onNavigate: opts.onNavigate,
    onExpand: opts.onExpand ?? null,
    resizeObserver: null,
  };

  // Mouse events
  const onMove = (e: MouseEvent): void => handleMouseMove(state, e);
  const onLeave = (): void => handleMouseLeave(state);
  const onClick = (): void => handleClick(state);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  canvas.addEventListener('click', onClick);

  // Resize via ResizeObserver — redraw on container size change.
  const ro = new ResizeObserver(() => drawBar(state));
  ro.observe(container);
  state.resizeObserver = ro;

  return {
    setElements(elements: Element[]): void {
      state.nodes = extractTemporalNodes(elements);
      drawBar(state);
    },
    redraw(): void {
      drawBar(state);
    },
    destroy(): void {
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('click', onClick);
      if (tooltip.parentElement) tooltip.parentElement.removeChild(tooltip);
      target.innerHTML = '';
    },
  };
}

function getBarHeight(state: BarState): number {
  return state.mode === 'expanded' ? 240 : 100;
}

function getDotAreaBottom(state: BarState): number {
  return getBarHeight(state) - AXIS_LABEL_HEIGHT - 6;
}

function drawBar(state: BarState): void {
  const { canvas, container, mode } = state;
  const rect = container.getBoundingClientRect();
  const w = Math.max(0, rect.width);
  const h = getBarHeight(state);
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;

  const ctx = canvas.getContext('2d');
  if (!ctx || w === 0) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);

  // Background
  ctx.fillStyle = 'rgba(255,255,255,0.015)';
  ctx.fillRect(0, 0, w, h);

  if (state.nodes.length === 0) {
    state.placedDots = [];
    drawEmptyMessage(ctx, w, h, mode);
    return;
  }

  const range = calculateTimeRange(state.nodes);
  const dateToX = createDateToX(range, w);
  const ticks = calculateTicks(range, w);
  const dotAreaBottom = getDotAreaBottom(state);

  // Axis line
  const axisY = dotAreaBottom + 2;
  ctx.beginPath();
  ctx.moveTo(0, axisY);
  ctx.lineTo(w, axisY);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Tick marks + labels
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  for (const tick of ticks) {
    const x = dateToX(tick);
    ctx.beginPath();
    ctx.moveTo(x, axisY - 3);
    ctx.lineTo(x, axisY + 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.fillText(String(tick), x, axisY + 14);
  }

  // Grid lines (subtle)
  ctx.strokeStyle = 'rgba(255,255,255,0.025)';
  for (const tick of ticks) {
    const x = dateToX(tick);
    ctx.beginPath();
    ctx.moveTo(x, DOT_AREA_TOP);
    ctx.lineTo(x, axisY);
    ctx.stroke();
  }

  // Place dots via multi-row binning (adapted from little-element-viewer).
  const topPad = mode === 'expanded' ? 16 : DOT_AREA_TOP;
  const botPad = mode === 'expanded' ? 30 : 0;
  const usableHeight = dotAreaBottom - topPad - botPad;
  const rowHeight = mode === 'expanded' ? 28 : 16;
  const numRows = Math.max(2, Math.floor(usableHeight / rowHeight));

  const sorted = [...state.nodes].sort((a, b) => a.startDate - b.startDate);
  const placed: PlacedDot[] = [];

  for (const node of sorted) {
    const x = dateToX(node.startDate);
    if (x < -20 || x > w + 20) continue;

    // Try each row, prefer first row with ≥30px horizontal clearance.
    let bestY = topPad;
    let bestDist = -1;
    for (let row = 0; row < numRows; row++) {
      const candidateY = topPad + row * rowHeight + rowHeight / 2;
      let minXDist = Infinity;
      for (const p of placed) {
        if (Math.abs(p.y - candidateY) < rowHeight * 0.8) {
          const xd = Math.abs(p.x - x);
          if (xd < minXDist) minXDist = xd;
        }
      }
      if (minXDist > 30) {
        bestY = candidateY;
        bestDist = minXDist;
        break;
      }
      if (minXDist > bestDist) {
        bestDist = minXDist;
        bestY = candidateY;
      }
    }

    placed.push({ node, x, y: bestY, radius: DOT_RADIUS });
  }

  // Draw range lines (for nodes with endDate)
  for (const dot of placed) {
    if (dot.node.endDate == null) continue;
    const x2 = dateToX(dot.node.endDate);
    ctx.beginPath();
    ctx.moveTo(dot.x, dot.y);
    ctx.lineTo(x2, dot.y);
    ctx.strokeStyle = applyAlpha(dot.node.color, 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Draw dots
  for (const dot of placed) {
    const radius = dot === state.hoveredDot ? DOT_RADIUS_HOVER : DOT_RADIUS;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = dot.node.color;
    ctx.fill();
    if (dot === state.hoveredDot) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = applyAlpha(dot.node.color, 0.4);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  state.placedDots = placed;
}

function drawEmptyMessage(ctx: CanvasRenderingContext2D, w: number, h: number, mode: 'compact' | 'expanded'): void {
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  const message = mode === 'expanded'
    ? 'No elements with temporal data yet.'
    : 'No timeline data yet.';
  ctx.fillText(message, w / 2, h / 2);
}

function handleMouseMove(state: BarState, e: MouseEvent): void {
  const rect = state.canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  let found: PlacedDot | null = null;
  let bestDist = Infinity;
  for (const dot of state.placedDots) {
    const dx = dot.x - mx;
    const dy = dot.y - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < DOT_RADIUS_HOVER + 4 && dist < bestDist) {
      bestDist = dist;
      found = dot;
    }
  }

  if (found !== state.hoveredDot) {
    state.hoveredDot = found;
    state.canvas.style.cursor = found ? 'pointer' : 'default';
    drawBar(state);
  }

  if (found) {
    showTooltip(state, found, e.clientX, rect);
  } else {
    state.tooltip.style.display = 'none';
  }
}

function handleMouseLeave(state: BarState): void {
  if (state.hoveredDot) {
    state.hoveredDot = null;
    drawBar(state);
  }
  state.canvas.style.cursor = 'default';
  state.tooltip.style.display = 'none';
}

function handleClick(state: BarState): void {
  if (state.hoveredDot) {
    state.onNavigate(state.hoveredDot.node.id);
    return;
  }
  // Click on empty area → expand callback if provided (compact mode)
  if (state.mode === 'compact' && state.onExpand) {
    state.onExpand();
  }
}

function showTooltip(state: BarState, dot: PlacedDot, clientX: number, canvasRect: DOMRect): void {
  const { tooltip } = state;
  const dateStr = dot.node.endDate != null
    ? `${dot.node.startDate} – ${dot.node.endDate}`
    : String(dot.node.startDate);
  tooltip.innerHTML = `
    <span class="atlas-timeline-bar-tooltip-name">${escapeText(dot.node.name)}</span>
    <span class="atlas-timeline-bar-tooltip-meta">${escapeText(dot.node.elementType)} · ${escapeText(dateStr)}</span>
  `;
  tooltip.style.display = 'flex';
  const flipBelow = dot.y < getBarHeight(state) * 0.35;
  tooltip.style.left = `${dot.x}px`;
  if (flipBelow) {
    tooltip.style.top = `${dot.y + DOT_RADIUS_HOVER + 8}px`;
    tooltip.style.transform = 'translate(-50%, 0)';
  } else {
    tooltip.style.top = `${dot.y - DOT_RADIUS_HOVER - 8}px`;
    tooltip.style.transform = 'translate(-50%, -100%)';
  }
  // Reference unused canvasRect/clientX for future positioning math — keeps
  // the surface ready for cursor-anchored zoom (deferred).
  void canvasRect;
  void clientX;
}


function applyAlpha(hex: string, alpha: number): string {
  // Accept hex (#rgb / #rrggbb) and produce rgba(). Fall back to the input if
  // we can't parse — caller's stroke just won't get the requested alpha.
  if (!hex.startsWith('#')) return hex;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return hex;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
