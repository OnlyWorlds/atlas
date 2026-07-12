/**
 * Static chart renderer — draws a FROZEN chart (PayloadChartBlock) to a canvas.
 * Shared by the atlas share-builder preview and (as a deliberate COPY, per the
 * tools/show re-lift discipline) the public viewer. No interaction beyond an
 * optional click-through on nodes that carry a `ref` (a carded element).
 *
 * It re-implements a SIMPLER centered density-fan than the interactive room
 * view (timeline-view.ts): a published chart is a snapshot, not an explorer —
 * no zoom/pan/proximity. Type-tinted Material Symbols glyphs (identity),
 * anchors bigger + always-labelled (hierarchy), nodes bloom up/down from the
 * axis midline by local time-density (the fan). Pure of store/state.
 */

import type { PayloadChartBlock } from './chart-freeze';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../../core/constants';
import type { ElementType } from '../../core/types';
import { applyAlpha, ensureIconFont } from './canvas-utils';

const HEIGHT = 240;
const PAD_X = 18;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;       // room for the axis labels
const X_GAP = 30;            // x-window (px) that counts as "crowded" → step a level
const Y_STEP = 26;           // vertical breathing room between fan levels
const ICON = 14;
const ICON_ANCHOR = 19;

interface Placed {
  x: number;
  y: number;
  icon: string;
  color: string;
  name: string;
  anchor: boolean;
  cast?: 'protagonist' | 'home';
  ref?: string;
  endX?: number;
  /** Strip layout only: this node won a label slot (default layout labels anchors/cast). */
  labelled?: boolean;
}

/** Centered greedy beeswarm: level order 0, +1, -1, +2, -2 … nearest free wins. */
function levelFor(x: number, lastXAtLevel: Map<number, number>, maxLevel: number): number {
  for (let step = 0; step <= maxLevel; step++) {
    for (const level of step === 0 ? [0] : [step, -step]) {
      const last = lastXAtLevel.get(level);
      if (last === undefined || x - last >= X_GAP) {
        lastXAtLevel.set(level, x);
        return level;
      }
    }
  }
  // Everything crowded — overflow onto the outermost level (rare).
  lastXAtLevel.set(maxLevel, x);
  return maxLevel;
}

export interface ChartViewOptions {
  /** Called when a node with a `ref` (a carded element) is clicked. */
  onRef?: (ref: string) => void;
  /** Canvas height in px (default 240). ADDITIVE option — the show viewer's
   *  copy of this module can lag without behavior change (re-lift discipline). */
  height?: number;
  /** 'strip' = the home chart strip's compact layout (S256): LABEL-AWARE row
   *  occupancy (a labelled node claims its text width, a bare dot ~20px) in
   *  pure date order, so short bands fan instead of collapsing to one midline
   *  row with label pile-ups. ADDITIVE — omitted = the classic fan, so the
   *  show viewer's copy is unaffected (re-lift discipline). */
  layout?: 'default' | 'strip';
}

/** Render a frozen chart block to a self-contained element. */
export function renderChartView(block: PayloadChartBlock, opts: ChartViewOptions = {}): HTMLElement {
  const height = opts.height ?? HEIGHT;
  const wrap = document.createElement('div');
  wrap.className = 'atlas-chart-static';

  const title = document.createElement('div');
  title.className = 'atlas-chart-static-title';
  title.textContent = block.title || 'chart';
  wrap.appendChild(title);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'atlas-chart-static-canvas-wrap';
  canvasWrap.style.height = `${height}px`;
  wrap.appendChild(canvasWrap);

  if (block.nodes.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'atlas-chart-static-empty';
    empty.textContent = 'No dated elements in this chart.';
    canvasWrap.appendChild(empty);
    return wrap;
  }

  const canvas = document.createElement('canvas');
  canvasWrap.appendChild(canvas);
  let placed: Placed[] = [];

  const draw = (): void => {
    const cssW = canvasWrap.clientWidth || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, height);

    const span = Math.max(1, block.axisMax - block.axisMin);
    const plotW = cssW - 2 * PAD_X;
    const midY = PAD_TOP + (height - PAD_TOP - PAD_BOTTOM) / 2;
    const maxLevel = Math.max(1, Math.floor((height - PAD_TOP - PAD_BOTTOM) / 2 / Y_STEP));
    const dateToX = (d: number): number => PAD_X + ((d - block.axisMin) / span) * plotW;

    // Axis baseline.
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_X, height - PAD_BOTTOM + 8);
    ctx.lineTo(cssW - PAD_X, height - PAD_BOTTOM + 8);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.68)';
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillText(String(block.axisMin), PAD_X, height - 8);
    if (block.axisMax !== block.axisMin) {
      ctx.textAlign = 'right';
      ctx.fillText(String(block.axisMax), cssW - PAD_X, height - 8);
    }

    if (opts.layout === 'strip') {
      // Strip layout (S256): pure date order + label-aware row occupancy.
      // A labelled node (anchor/cast) reserves its glyph + text width on its
      // row; a bare dot reserves ~20px. Rows fill greedily centre-out, so a
      // short band spreads into a fan instead of one flat line whose labels
      // overlap (Captain's home-strip shots, 2026-07-12).
      const ordered = block.nodes
        .map((n, i) => ({ n, i }))
        .sort((a, b) => a.n.date - b.n.date || a.i - b.i);
      const rightEdgeAtLevel = new Map<number, number>();
      // Try to fit a node on a row, centre-out. A label that would clip at the
      // right edge FLIPS left at draw time, so its reservation flips too: it
      // needs clearance BEHIND the dot instead of ahead of it. Returns the
      // row, or null when every row is taken — the caller then retries with
      // bare-dot occupancy (label dropped, node never dropped).
      const tryPlace = (x: number, occupied: number, flip: boolean): number | null => {
        for (let step = 0; step <= maxLevel; step++) {
          for (const level of step === 0 ? [0] : [step, -step]) {
            const edge = rightEdgeAtLevel.get(level);
            const fits = flip ? (edge === undefined || x - occupied >= edge) : (edge === undefined || x >= edge);
            if (fits) {
              rightEdgeAtLevel.set(level, flip ? x + 12 : x + occupied);
              return level;
            }
          }
        }
        return null;
      };
      placed = ordered.map(({ n }) => {
        const x = dateToX(n.date);
        const size = n.cast ? ICON_ANCHOR + 3 : n.anchor ? ICON_ANCHOR : ICON;
        // EVERY node tries for a label in the strip (the room's label-budget
        // spirit): labels are the content that keeps a preview from reading
        // as a monotone dot-run. Cast/anchors measure at 12px, the rest 11px.
        ctx.font = n.anchor || n.cast ? "12px system-ui, sans-serif" : "11px system-ui, sans-serif";
        const labelOccupied = size * 0.7 + ctx.measureText(n.name).width + 14;
        const flip = x + labelOccupied > cssW - PAD_X;
        let labelled = true;
        let level = tryPlace(x, labelOccupied, flip);
        if (level == null) { labelled = false; level = tryPlace(x - 10, 20, false); }
        if (level == null) {
          // Every row full even for a bare dot — overflow onto the
          // least-crowded row (never drop the node itself).
          let best = 0; let bestEdge = Infinity;
          for (const [lv, edge] of rightEdgeAtLevel) {
            if (edge < bestEdge) { bestEdge = edge; best = lv; }
          }
          rightEdgeAtLevel.set(best, x + 20);
          level = best;
        }
        const color = ELEMENT_TYPE_COLORS[n.type as ElementType] ?? '#94a3b8';
        return {
          x, y: midY + level * Y_STEP,
          icon: ELEMENT_ICONS[n.type as ElementType] ?? 'category',
          color, name: n.name, anchor: !!n.anchor, cast: n.cast, ref: n.ref,
          endX: n.endDate != null ? dateToX(n.endDate) : undefined,
          labelled,
        };
      });
    } else {
      // Layout: anchors first (they hold the centre), then by date.
      const ordered = block.nodes
        .map((n, i) => ({ n, i }))
        .sort((a, b) =>
          (a.n.anchor === b.n.anchor ? 0 : a.n.anchor ? -1 : 1) ||
          a.n.date - b.n.date ||
          a.i - b.i,
        );
      const lastXAtLevel = new Map<number, number>();
      placed = ordered.map(({ n }) => {
        const x = dateToX(n.date);
        const level = levelFor(x, lastXAtLevel, maxLevel);
        const color = ELEMENT_TYPE_COLORS[n.type as ElementType] ?? '#94a3b8';
        return {
          x, y: midY + level * Y_STEP,
          icon: ELEMENT_ICONS[n.type as ElementType] ?? 'category',
          color, name: n.name, anchor: !!n.anchor, cast: n.cast, ref: n.ref,
          endX: n.endDate != null ? dateToX(n.endDate) : undefined,
        };
      });
    }

    // Range lines first (under glyphs).
    for (const p of placed) {
      if (p.endX == null) continue;
      ctx.strokeStyle = applyAlpha(p.color, 0.35);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.endX, p.y);
      ctx.stroke();
    }

    // Glyphs + anchor/cast labels (cast = the world's protagonist/home —
    // always labelled, in cyan, matching the interactive room's signal).
    ctx.textBaseline = 'middle';
    for (const p of placed) {
      const size = p.cast ? ICON_ANCHOR + 3 : p.anchor ? ICON_ANCHOR : ICON;
      if (p.anchor && !p.cast) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, size * 0.85, 0, Math.PI * 2);
        ctx.fillStyle = applyAlpha(p.color, 0.12);
        ctx.fill();
      }
      ctx.font = `${size}px "Material Symbols Outlined"`;
      ctx.fillStyle = p.color;
      ctx.textAlign = 'center';
      ctx.fillText(p.icon, p.x, p.y);

      const drawLabel = opts.layout === 'strip' ? p.labelled : (p.anchor || p.cast);
      if (drawLabel) {
        const plain = !p.anchor && !p.cast;
        ctx.font = plain ? "11px system-ui, sans-serif" : "12px system-ui, sans-serif";
        ctx.fillStyle = p.cast ? 'rgba(34,211,238,0.95)'
          : plain ? 'rgba(255,255,255,0.62)'
          : 'rgba(255,255,255,0.85)';
        const lw = ctx.measureText(p.name).width;
        const rightX = p.x + size * 0.7;
        if (rightX + lw > cssW - PAD_X) {
          // Flip to the left so an anchor near the right edge isn't clipped.
          ctx.textAlign = 'right';
          ctx.fillText(p.name, p.x - size * 0.7, p.y);
        } else {
          ctx.textAlign = 'left';
          ctx.fillText(p.name, rightX, p.y);
        }
      }
    }
  };

  // Click-through on ref'd nodes.
  canvas.addEventListener('click', (e) => {
    if (!opts.onRef) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    let best: Placed | null = null;
    let bestD = 16 * 16;
    for (const p of placed) {
      if (!p.ref) continue;
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bestD) { bestD = d; best = p; }
    }
    if (best?.ref) opts.onRef(best.ref);
  });

  // Draw now, redraw on width changes + once the icon font lands.
  draw();
  void ensureIconFont().then(draw);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => draw());
    ro.observe(canvasWrap);
  }
  return wrap;
}
