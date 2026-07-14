/**
 * Scroll-view layout kernel (2C, S13) — pure: dated nodes → vertically
 * positioned document items. Down = later. Content-paced with honest seams:
 * consecutive spacing derives from the time gap but clamps to a readable band,
 * and when real time vastly exceeds what the clamp can show, an explicit gap
 * seam names the skipped span instead of rendering (or hiding) the void.
 *
 * Design record: `Forge/Notes/2026-07-14-s268-scroll-design.md` (C4/C5/C6).
 * No DOM, no store — unit-tested in tests/unit/scroll-layout.test.ts.
 */

import type { TimelineNode } from './types';
import type { CalendarConfig } from '../../core/calendar';
import { eraBandsInRange } from '../../core/calendar-axis';

/** A dated element's card anchor (the dot on the spine). */
export interface ScrollNodeItem {
  kind: 'node';
  node: TimelineNode;
  y: number;
  side: 'left' | 'right';
}

/** Skipped time, named: "· 132 years pass ·" (renderer formats `steps`). */
export interface ScrollGapItem {
  kind: 'gap';
  y: number;
  steps: number;
}

/** An era section seam — the reckoning changes here. */
export interface ScrollEraItem {
  kind: 'era';
  y: number;
  name: string;
}

/** The world's now — the seam you scroll across. */
export interface ScrollNowItem {
  kind: 'now';
  y: number;
}

export type ScrollItem = ScrollNodeItem | ScrollGapItem | ScrollEraItem | ScrollNowItem;

export interface ScrollLayout {
  items: ScrollItem[];
  totalHeight: number;
  /** Document y for a date — piecewise-linear between node anchors (reveal). */
  yForDate(date: number): number;
  /** Inverse of yForDate — the sticky readout's "what time is this scroll". */
  dateForY(y: number): number | null;
}

// Vertical rhythm (px). MIN_GAP must exceed a typical collapsed card so
// same-date clusters never overlap; the clamp band is the "readable pacing"
// C5 calls for, and everything past it is a named seam, not more distance.
export const SCROLL_TOP_PAD = 72;
export const SCROLL_BOTTOM_PAD = 160;
export const SCROLL_MIN_GAP = 96;
export const SCROLL_MAX_GAP = 300;
const GAP_SEAM_H = 48;
const ERA_SEAM_H = 60;
const NOW_SEAM_H = 44;
/** A gap seam fires when the raw time gap exceeds this multiple of the
 *  world's median non-zero gap (a uniform world never seams). */
const GAP_SEAM_FACTOR = 3;

interface LayoutOpts {
  now?: number | null;
  calendar?: CalendarConfig | null;
}

/** The era containing `step`, or null in an era gap / calendar without eras. */
function eraNameAt(cfg: CalendarConfig | null | undefined, step: number): string | null {
  if (!cfg?.eras || cfg.eras.length === 0) return null;
  const bands = eraBandsInRange(cfg, step, step + 1e-6);
  return bands.length > 0 ? bands[0].era.name : null;
}

/** Median of the non-zero gaps between consecutive sorted dates (0 if none). */
function medianGap(dates: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const g = dates[i] - dates[i - 1];
    if (g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 === 0 ? (gaps[mid - 1] + gaps[mid]) / 2 : gaps[mid];
}

/**
 * Lay the document out. Deterministic: nodes sort by date then id; sides
 * alternate in that order (right first — reading enters from the spine's
 * right on LTR screens).
 */
export function layoutScroll(nodes: TimelineNode[], opts: LayoutOpts = {}): ScrollLayout {
  const sorted = nodes
    .slice()
    .sort((a, b) => a.startDate - b.startDate || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cal = opts.calendar ?? null;
  const now = opts.now ?? null;

  const items: ScrollItem[] = [];
  const anchors: Array<{ date: number; y: number }> = []; // node anchors, for yForDate
  const dates = sorted.map(n => n.startDate);
  const med = medianGap(dates);

  let cursor = SCROLL_TOP_PAD;
  let prevEra: string | null = null;
  let nowPlaced = now == null;

  // The now precedes all recorded history: seam first, document after.
  if (!nowPlaced && sorted.length > 0 && now! < sorted[0].startDate) {
    items.push({ kind: 'now', y: cursor });
    cursor += NOW_SEAM_H;
    nowPlaced = true;
  }

  sorted.forEach((node, i) => {
    // Seams that belong BETWEEN the previous node and this one, in date order.
    const seams: ScrollItem[] = [];

    if (i > 0) {
      const rawGap = node.startDate - sorted[i - 1].startDate;
      if (med > 0 && rawGap > med * GAP_SEAM_FACTOR) {
        seams.push({ kind: 'gap', y: 0, steps: rawGap });
      }
      if (!nowPlaced && now! > sorted[i - 1].startDate && now! <= node.startDate) {
        seams.push({ kind: 'now', y: 0 });
        nowPlaced = true;
      }
    }

    // Era section seam — whenever this node's era differs from the last
    // node's. An era-gap node gets no header (absence is the rendering);
    // re-entering an era re-announces it.
    const era = eraNameAt(cal, node.startDate);
    if (era !== null && era !== prevEra) {
      seams.push({ kind: 'era', y: 0, name: era });
    }
    prevEra = era;

    // Spacing: clamp the time gap into the readable band. Same-date cluster
    // members keep MIN_GAP so cards always have room.
    if (i > 0) {
      const rawGap = node.startDate - sorted[i - 1].startDate;
      const scaled = med > 0 ? (rawGap / med) * (SCROLL_MIN_GAP * 1.5) : SCROLL_MIN_GAP;
      const spacing = Math.max(SCROLL_MIN_GAP, Math.min(SCROLL_MAX_GAP, scaled));
      // Distribute seams evenly through the spacing run, each adding its own
      // height so anchors never collide.
      const segment = spacing / (seams.length + 1);
      for (const seam of seams) {
        cursor += segment;
        seam.y = cursor + seamHeight(seam) / 2;
        cursor += seamHeight(seam);
        items.push(seam);
      }
      cursor += segment;
    } else {
      for (const seam of seams) {
        seam.y = cursor + seamHeight(seam) / 2;
        cursor += seamHeight(seam) + 18;
        items.push(seam);
      }
    }

    const placed: ScrollNodeItem = {
      kind: 'node',
      node,
      y: cursor,
      side: i % 2 === 0 ? 'right' : 'left',
    };
    items.push(placed);
    anchors.push({ date: node.startDate, y: cursor });
  });

  // The now lies beyond all recorded history: close the document with it.
  if (!nowPlaced && sorted.length > 0) {
    cursor += SCROLL_MIN_GAP;
    items.push({ kind: 'now', y: cursor + NOW_SEAM_H / 2 });
    cursor += NOW_SEAM_H;
  }

  const totalHeight = cursor + SCROLL_BOTTOM_PAD;

  function yForDate(date: number): number {
    if (anchors.length === 0) return SCROLL_TOP_PAD;
    if (date <= anchors[0].date) return anchors[0].y;
    const last = anchors[anchors.length - 1];
    if (date >= last.date) return last.y;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1];
      const b = anchors[i];
      if (date <= b.date) {
        if (b.date === a.date) return a.y;
        const t = (date - a.date) / (b.date - a.date);
        return a.y + t * (b.y - a.y);
      }
    }
    return last.y;
  }

  function dateForY(y: number): number | null {
    if (anchors.length === 0) return null;
    if (y <= anchors[0].y) return anchors[0].date;
    const last = anchors[anchors.length - 1];
    if (y >= last.y) return last.date;
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1];
      const b = anchors[i];
      if (y <= b.y) {
        if (b.y === a.y) return a.date;
        const t = (y - a.y) / (b.y - a.y);
        return a.date + t * (b.date - a.date);
      }
    }
    return last.date;
  }

  return { items, totalHeight, yForDate, dateForY };
}

function seamHeight(item: ScrollItem): number {
  switch (item.kind) {
    case 'gap': return GAP_SEAM_H;
    case 'era': return ERA_SEAM_H;
    case 'now': return NOW_SEAM_H;
    default: return 0;
  }
}
