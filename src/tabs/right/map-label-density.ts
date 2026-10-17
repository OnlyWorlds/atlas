/**
 * The density layer for the map canvas (S356).
 *
 * Born on Skeld's Sikelia: 196 pins, 319 zones and their labels on one
 * 8000x5200 canvas, every label "always" on, every pin a 32px icon over a
 * 24px median gap to its nearest neighbour. Unreadable. The charts room
 * already knew the answer (timeline-view's drawLabels): build candidates in
 * PRIORITY order, try each label's placements in a fixed preference order,
 * place greedily, and let a label that fits nowhere simply drop. This module
 * is that rule for Leaflet DOM labels plus one more rule for the pins
 * themselves: an icon is never wider than ~70% of the typical gap between
 * icons at the current zoom.
 *
 * Pure kernels (unit-tested) and one DOM pass:
 *
 *   - `chooseVisibleLabels`: greedy collision pruning over measured boxes,
 *     each candidate offering its placements in preference order.
 *   - `pinLabelPlacements`: the four boxes a pin label may occupy (below,
 *     right, left, above), derived from its measured ink and its icon.
 *   - `medianNearestNeighbour` + `pinScaleForSpacing`: the icon-scale rule.
 *   - `refreshLabelDensity(entry)`: the pass map-tab runs on moveend/zoomend
 *     and after every pin/zone sync when a labels pref is 'auto'.
 *
 * Culling is a CSS class (`atlas-label-culled`), never `style.display`, so it
 * cannot fight `applyLabelVisibility` (which owns display for the mode) or
 * ZoneOverlay.applyStyle (which owns opacity for hover/hidden). Placement is
 * the label element's margins, which is how Leaflet expresses a divIcon's
 * anchor in the first place; the pass resets them to the below-anchor before
 * measuring so a previous pass's choice never leaks into the next.
 */

import { getState } from '../../core/state';
import { getEffectiveMapPrefs } from '../../core/map-view-prefs';
import type { Element } from '../../core/types';
import { buildReverseIndex } from './context-pane-graph';
import { resolveStyle } from '../../core/world-styles';
import type { MapTabCacheEntry } from './map-tab-cache';

export const LABEL_CULLED_CLASS = 'atlas-label-culled';

export interface Box { x0: number; y0: number; x1: number; y1: number }

export interface LabelCandidate {
  id: string;
  /** Lower wins a contested spot. 0 = selected, 1 = pins, 2 = polygon zones, 3 = line zones. */
  pri: number;
  /** Within a priority tier, higher wins (screen extent for zones, world degree for pins). */
  weight: number;
  /** Placements in preference order; the first that fits is taken. */
  boxes: readonly Box[];
  /** A placement that is not one box (a name along a river, S424): what it
   *  covers, piece by piece, per placement. `boxes[i]` is then its bounds,
   *  for the screen test; collisions are tested on the pieces. */
  parts?: readonly (readonly Box[])[];
  /** The obstacle this label belongs to (its own pin icon), which it may overlap. */
  owner?: string;
  /** The text the label prints, normalised. A map prints a name once: a zone
   *  and the pin of the same name (Moppetopia's Snack Nebula, S380) share one
   *  label, and the higher-ranked candidate (the pin) carries it. */
  name?: string;
}

/**
 * Something a label must never cover: a pin icon. Labels are exempt from
 * their own pin (the label hangs off it by design). A label with no clear
 * placement is culled and its pin names itself on hover (the pin tooltip),
 * the rule the published page follows (show a327199). S356 let a heavy pin's
 * label cover a lighter icon as a last resort; at fit zoom on Moppetopia that
 * put Feltropolis and USS Fuzzball over their neighbours (S381 pre-smoke), and
 * the Captain's rule for the page is that labels never clash with pins.
 */
export interface Obstacle { id: string; box: Box }

/** Breathing room between two placed labels — a label ending flush against
 *  the next reads as one word (the charts finding, same number). */
const LABEL_PAD_PX = 4;

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function padded(b: Box): Box {
  return { x0: b.x0 - LABEL_PAD_PX, x1: b.x1 + LABEL_PAD_PX, y0: b.y0, y1: b.y1 };
}

function inside(b: Box, screen: Box): boolean {
  return b.x0 >= screen.x0 && b.x1 <= screen.x1 && b.y0 >= screen.y0 && b.y1 <= screen.y1;
}

/**
 * Greedy placement: sort by (pri asc, weight desc, id asc for determinism);
 * for each candidate take the first of its boxes that lies inside the
 * viewport and whose padded extent clears every placed box and every
 * obstacle that is not its own; a name already placed is not placed again.
 * Candidates whose first box lies entirely outside the viewport are kept at
 * placement 0 without competing: they cannot collide with anything the user
 * can see, and hiding them would only make the next pan flash. Returns id →
 * index of the chosen box; absent = culled.
 */
export function chooseVisibleLabels(
  cands: readonly LabelCandidate[],
  viewport: { w: number; h: number },
  obstacles: readonly Obstacle[] = [],
): Map<string, number> {
  const sorted = [...cands].sort((a, b) =>
    a.pri - b.pri || b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: Box[] = [];
  const names = new Set<string>();
  const chosen = new Map<string, number>();
  const screen: Box = { x0: 0, y0: 0, x1: viewport.w, y1: viewport.h };
  const onScreen = obstacles.filter(o => overlaps(o.box, screen));
  for (const c of sorted) {
    if (c.boxes.length === 0) continue;
    if (c.name && names.has(c.name)) continue;
    if (!overlaps(c.boxes[0], screen)) {
      chosen.set(c.id, 0);
      if (c.name) names.add(c.name);
      continue;
    }
    for (let i = 0; i < c.boxes.length; i++) {
      // A box across the viewport's edge prints a clipped name ("aky Bucket"
      // on a phone): another side, or hover.
      if (!inside(c.boxes[i], screen)) continue;
      const pieces = c.parts?.[i] ?? [c.boxes[i]];
      const clear = pieces.every(piece => {
        const pb = padded(piece);
        return !placed.some(b => overlaps(pb, b)) && !onScreen.some(o => o.id !== c.owner && overlaps(pb, o.box));
      });
      if (!clear) continue;
      placed.push(...pieces);
      chosen.set(c.id, i);
      if (c.name) names.add(c.name);
      break;
    }
  }
  return chosen;
}

/** The key a label's text is compared by: trimmed, case-folded. */
export function labelNameKey(text: string | null | undefined): string | undefined {
  const k = (text ?? '').trim().toLowerCase();
  return k || undefined;
}

/**
 * The four places a pin label may sit, from its measured below-placement
 * ink box and its icon box: below (the anchor Leaflet gave it), right, left,
 * above. BELOW first so a sparse map reads exactly as before; the side and
 * top slots exist for the label that would otherwise drop because a
 * neighbour's icon sits under its pin (Syrakousai, ringed by its satellites,
 * lost its name to Adryx on the first pass).
 */
export function pinLabelPlacements(ink: Box, icon: Box, gap: number): Box[] {
  const w = ink.x1 - ink.x0;
  const h = ink.y1 - ink.y0;
  const cx = (icon.x0 + icon.x1) / 2;
  const cy = (icon.y0 + icon.y1) / 2;
  const right: Box = { x0: icon.x1 + gap, x1: icon.x1 + gap + w, y0: cy - h / 2, y1: cy + h / 2 };
  const left: Box = { x0: icon.x0 - gap - w, x1: icon.x0 - gap, y0: cy - h / 2, y1: cy + h / 2 };
  const above: Box = { x0: cx - w / 2, x1: cx + w / 2, y0: icon.y0 - gap - h, y1: icon.y0 - gap };
  return [ink, right, left, above];
}

/** Where along its line a name may sit, as a share of the line's length, in preference order. */
export const ALONG_SHARES = [0.5, 0.35, 0.65, 0.2, 0.8] as const;

/**
 * The places a name written along a line may take (S424): for each share
 * of the line's length (the name centred there, as `startOffset` with a
 * middle anchor draws it), the pieces of screen it covers, one square per
 * `half`-sized step of its span, lifted `lift` px to the side the glyphs
 * stand on (left of travel: the line runs left to right, so up). A share
 * whose span would run off either end is left out, so a name longer than
 * its line has no place at all. `points` are container px, in reading order.
 * With `within` (a river's stretches on land, shares of its length), a name
 * keeps inside one of them, and the middle of the longest is tried first.
 */
export function alongLabelPlacements(
  points: readonly { x: number; y: number }[],
  textW: number,
  half: number,
  lift: number,
  shares: readonly number[] = ALONG_SHARES,
  within?: ReadonlyArray<readonly [number, number]>,
): Array<{ share: number; box: Box; parts: Box[] }> {
  if (within) {
    const mids = [...within].sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).map(([a, b]) => (a + b) / 2);
    shares = [...mids, ...shares.filter(s => !mids.includes(s))];
  }
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = cum[cum.length - 1];
  if (points.length < 2 || !(total > 0) || textW > total) return [];
  // The point at arc length s, and the unit "up" there (left of travel).
  const at = (s: number): { x: number; y: number; ux: number; uy: number } => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const a = points[i - 1], b = points[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
    const tx = (b.x - a.x) / seg, ty = (b.y - a.y) / seg;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, ux: ty, uy: -tx };
  };
  const out: Array<{ share: number; box: Box; parts: Box[] }> = [];
  for (const share of shares) {
    const s0 = share * total - textW / 2;
    const s1 = share * total + textW / 2;
    if (s0 < 0 || s1 > total) continue;
    if (within && !within.some(([a, b]) => s0 >= a * total - 1e-6 && s1 <= b * total + 1e-6)) continue;
    const parts: Box[] = [];
    const steps = Math.max(1, Math.ceil((s1 - s0) / half));
    for (let k = 0; k <= steps; k++) {
      const p = at(s0 + ((s1 - s0) * k) / steps);
      const cx = p.x + p.ux * lift, cy = p.y + p.uy * lift;
      parts.push({ x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half });
    }
    const box: Box = {
      x0: Math.min(...parts.map(b => b.x0)), y0: Math.min(...parts.map(b => b.y0)),
      x1: Math.max(...parts.map(b => b.x1)), y1: Math.max(...parts.map(b => b.y1)),
    };
    out.push({ share, box, parts });
  }
  return out;
}

/**
 * Median distance from each point to its nearest other point, in the units
 * the points come in. O(n^2) — 200 pins is 40k distance checks, 2000 is 4M,
 * both fine at sync cadence; computed in STORAGE units once per pin set and
 * scaled per zoom by the caller, so zoomend never re-runs it. Returns
 * Infinity for fewer than two points (no neighbour to be too close to).
 */
export function medianNearestNeighbour(points: readonly { x: number; y: number }[]): number {
  const n = points.length;
  if (n < 2) return Infinity;
  const nn: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let best = Infinity;
    const pi = points[i];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = pi.x - points[j].x;
      const dy = pi.y - points[j].y;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    nn[i] = Math.sqrt(best);
  }
  nn.sort((a, b) => a - b);
  return nn[Math.floor((n - 1) / 2)];
}

/** Floor of the icon-scale rule: below this a 32px icon is a 13px dot and
 *  the type glyph stops reading; the pin is still a target. */
export const PIN_SCALE_MIN = 0.4;
/** The icon may fill this much of the typical gap between icons. */
const PIN_GAP_FILL = 0.7;

/**
 * Icon scale for a pin set whose median nearest-neighbour gap is `spacingPx`
 * on screen at the current zoom, for an icon of `iconPx` at scale 1. Never
 * grows past 1 (a sparse map keeps the size the user tuned); shrinks so the
 * icon covers at most ~70% of the gap; floors at PIN_SCALE_MIN. Rounded to
 * two decimals so a nudge of the map never re-skins every marker.
 */
export function pinScaleForSpacing(spacingPx: number, iconPx: number): number {
  if (!Number.isFinite(spacingPx) || iconPx <= 0) return 1;
  const raw = (spacingPx * PIN_GAP_FILL) / iconPx;
  const clamped = Math.min(1, Math.max(PIN_SCALE_MIN, raw));
  return Math.round(clamped * 100) / 100;
}

/**
 * A pin label's weight is how much the world points at its element: incoming
 * links (the charts room's `degree`) plus a log of how much is written about
 * it. Syrakousai outranks a hamlet because the world says so, not because
 * its name is short. The reverse index is cached per elements-array
 * reference (the store swaps the array on every write), same pattern as
 * unlinked-mentions.
 */
const reverseIndexCache = new WeakMap<readonly Element[], Map<string, Set<string>>>();
function pinWeight(target: Element | undefined, elements: readonly Element[]): number {
  if (!target) return 0;
  let idx = reverseIndexCache.get(elements);
  if (!idx) { idx = buildReverseIndex(elements); reverseIndexCache.set(elements, idx); }
  const incoming = idx.get(target.id)?.size ?? 0;
  const mass = typeof target.description === 'string' ? target.description.length : 0;
  return incoming + Math.log10(1 + mass);
}

/**
 * Label boxes are COMPUTED, not read. A pass that resets two hundred margins
 * and then reads seven hundred rects forces one full layout of a thousand
 * absolutely-positioned markers and six hundred SVG paths, which measured
 * 20-90ms a zoom on Sikelia while the kernel took one. So the pass projects
 * each anchor through Leaflet (no layout), measures text on a canvas (no
 * layout), and calibrates the two constants it cannot know — the chrome a
 * span adds around its text, and where the span sits relative to its
 * anchor — from ONE pin label and ONE zone label per pass, read before any
 * write. Zero forced layouts after that.
 */
interface LabelMetrics {
  /** Extra width the span adds around its measured text (padding + border). */
  chromeW: number;
  /** Rendered span height. */
  h: number;
  /** Span's top-left relative to the label marker's anchor point, as calibrated. */
  dx: number;
  dy: number;
  /** Width of the span the offsets were calibrated on (spans centre on x). */
  calibratedW: number;
  font: string;
  /** The face's case and spacing, which a canvas does not apply (S424: a
   *  styled map letters a landmass in spaced capitals). */
  upper: boolean;
  spacing: number;
}

function measured(m: Pick<LabelMetrics, 'font' | 'upper' | 'spacing'>, text: string): number {
  return textWidth(m.upper ? text.toUpperCase() : text, m.font) + m.spacing * text.length;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureContext(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    // Lazy and guarded: jsdom has no 2D context, and the kernels above are
    // unit-tested there without ever needing one.
    try { measureCtx = document.createElement('canvas').getContext('2d'); } catch { measureCtx = null; }
  }
  return measureCtx;
}
const textWidthCache = new Map<string, number>();
function textWidth(text: string, font: string): number {
  const key = font + '|' + text;
  const hit = textWidthCache.get(key);
  if (hit !== undefined) return hit;
  const ctx = measureContext();
  if (!ctx) return text.length * 6;
  ctx.font = font;
  const w = ctx.measureText(text).width;
  if (textWidthCache.size > 5000) textWidthCache.clear();
  textWidthCache.set(key, w);
  return w;
}

/** A zone label's face: the classes that decide its font and anchor, never the pass's own. */
function labelFace(el: HTMLElement): string {
  return Array.from(el.classList).filter(c => c.startsWith('atlas-zone-label') || c.startsWith('atlas-ink-')).sort().join(' ');
}
const zoneMetricsByEntry = new WeakMap<MapTabCacheEntry, Map<string, LabelMetrics>>();
/** A name along a line's face: its classes, never the pass's own cull. */
function alongFaceKey(el: globalThis.Element): string {
  return Array.from(el.classList).filter(c => c !== LABEL_CULLED_CLASS).sort().join(' ');
}

/** One rect read of a rendered span, before any write this pass makes. */
function calibrate(el: HTMLElement, anchor: { x: number; y: number }, origin: DOMRect): LabelMetrics | null {
  const span = el.querySelector('span') as HTMLElement | null;
  if (!span) return null;
  const r = span.getBoundingClientRect();
  if (r.width === 0) return null;
  const cs = getComputedStyle(span);
  const font = cs.font || `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
  const upper = cs.textTransform === 'uppercase';
  const spacing = parseFloat(cs.letterSpacing) || 0;
  const text = span.textContent ?? '';
  const tw = measured({ font, upper, spacing }, text);
  return {
    chromeW: r.width - tw,
    h: r.height,
    dx: r.left - origin.left - anchor.x,
    dy: r.top - origin.top - anchor.y,
    calibratedW: r.width,
    font,
    upper,
    spacing,
  };
}

function inkBox(m: LabelMetrics, anchor: { x: number; y: number }, text: string): Box {
  const w = measured(m, text) + m.chromeW;
  // Both label kinds centre on their anchor's x; dx was calibrated on a span
  // of another width, so re-centre from it.
  const x0 = anchor.x + m.dx + (m.calibratedW - w) / 2;
  return { x0, y0: anchor.y + m.dy, x1: x0 + w, y1: anchor.y + m.dy + m.h };
}

/** Half the divIcon's fixed width: Leaflet2DManager.addPin anchors the label
 *  at [75, ...] on a 150px box. */
const PIN_LABEL_HALF_WIDTH = 75;

/**
 * Run the pass after the NEXT paint, once per burst. A pass run inside
 * Leaflet's moveend reads rects on a tree Leaflet has just dirtied (a
 * thousand transforms), which forces a full layout right there (48ms on
 * Sikelia, the profile's biggest JS-attributed cost) and then dirties it
 * again with its own writes for the frame to lay out a second time. Run
 * after the frame's own layout and the reads are free.
 */
const scheduled = new WeakSet<MapTabCacheEntry>();
export function scheduleLabelDensity(entry: MapTabCacheEntry): void {
  if (scheduled.has(entry)) return;
  scheduled.add(entry);
  requestAnimationFrame(() => setTimeout(() => {
    scheduled.delete(entry);
    refreshLabelDensity(entry);
  }, 0));
}

/**
 * The DOM pass. Idempotent; safe to call before the map has a size (it
 * returns). When neither labels pref is 'auto' it un-culls everything and
 * returns, so switching the pref back to 'always' in the popover restores
 * every label without a remount.
 */
export function refreshLabelDensity(entry: MapTabCacheEntry): void {
  const t0 = performance.now();
  try {
    runLabelDensity(entry);
  } finally {
    // Visible in the Performance panel as a named measure; the pass is
    // budgeted at a few ms on a 200-pin, 300-zone map.
    performance.measure('atlas:label-density', { start: t0 });
  }
}

function runLabelDensity(entry: MapTabCacheEntry): void {
  const prefs = getEffectiveMapPrefs(entry.mapId);
  const pinsAuto = prefs.pin_labels === 'auto';
  const zonesAuto = prefs.zone_labels === 'auto';
  const lMap = entry.manager.getMap();
  if (!lMap) return;
  const gap = entry.manager.getDefaultLabelOffset();
  const iconHalf = (entry.manager.getDefaultIconSize() * (entry.pinScale ?? 1)) / 2;

  type Anchored = { id: string; el: HTMLElement; anchor: { x: number; y: number } };
  const pinLabelEls: Anchored[] = [];
  for (const p of entry.manager.getAllPins()) {
    const el = p.label?.getElement() as HTMLElement | undefined;
    if (!el || !p.marker.getElement()) continue;
    const pt = lMap.latLngToContainerPoint(p.marker.getLatLng());
    pinLabelEls.push({ id: p.id, el, anchor: { x: pt.x, y: pt.y } });
  }
  const zoneLabelEls: Anchored[] = [];
  if (entry.zoneOverlay) {
    for (const id of entry.zoneOverlay.getZoneIds()) {
      const el = entry.zoneOverlay.getLabelElement(id);
      const anchor = entry.zoneOverlay.getLabelPoint(id);
      if (el && anchor) zoneLabelEls.push({ id, el, anchor });
    }
  }
  // Names written along lines on a styled map (S424): SVG text, no anchor.
  const alongEls: Array<{ id: string; el: SVGTextElement; points: Array<{ x: number; y: number }>; land?: Array<[number, number]> }> = [];
  if (entry.zoneOverlay) {
    for (const id of entry.zoneOverlay.getZoneIds()) {
      const along = entry.zoneOverlay.getAlongLabel(id);
      if (along) alongEls.push({ id, ...along });
    }
  }
  // Style reads before any write: one per face a name along a line takes
  // (a river's italic, a road's capitals), by the text's class.
  type AlongFace = { font: string; upper: boolean; spacing: number; size: number };
  const alongFaces = new Map<string, AlongFace>();
  if (zonesAuto) {
    for (const { el } of alongEls) {
      const key = alongFaceKey(el);
      if (alongFaces.has(key)) continue;
      const cs = getComputedStyle(el);
      alongFaces.set(key, {
        font: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`,
        upper: cs.textTransform === 'uppercase',
        spacing: parseFloat(cs.letterSpacing) || 0,
        size: parseFloat(cs.fontSize) || 12,
      });
    }
  }

  const origin = entry.container.getBoundingClientRect();
  const viewport = { w: origin.width, h: origin.height };

  // Calibrate BEFORE any write: one un-culled, un-moved label of each kind.
  const defaultMarginLeft = `${-PIN_LABEL_HALF_WIDTH}px`;
  const defaultMarginTop = `${iconHalf + gap}px`;
  let pinMetrics: LabelMetrics | null = null;
  // Zone labels by their face (S424): on a styled map each kind letters in
  // its own, so one calibration per label class, kept per map across passes
  // (a kind whose every label was culled last pass still has its numbers).
  let zoneMetrics = zoneMetricsByEntry.get(entry);
  if (!zoneMetrics) { zoneMetrics = new Map(); zoneMetricsByEntry.set(entry, zoneMetrics); }
  const calibratedNow = new Set<string>();
  if (pinsAuto && viewport.w > 0) {
    for (const { el, anchor } of pinLabelEls) {
      if (el.classList.contains(LABEL_CULLED_CLASS) || el.style.display === 'none') continue;
      if (el.style.marginLeft !== defaultMarginLeft || el.style.marginTop !== defaultMarginTop) continue;
      pinMetrics = calibrate(el, anchor, origin);
      if (pinMetrics) break;
    }
  }
  if (zonesAuto && viewport.w > 0) {
    for (const { el, anchor } of zoneLabelEls) {
      if (el.classList.contains(LABEL_CULLED_CLASS)) continue;
      const face = labelFace(el);
      if (calibratedNow.has(face)) continue;
      const m = calibrate(el, anchor, origin);
      if (m) { zoneMetrics.set(face, m); calibratedNow.add(face); }
    }
  }

  // Reset: a mode that is no longer 'auto' must get everything back where
  // Leaflet anchored it, and a moved label starts from its anchor again.
  for (const { el } of pinLabelEls) {
    el.classList.remove(LABEL_CULLED_CLASS);
    el.style.marginLeft = defaultMarginLeft;
    el.style.marginTop = defaultMarginTop;
  }
  for (const { el } of zoneLabelEls) el.classList.remove(LABEL_CULLED_CLASS);
  for (const { id, el } of alongEls) {
    el.classList.remove(LABEL_CULLED_CLASS);
    entry.zoneOverlay?.setAlongLabelShare(id, ALONG_SHARES[0]);
  }
  if (!pinsAuto && !zonesAuto) return;
  if (viewport.w === 0 || viewport.h === 0) return;
  // Nothing to calibrate on (every label of a kind culled or moved by the
  // previous pass, or a pass before the first paint): everything is reset
  // now, so the next moveend calibrates cleanly. Leaving them all visible
  // for one settle is the honest fallback.
  if ((pinsAuto && !pinMetrics && pinLabelEls.length > 0) || (zonesAuto && zoneLabelEls.some(z => !zoneMetrics.has(labelFace(z.el))))) return;

  const state = getState();
  const selectedId = state.ui.selectedElementId ?? null;
  const elements = state.data.elements;
  const byId = new Map(elements.map(e => [e.id, e]));

  const cands: LabelCandidate[] = [];
  const pinById = new Map<string, { el: HTMLElement; ink: Box }>();
  const zoneById = new Map<string, HTMLElement>();
  const obstacles: Obstacle[] = [];
  const iconBoxes = new Map<string, Box>();

  const targetOf = (pinId: string): Element | undefined => {
    const pinEl = byId.get(pinId) as { element_id?: string } | undefined;
    return pinEl?.element_id ? byId.get(pinEl.element_id) : undefined;
  };
  // A pin-shape icon stands on its point (Leaflet2DManager's 'bottom-tip'
  // anchor: its bottom edge 2px below the latlng), so its box is centred
  // above the anchor, not on it.
  const iconLift = prefs.pin_style === 'pin-shape' ? iconHalf - 2 : 0;
  for (const { id, anchor } of pinLabelEls) {
    const cy = anchor.y - iconLift;
    const box = { x0: anchor.x - iconHalf, y0: cy - iconHalf, x1: anchor.x + iconHalf, y1: cy + iconHalf };
    iconBoxes.set(id, box);
    obstacles.push({ id, box });
  }

  if (pinsAuto && pinMetrics) {
    for (const { id, el, anchor } of pinLabelEls) {
      if (el.style.display === 'none') continue;
      const icon = iconBoxes.get(id);
      if (!icon) continue;
      const ink = inkBox(pinMetrics, anchor, el.textContent ?? '');
      const target = targetOf(id);
      const selected = selectedId !== null && (selectedId === id || selectedId === target?.id);
      const weight = pinWeight(target, elements);
      const key = `pin:${id}`;
      cands.push({
        id: key,
        pri: selected ? 0 : 1,
        weight,
        boxes: pinLabelPlacements(ink, icon, gap),
        owner: id,
        name: labelNameKey(el.textContent),
      });
      pinById.set(key, { el, ink });
    }
  }
  const rules = state.styles.rules;
  // Pin labels the pass does not place (their mode is 'always') still print
  // their names, so a zone of the same name stays quiet.
  const fixedPinNames = new Set<string>();
  if (zonesAuto && !pinsAuto) {
    for (const { el } of pinLabelEls) {
      const k = el.style.display === 'none' ? undefined : labelNameKey(el.textContent);
      if (k) fixedPinNames.add(k);
    }
  }
  const alongById = new Map<string, { zoneId: string; el: SVGTextElement; shares: number[] }>();
  if (zonesAuto && entry.zoneOverlay) {
    for (const { id, el, points, land } of alongEls) {
      if (!entry.zoneOverlay.isZoneVisible(id)) continue;
      const face = alongFaces.get(alongFaceKey(el));
      if (!face) continue;
      const text = el.textContent ?? '';
      if (fixedPinNames.has(labelNameKey(text) ?? '')) { el.classList.add(LABEL_CULLED_CLASS); continue; }
      const textW = measured(face, text);
      // The glyphs stand above the line (dy -4 in ZoneOverlay): centre the pieces there.
      const placements = alongLabelPlacements(points, textW, face.size * 0.7, 4 + face.size * 0.35, ALONG_SHARES, land);
      if (placements.length === 0) { el.classList.add(LABEL_CULLED_CLASS); continue; }
      const zone = byId.get(id);
      const prioritised = zone ? Boolean(resolveStyle(rules, zone).label_priority) : false;
      const key = `along:${id}`;
      cands.push({
        id: key,
        pri: selectedId === id ? 0 : prioritised ? 1 : 3,
        weight: entry.zoneOverlay.getZoneScreenExtent(id),
        boxes: placements.map(p => p.box),
        parts: placements.map(p => p.parts),
        name: labelNameKey(text),
      });
      alongById.set(key, { zoneId: id, el, shares: placements.map(p => p.share) });
    }
  }
  if (zonesAuto && entry.zoneOverlay) {
    for (const { id, el, anchor } of zoneLabelEls) {
      // A hidden zone's label is already at opacity 0; it must not claim space.
      if (!entry.zoneOverlay.isZoneVisible(id)) continue;
      if (fixedPinNames.has(labelNameKey(el.textContent) ?? '')) { el.classList.add(LABEL_CULLED_CLASS); continue; }
      const extent = entry.zoneOverlay.getZoneScreenExtent(id);
      const line = entry.zoneOverlay.getZoneMode(id) === 'line';
      const selected = selectedId === id;
      // A kind with label_priority (world styles) competes in the pin tier:
      // the big rivers keep their names at fit zoom.
      const zone = byId.get(id);
      const prioritised = zone ? Boolean(resolveStyle(rules, zone).label_priority) : false;
      const key = `zone:${id}`;
      cands.push({
        id: key,
        pri: selected ? 0 : prioritised ? 1 : line ? 3 : 2,
        weight: extent,
        boxes: [inkBox(zoneMetrics.get(labelFace(el))!, anchor, el.textContent ?? '')],
        name: labelNameKey(el.textContent),
      });
      zoneById.set(key, el);
    }
  }

  const tk = performance.now();
  const chosen = chooseVisibleLabels(cands, viewport, obstacles);
  performance.measure('atlas:label-density:kernel', { start: tk });
  for (const c of cands) {
    const idx = chosen.get(c.id);
    const pin = pinById.get(c.id);
    if (pin) {
      if (idx === undefined) { pin.el.classList.add(LABEL_CULLED_CLASS); continue; }
      if (idx === 0) continue;
      // Move by the delta between the anchored ink box and the chosen box;
      // the margins hold the below-anchor, so a delta is exact.
      const to = c.boxes[idx];
      pin.el.style.marginLeft = `${-PIN_LABEL_HALF_WIDTH + (to.x0 - pin.ink.x0)}px`;
      pin.el.style.marginTop = `${iconHalf + gap + (to.y0 - pin.ink.y0)}px`;
      continue;
    }
    const along = alongById.get(c.id);
    if (along) {
      if (idx === undefined) along.el.classList.add(LABEL_CULLED_CLASS);
      else entry.zoneOverlay?.setAlongLabelShare(along.zoneId, along.shares[idx]);
      continue;
    }
    const zoneEl = zoneById.get(c.id);
    if (zoneEl && idx === undefined) zoneEl.classList.add(LABEL_CULLED_CLASS);
  }
}
