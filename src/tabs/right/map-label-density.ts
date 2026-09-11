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
  /** The obstacle this label belongs to (its own pin icon), which it may overlap. */
  owner?: string;
  /** An anchor may, as a last resort, sit over icons lighter than itself. */
  anchor?: boolean;
}

/**
 * Something a label must not cover: a pin icon. Labels are exempt from their
 * own pin (the label hangs off it by design). `weight` is the pin's own
 * importance: a label that fits NOWHERE cleanly may, as a last resort, sit
 * over an icon of strictly lower weight (Syrakousai ringed by its harbour
 * towns at fit zoom had no clean slot and lost its name; an unlabelled
 * Syracuse is a bigger loss than a covered Plemmyrion). Omitted = never
 * coverable.
 */
export interface Obstacle { id: string; box: Box; weight?: number }

/** Breathing room between two placed labels — a label ending flush against
 *  the next reads as one word (the charts finding, same number). */
const LABEL_PAD_PX = 4;

function overlaps(a: Box, b: Box): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function padded(b: Box): Box {
  return { x0: b.x0 - LABEL_PAD_PX, x1: b.x1 + LABEL_PAD_PX, y0: b.y0, y1: b.y1 };
}

/**
 * Greedy placement: sort by (pri asc, weight desc, id asc for determinism);
 * for each candidate take the first of its boxes whose padded extent clears
 * every placed box and every obstacle that is not its own. Candidates whose
 * first box lies entirely outside the viewport are kept at placement 0
 * without competing: they cannot collide with anything the user can see, and
 * hiding them would only make the next pan flash. Returns id → index of the
 * chosen box; absent = culled.
 */
export function chooseVisibleLabels(
  cands: readonly LabelCandidate[],
  viewport: { w: number; h: number },
  obstacles: readonly Obstacle[] = [],
): Map<string, number> {
  const sorted = [...cands].sort((a, b) =>
    a.pri - b.pri || b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed: Box[] = [];
  const chosen = new Map<string, number>();
  const screen: Box = { x0: 0, y0: 0, x1: viewport.w, y1: viewport.h };
  const onScreen = obstacles.filter(o => overlaps(o.box, screen));
  for (const c of sorted) {
    if (c.boxes.length === 0) continue;
    if (!overlaps(c.boxes[0], screen)) { chosen.set(c.id, 0); continue; }
    // Round one: a clean slot (no label, no icon but its own). Round two,
    // anchors only, and only if round one found nothing: a slot that covers
    // icons of strictly lower weight. Other labels are never covered.
    let taken = false;
    for (const lastResort of c.anchor ? [false, true] : [false]) {
      for (let i = 0; i < c.boxes.length && !taken; i++) {
        const pb = padded(c.boxes[i]);
        if (placed.some(b => overlaps(pb, b))) continue;
        const blocked = onScreen.some(o =>
          o.id !== c.owner && overlaps(pb, o.box)
          && !(lastResort && o.weight !== undefined && o.weight < c.weight));
        if (blocked) continue;
        placed.push(c.boxes[i]);
        chosen.set(c.id, i);
        taken = true;
      }
      if (taken) break;
    }
  }
  return chosen;
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
 * The anchors: the top share of pins by weight, the names a map must carry
 * at any zoom (the charts room's anchor tier, same idea). Only they get the
 * last-resort placement over a lighter icon.
 */
const ANCHOR_SHARE = 0.1;
const ANCHOR_MIN = 3;
export function anchorThreshold(weights: readonly number[]): number {
  if (weights.length === 0) return Infinity;
  const sorted = [...weights].sort((a, b) => b - a);
  const n = Math.min(sorted.length, Math.max(ANCHOR_MIN, Math.ceil(sorted.length * ANCHOR_SHARE)));
  return sorted[n - 1];
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

/** One rect read of a rendered span, before any write this pass makes. */
function calibrate(el: HTMLElement, anchor: { x: number; y: number }, origin: DOMRect): LabelMetrics | null {
  const span = el.querySelector('span') as HTMLElement | null;
  if (!span) return null;
  const r = span.getBoundingClientRect();
  if (r.width === 0) return null;
  const font = getComputedStyle(span).font;
  const text = span.textContent ?? '';
  const tw = textWidth(text, font);
  return {
    chromeW: r.width - tw,
    h: r.height,
    dx: r.left - origin.left - anchor.x,
    dy: r.top - origin.top - anchor.y,
    calibratedW: r.width,
    font,
  };
}

function inkBox(m: LabelMetrics, anchor: { x: number; y: number }, text: string): Box {
  const w = textWidth(text, m.font) + m.chromeW;
  // Both label kinds centre on their anchor's x; dx was calibrated on a span
  // of another width, so re-centre from it.
  const x0 = anchor.x + m.dx + (m.calibratedW - w) / 2;
  return { x0, y0: anchor.y + m.dy, x1: x0 + w, y1: anchor.y + m.dy + m.h };
}

/** Half the divIcon's fixed width: Leaflet2DManager.addPin anchors the label
 *  at [75, ...] on a 150px box. */
const PIN_LABEL_HALF_WIDTH = 75;

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

  const origin = entry.container.getBoundingClientRect();
  const viewport = { w: origin.width, h: origin.height };

  // Calibrate BEFORE any write: one un-culled, un-moved label of each kind.
  const defaultMarginLeft = `${-PIN_LABEL_HALF_WIDTH}px`;
  const defaultMarginTop = `${iconHalf + gap}px`;
  let pinMetrics: LabelMetrics | null = null;
  let zoneMetrics: LabelMetrics | null = null;
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
      zoneMetrics = calibrate(el, anchor, origin);
      if (zoneMetrics) break;
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
  if (!pinsAuto && !zonesAuto) return;
  if (viewport.w === 0 || viewport.h === 0) return;
  // Nothing to calibrate on (every label of a kind culled or moved by the
  // previous pass, or a pass before the first paint): everything is reset
  // now, so the next moveend calibrates cleanly. Leaving them all visible
  // for one settle is the honest fallback.
  if ((pinsAuto && !pinMetrics && pinLabelEls.length > 0) || (zonesAuto && !zoneMetrics && zoneLabelEls.length > 0)) return;

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
  for (const { id, anchor } of pinLabelEls) {
    const box = { x0: anchor.x - iconHalf, y0: anchor.y - iconHalf, x1: anchor.x + iconHalf, y1: anchor.y + iconHalf };
    iconBoxes.set(id, box);
    obstacles.push({ id, box, weight: pinWeight(targetOf(id), elements) });
  }

  if (pinsAuto && pinMetrics) {
    const anchorAt = anchorThreshold(obstacles.map(o => o.weight ?? 0));
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
        anchor: selected || weight >= anchorAt,
      });
      pinById.set(key, { el, ink });
    }
  }
  if (zonesAuto && zoneMetrics && entry.zoneOverlay) {
    const rules = state.styles.rules;
    for (const { id, el, anchor } of zoneLabelEls) {
      // A hidden zone's label is already at opacity 0; it must not claim space.
      if (!entry.zoneOverlay.isZoneVisible(id)) continue;
      const extent = entry.zoneOverlay.getZoneScreenExtent(id);
      const line = entry.zoneOverlay.getZoneMode(id) === 'line';
      const selected = selectedId === id;
      // A kind with label_priority (world styles) competes in the pin tier:
      // the big rivers keep their names at fit zoom.
      const zone = byId.get(id);
      const prioritised = zone ? Boolean(resolveStyle(rules, zone).label_priority) : false;
      const key = `zone:${id}`;
      cands.push({ id: key, pri: selected ? 0 : prioritised ? 1 : line ? 3 : 2, weight: extent, boxes: [inkBox(zoneMetrics, anchor, el.textContent ?? '')] });
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
    const zoneEl = zoneById.get(c.id);
    if (zoneEl && idx === undefined) zoneEl.classList.add(LABEL_CULLED_CLASS);
  }
}
