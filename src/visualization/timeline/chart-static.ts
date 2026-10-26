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
  /** Strip layout only: the side this node's label won, or none (the default
   *  layout labels anchors and cast, flipping left at the right edge). */
  side?: 'right' | 'left';
}

/** One node as the strip lays it out: its x, its glyph size, its label's
 *  measured width, and whether it is a name the strip keeps (anchor, cast). */
export interface StripInput { x: number; size: number; labelW: number; keep?: boolean }
/** Where the strip put a node: its row (0 = midline, ± outward) and its label's side, if any. */
export interface StripPlacement { level: number; side: 'right' | 'left' | null }

/** Clear space between two things on one strip row (glyph or label). */
const STRIP_PAD = 6;
/** A label starts this far from its glyph's centre, as a share of the glyph size. */
const LABEL_OFFSET = 0.7;

/**
 * The home strip's layout (rebuilt for #121): the kept names
 * (anchors, cast) first, then the rest, each group in date order, each node
 * on the nearest free row, centre-out. A node takes the first clear spot for
 * glyph plus label (each row: label right, then left), else a clear spot for
 * its glyph alone, else a row where its glyph covers no label (glyphs may
 * touch glyphs). Past that, the row with the fewest labels in the way takes
 * the glyph and those labels give way, plain names before kept ones; a node
 * is never dropped. Rows hold every interval placed, not only a right
 * edge, so a left-hanging label is checked against what is behind it. Pure,
 * so the property it promises (no label over a glyph or a label on its row)
 * is unit-tested; the draw paints exactly the side decided here.
 */
export function layoutStrip(nodes: readonly StripInput[], cssW: number, maxLevel: number): StripPlacement[] {
  type Span = { a: number; b: number; node: number; label: boolean };
  const rows = new Map<number, Span[]>();
  const order: number[] = [0];
  for (let s = 1; s <= maxLevel; s++) order.push(s, -s);
  const free = (level: number, a: number, b: number, labelsOnly = false): boolean =>
    !(rows.get(level) ?? []).some(sp => (!labelsOnly || sp.label) && a < sp.b + STRIP_PAD && b > sp.a - STRIP_PAD);
  const put = (level: number, sp: Span): void => {
    const r = rows.get(level);
    if (r) r.push(sp); else rows.set(level, [sp]);
  };
  const out: StripPlacement[] = nodes.map(() => ({ level: 0, side: null }));
  const sequence = nodes.map((_, i) => i).sort((a, b) =>
    Number(!!nodes[b].keep) - Number(!!nodes[a].keep) || nodes[a].x - nodes[b].x || a - b);
  for (const i of sequence) {
    const n = nodes[i];
    const g = n.size / 2;
    const off = n.size * LABEL_OFFSET;
    const right = n.x + off + n.labelW <= cssW - 2 ? { a: n.x - g, b: n.x + off + n.labelW } : null;
    const left = n.x - off - n.labelW >= 2 ? { a: n.x - off - n.labelW, b: n.x + g } : null;
    const labelled = order.flatMap(level =>
      ([['right', right], ['left', left]] as const).map(([side, span]) => ({ level, side, span })))
      .find(c => c.span && free(c.level, c.span.a, c.span.b));
    if (labelled?.span) {
      put(labelled.level, { ...labelled.span, node: i, label: true });
      out[i] = { level: labelled.level, side: labelled.side };
      continue;
    }
    let level = order.find(lv => free(lv, n.x - g, n.x + g))
      ?? order.find(lv => free(lv, n.x - g, n.x + g, true));
    if (level === undefined) {
      // Every row has a label here: the row with the fewest labels in the way
      // gives them up, plain names before kept ones (the node is never dropped).
      const covered = (lv: number): Span[] =>
        (rows.get(lv) ?? []).filter(sp => sp.label && n.x - g < sp.b + STRIP_PAD && n.x + g > sp.a - STRIP_PAD);
      const keptIn = (lv: number): number => covered(lv).filter(sp => nodes[sp.node].keep).length;
      const cost = (lv: number): number => keptIn(lv) * 1000 + covered(lv).length;
      level = order.reduce((best, lv) => cost(lv) < cost(best) ? lv : best);
      for (const sp of covered(level)) {
        const victim = nodes[sp.node];
        sp.label = false;
        sp.a = victim.x - victim.size / 2;
        sp.b = victim.x + victim.size / 2;
        out[sp.node] = { level, side: null };
      }
    }
    put(level, { a: n.x - g, b: n.x + g, node: i, label: false });
    out[i] = { level, side: null };
  }
  return out;
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

/** Half-width drawn around a zero-span axis; mirrors the room's rule
 *  (axis-calculator ZERO_SPAN_HALF_WINDOW), kept local so the show copy
 *  stays import-free. */
const ZERO_SPAN_HALF = 50;

/**
 * The axis range a frozen block DRAWS. A zero span (one dated element, or all
 * on one date) is padded symmetrically so the date sits centred, as the live
 * room does (it used to pin every node to PAD_X).
 */
export function drawnAxis(axisMin: number, axisMax: number): { lo: number; span: number } {
  if (axisMax <= axisMin) return { lo: axisMin - ZERO_SPAN_HALF, span: 2 * ZERO_SPAN_HALF };
  return { lo: axisMin, span: Math.max(1, axisMax - axisMin) };
}

export interface ChartViewOptions {
  /** Called when a node with a `ref` (a carded element) is clicked. */
  onRef?: (ref: string) => void;
  /** Canvas height in px (default 240). ADDITIVE option — the show viewer's
   *  copy of this module can lag without behavior change (re-lift discipline). */
  height?: number;
  /** 'strip' = the home chart strip's compact layout: LABEL-AWARE row
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
  title.textContent = block.title || 'Chart';
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
    // The frozen chart is a dark artifact by design (it matches the published
    // page look) — paint its own floor instead of inheriting the container,
    // or light mode renders its white-literal labels invisible.
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, cssW, height);

    const { lo: axisLo, span } = drawnAxis(block.axisMin, block.axisMax);
    const plotW = cssW - 2 * PAD_X;
    const midY = PAD_TOP + (height - PAD_TOP - PAD_BOTTOM) / 2;
    const maxLevel = Math.max(1, Math.floor((height - PAD_TOP - PAD_BOTTOM) / 2 / Y_STEP));
    const dateToX = (d: number): number => PAD_X + ((d - axisLo) / span) * plotW;

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
    if (block.axisTicks && block.axisTicks.length > 0) {
      // Baked calendar ticks (2B publish bake): the lens spoke at publish time;
      // this renderer just places text. Greedy left-to-right collision drop —
      // the bake pruned for a nominal width, the live width re-prunes.
      ctx.textAlign = 'center';
      let lastRight = -Infinity;
      for (const t of block.axisTicks) {
        const x = dateToX(t.position);
        const half = ctx.measureText(t.label).width / 2 + 6;
        if (x - half < lastRight) continue;
        ctx.beginPath();
        ctx.moveTo(x, height - PAD_BOTTOM + 5);
        ctx.lineTo(x, height - PAD_BOTTOM + 11);
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
        ctx.stroke();
        ctx.fillText(t.label, Math.min(cssW - half, Math.max(half, x)), height - 8);
        lastRight = x + half;
      }
      ctx.textAlign = 'left';
    } else if (block.axisMax <= block.axisMin) {
      // Zero span: the one date sits centred, labelled there.
      ctx.textAlign = 'center';
      ctx.fillText(String(block.axisMin), dateToX(block.axisMin), height - 8);
      ctx.textAlign = 'left';
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(String(block.axisMin), PAD_X, height - 8);
      ctx.textAlign = 'right';
      ctx.fillText(String(block.axisMax), cssW - PAD_X, height - 8);
    }

    if (opts.layout === 'strip') {
      // Strip layout: pure date order, every node trying for a label (the
      // room's label-budget spirit: labels keep a preview from reading as a
      // monotone dot-run), rows filled centre-out by `layoutStrip`, so a short
      // band fans instead of piling its labels on one line (Titus's
      // home-strip shots, 2026-07-12; Skeld's pre-smoke).
      const ordered = block.nodes
        .map((n, i) => ({ n, i }))
        .sort((a, b) => a.n.date - b.n.date || a.i - b.i);
      const inputs = ordered.map(({ n }) => {
        // Cast and anchors measure at 12px, the rest 11px, as they draw.
        ctx.font = n.anchor || n.cast ? "12px system-ui, sans-serif" : "11px system-ui, sans-serif";
        return {
          x: dateToX(n.date),
          size: n.cast ? ICON_ANCHOR + 3 : n.anchor ? ICON_ANCHOR : ICON,
          labelW: ctx.measureText(n.name).width,
          keep: !!(n.anchor || n.cast),
        };
      });
      const layout = layoutStrip(inputs, cssW, maxLevel);
      placed = ordered.map(({ n }, k) => {
        const color = ELEMENT_TYPE_COLORS[n.type as ElementType] ?? '#94a3b8';
        return {
          x: inputs[k].x, y: midY + layout[k].level * Y_STEP,
          icon: ELEMENT_ICONS[n.type as ElementType] ?? 'category',
          color, name: n.name, anchor: !!n.anchor, cast: n.cast, ref: n.ref,
          endX: n.endDate != null ? dateToX(n.endDate) : undefined,
          side: layout[k].side ?? undefined,
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
        // In the strip the halo stays inside its row: at size * 0.85 it
        // reached halfway into the next row's labels.
        const halo = opts.layout === 'strip' ? Math.min(size * 0.85, Y_STEP / 2 - 1) : size * 0.85;
        ctx.beginPath();
        ctx.arc(p.x, p.y, halo, 0, Math.PI * 2);
        ctx.fillStyle = applyAlpha(p.color, 0.12);
        ctx.fill();
      }
      ctx.font = `${size}px "Material Symbols Outlined"`;
      ctx.fillStyle = p.color;
      ctx.textAlign = 'center';
      ctx.fillText(p.icon, p.x, p.y);

      const strip = opts.layout === 'strip';
      if (strip ? p.side : (p.anchor || p.cast)) {
        const plain = !p.anchor && !p.cast;
        ctx.font = plain ? "11px system-ui, sans-serif" : "12px system-ui, sans-serif";
        const lw = ctx.measureText(p.name).width;
        // The strip paints the side its layout decided; the default layout
        // flips left so an anchor near the right edge isn't clipped.
        const left = strip ? p.side === 'left' : p.x + size * LABEL_OFFSET + lw > cssW - PAD_X;
        const x0 = left ? p.x - size * LABEL_OFFSET - lw : p.x + size * LABEL_OFFSET;
        if (strip) {
          // A range line on the row runs behind the name, not through it.
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(x0 - 2, p.y - 8, lw + 4, 16);
        }
        ctx.fillStyle = p.cast ? 'rgba(34,211,238,0.95)'
          : plain ? 'rgba(255,255,255,0.62)'
          : 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'left';
        ctx.fillText(p.name, x0, p.y);
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
