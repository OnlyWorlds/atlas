/**
 * Calendar-aware axis geometry — ticks at REAL calendar unit boundaries, era
 * bands, and the season/month segmentation (2B design §6 "Grid and texture").
 *
 * Replaces the power-of-ten tick guesses when a lens is active: ticks land on
 * year starts (era-local ROUND display years — "450 KR", never "abs 7603"),
 * month starts, or day strides, chosen by zoom. Era domain boundaries are
 * landmark ticks that always survive pruning.
 *
 * Label rungs (full formats walled the axis at ~2 labels):
 *   era   → "1 FT"            (formatYearLabel at the boundary)
 *   year  → "450 KR"          (formatYearLabel)
 *   month → "Greening"        (name alone; year context = the year ticks)
 *   day   → "11 Greening 454" (formatMidLabel — no era word; bands carry it)
 *
 * Pure: callers pass the step→px mapping; nothing here touches the canvas.
 */

import {
  type CalendarConfig, type CalendarEra,
  resolveEraDomains, absYearForEraYear, absoluteYear, displayYear, eraForStep,
  yearStartStep, monthStartSteps, approxYearLength,
  formatYearLabel, formatMidLabel, isLeapYear,
} from '@onlyworlds/sdk';

export interface CalendarTick {
  step: number;
  label: string;
  /** 'festival' = an intercalary day at day zoom — outranks routine day ticks. */
  rung: 'era' | 'year' | 'month' | 'festival' | 'day';
}

export interface EraBand {
  era: CalendarEra;
  /** Clipped to the queried range; always finite. */
  lo: number;
  hi: number;
  /** Position in the era sequence (stable alternation index for shading). */
  index: number;
}

export interface SeasonBand {
  lo: number;
  hi: number;
  /** 0..1 position of the band's month within the year (season color ramp). */
  frac: number;
  /** True for intercalary runs between months (festival glint). */
  intercalary: boolean;
  name: string;
}

const IDEAL_TICK_PX = 110;
const YEAR_STRIDES = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
const DAY_STRIDES = [1, 2, 5, 10];
const MONTH_STRIDES = [1, 2, 3, 4, 6];
/** Hard cap on generated ticks — a wild config never freezes the render loop. */
const MAX_TICKS = 400;

/**
 * The i-th rung of the year-stride ladder: YEAR_STRIDES, then continuing its
 * 1, 2.5, 5 x 10^k pattern without bound (deep-time spans ran
 * out of strides at 50,000 and the tick cap cut the axis short).
 */
function yearStrideAt(i: number): number {
  if (i < YEAR_STRIDES.length) return YEAR_STRIDES[i];
  const j = i - YEAR_STRIDES.length;
  const k = 5 + Math.floor(j / 3);
  return [1, 2.5, 5][j % 3] * Math.pow(10, k);
}

/** Smallest ladder stride that is at least `minYears` wide. */
function yearStrideAtLeast(minYears: number): number {
  let i = 0;
  while (yearStrideAt(i) < minYears && i < 400) i++;
  return yearStrideAt(i);
}

function estLabelW(label: string): number {
  return label.length * 6.2 + 16;
}

/** Greedy label-box pruning, highest rung first; era landmarks always win. */
function pruneTicks(ticks: CalendarTick[], toX: (step: number) => number): CalendarTick[] {
  const pri: Record<CalendarTick['rung'], number> = { era: 4, year: 3, month: 2, festival: 1, day: 0 };
  const sorted = [...ticks].sort((a, b) => pri[b.rung] - pri[a.rung]);
  const accepted: { lo: number; hi: number }[] = [];
  const out: CalendarTick[] = [];
  for (const t of sorted) {
    const x = toX(t.step);
    const half = estLabelW(t.label) / 2;
    const box = { lo: x - half, hi: x + half };
    if (accepted.some((b) => box.lo < b.hi && b.lo < box.hi)) continue;
    accepted.push(box);
    out.push(t);
  }
  return out.sort((a, b) => a.step - b.step);
}

interface Region {
  era: CalendarEra | null;
  lo: number; // inclusive step
  hi: number; // exclusive step
}

/** Era domains + the gaps between them, clipped to [min, max]. */
function regionsInRange(cfg: CalendarConfig, min: number, max: number): Region[] {
  const domains = resolveEraDomains(cfg.eras ?? [])
    .map((d) => ({ era: d.era, lo: Math.max(d.lo, min), hi: Math.min(d.hi, max + 1) }))
    .filter((d) => d.lo < d.hi)
    .sort((a, b) => a.lo - b.lo);
  const out: Region[] = [];
  let cursor = min;
  for (const d of domains) {
    if (d.lo > cursor) out.push({ era: null, lo: cursor, hi: d.lo });
    out.push(d);
    cursor = Math.max(cursor, d.hi);
  }
  if (cursor <= max) out.push({ era: null, lo: cursor, hi: max + 1 });
  return out;
}

/** Round display-year ticks (multiples of `stride`) inside one region. */
function yearTicksInRegion(
  cfg: CalendarConfig, region: Region, stride: number, min: number, max: number,
): CalendarTick[] {
  const out: CalendarTick[] = [];
  const dispAt = (step: number): number => displayYear(cfg, step, region.era);
  const d1 = dispAt(region.lo);
  const d2 = dispAt(region.hi - 1);
  const dLo = Math.min(d1, d2);
  const dHi = Math.max(d1, d2);
  // Cap by stepping the stride up, never by truncating.
  if ((dHi - dLo) / stride > MAX_TICKS) stride = yearStrideAtLeast((dHi - dLo) / MAX_TICKS);
  const first = Math.ceil(dLo / stride) * stride;
  let emitted = 0;
  for (let dy = first; dy <= dHi && emitted < MAX_TICKS; dy += stride) {
    let absY: number;
    if (region.era && region.era.restart !== false) {
      absY = absYearForEraYear(cfg, region.era, dy);
    } else {
      absY = dy;
    }
    const step = yearStartStep(cfg, absY);
    if (step < region.lo || step >= region.hi || step < min || step > max) continue;
    out.push({ step, label: formatYearLabel(cfg, step), rung: 'year' });
    emitted++;
  }
  return out;
}

/** Intercalary runs of absolute year y as [lo, hi) step spans with names. */
function intercalaryRuns(cfg: CalendarConfig, y: number): { lo: number; hi: number; name: string }[] {
  const inter = cfg.intercalary ?? [];
  const months = cfg.bundles?.months;
  if (!months || inter.length === 0) return [];
  const active = inter.filter((ic) => ic.every_years == null || isLeapYear(y, ic.every_years));
  if (active.length === 0) return [];
  const start = yearStartStep(cfg, y);
  const out: { lo: number; hi: number; name: string }[] = [];
  let offset = 0;
  const pushRun = (afterMonth: number): void => {
    for (const ic of active) {
      if (ic.after_month !== afterMonth) continue;
      out.push({ lo: start + offset, hi: start + offset + 1, name: ic.name });
      offset += 1;
    }
  };
  pushRun(0);
  for (let m = 1; m <= months.names.length; m++) {
    offset += months.lengths[m - 1];
    pushRun(m);
  }
  return out;
}

/**
 * Calendar-boundary ticks for a view window. `toX` is the caller's live
 * step→pixel mapping (used for label-collision pruning only).
 */
export function calendarTicks(
  cfg: CalendarConfig,
  min: number,
  max: number,
  widthPx: number,
  toX: (step: number) => number,
): CalendarTick[] {
  const span = Math.max(1e-9, max - min);
  const pxPerStep = widthPx / span;
  const yearLen = approxYearLength(cfg) ?? 1;
  const pxPerYear = yearLen * pxPerStep;
  const months = cfg.bundles?.months;
  const monthCount = months?.names.length ?? 0;

  const ticks: CalendarTick[] = [];

  // Era landmarks: every finite domain boundary in view.
  const boundarySteps = new Set<number>();
  for (const d of resolveEraDomains(cfg.eras ?? [])) {
    for (const edge of [d.lo, d.hi]) {
      if (Number.isFinite(edge) && edge >= min && edge <= max) boundarySteps.add(edge);
    }
  }
  for (const step of boundarySteps) {
    ticks.push({ step, label: formatYearLabel(cfg, step), rung: 'era' });
  }

  // Day rung engages as soon as the coarsest stride (10 days) still yields
  // readable spacing — below that, month/year rungs carry the axis.
  if (monthCount > 0 && pxPerStep * DAY_STRIDES[DAY_STRIDES.length - 1] >= IDEAL_TICK_PX * 0.8) {
    // Day rung — strides anchored at each month's day 1, plus every visible
    // intercalary day (they are the year's landmarks).
    let stride = DAY_STRIDES[DAY_STRIDES.length - 1];
    for (const s of DAY_STRIDES) { if (s * pxPerStep >= IDEAL_TICK_PX) { stride = s; break; } }
    const yLo = absoluteYear(cfg, Math.floor(min));
    const yHi = absoluteYear(cfg, Math.ceil(max));
    for (let y = yLo; y <= yHi && ticks.length < MAX_TICKS; y++) {
      for (const m of monthStartSteps(cfg, y)) {
        const len = months!.lengths[m.month - 1];
        for (let day = 1; day <= len; day += stride) {
          const step = m.step + (day - 1);
          if (step < min || step > max) continue;
          ticks.push({ step, label: formatMidLabel(cfg, step), rung: 'day' });
        }
      }
      for (const run of intercalaryRuns(cfg, y)) {
        for (let step = run.lo; step < run.hi; step++) {
          if (step < min || step > max) continue;
          ticks.push({ step, label: formatMidLabel(cfg, step), rung: 'festival' });
        }
      }
    }
    // Year starts keep their own rung so the year label survives pruning.
    for (let y = yLo; y <= yHi; y++) {
      const step = yearStartStep(cfg, y);
      if (step >= min && step <= max) ticks.push({ step, label: formatYearLabel(cfg, step), rung: 'year' });
    }
  } else if (monthCount > 0 && pxPerYear >= 140) {
    // Month rung — names alone; year ticks carry the year at year starts.
    let stride = MONTH_STRIDES[MONTH_STRIDES.length - 1];
    for (const s of MONTH_STRIDES) { if ((s * pxPerYear) / monthCount >= IDEAL_TICK_PX * 0.7) { stride = s; break; } }
    const yLo = absoluteYear(cfg, Math.floor(min));
    const yHi = absoluteYear(cfg, Math.ceil(max));
    for (let y = yLo; y <= yHi && ticks.length < MAX_TICKS; y++) {
      const yearStep = yearStartStep(cfg, y);
      if (yearStep >= min && yearStep <= max) {
        ticks.push({ step: yearStep, label: formatYearLabel(cfg, yearStep), rung: 'year' });
      }
      for (const m of monthStartSteps(cfg, y)) {
        if ((m.month - 1) % stride !== 0) continue;
        if (m.step < min || m.step > max) continue;
        // Month 1 usually opens the year the year tick already marks.
        if (m.step === yearStep) continue;
        ticks.push({ step: m.step, label: m.name, rung: 'month' });
      }
    }
  } else {
    // Year rung — round era-local display years per region.
    const stride = yearStrideAtLeast(IDEAL_TICK_PX / pxPerYear);
    for (const region of regionsInRange(cfg, min, max)) {
      ticks.push(...yearTicksInRegion(cfg, region, stride, min, max));
    }
  }

  return pruneTicks(ticks.slice(0, MAX_TICKS), toX);
}

/** Era bands (finite, clipped) for shading a range — axis plot or strip. */
export function eraBandsInRange(cfg: CalendarConfig, min: number, max: number): EraBand[] {
  const out: EraBand[] = [];
  const domains = resolveEraDomains(cfg.eras ?? []).sort((a, b) => a.lo - b.lo);
  domains.forEach((d, index) => {
    const lo = Math.max(d.lo, min);
    const hi = Math.min(d.hi, max);
    if (lo >= hi) return;
    out.push({ era: d.era, lo, hi, index });
  });
  return out;
}

/**
 * Month/intercalary segmentation for the season wash. Empty when months are
 * absent or the window spans too many years for bands to read (> 24).
 */
export function seasonBandsInRange(cfg: CalendarConfig, min: number, max: number): SeasonBand[] {
  const months = cfg.bundles?.months;
  if (!months) return [];
  const yearLen = approxYearLength(cfg) ?? 1;
  if ((max - min) / yearLen > 24) return [];
  const monthCount = months.names.length;
  const out: SeasonBand[] = [];
  const yLo = absoluteYear(cfg, Math.floor(min));
  const yHi = absoluteYear(cfg, Math.ceil(max));
  for (let y = yLo; y <= yHi; y++) {
    for (const m of monthStartSteps(cfg, y)) {
      const lo = Math.max(m.step, min);
      const hi = Math.min(m.step + months.lengths[m.month - 1], max);
      if (lo >= hi) continue;
      out.push({ lo, hi, frac: (m.month - 0.5) / monthCount, intercalary: false, name: m.name });
    }
    for (const run of intercalaryRuns(cfg, y)) {
      const lo = Math.max(run.lo, min);
      const hi = Math.min(run.hi, max);
      if (lo >= hi) continue;
      out.push({ lo, hi, frac: 0, intercalary: true, name: run.name });
    }
  }
  return out;
}

/** True when a step sits inside no era's domain (the axis dims these). */
export function inEraGap(cfg: CalendarConfig, step: number): boolean {
  if (!cfg.eras || cfg.eras.length === 0) return false;
  return eraForStep(cfg, step) === null;
}
