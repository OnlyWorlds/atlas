/**
 * Calendar kernel — pure arithmetic, formatting, and parsing over the world's
 * integer time line.
 *
 * Contract: Forge/Notes/2026-07-14-calendar-design-final.md §5 + §5b (3-lens
 * gated 2026-07-14). The binding rules, restated where they bite:
 *
 * - The number line is the only truth. A calendar names it; it never owns it.
 * - Absolute year index is ZERO-based: step 0 opens absolute year 0. All
 *   division is Euclidean floor (negatives depend on it).
 * - format(step) is total and O(config) — it never walks history.
 * - Intercalary days belong to no month and render via `format_intercalary`.
 * - A KNOWN token with no applicable value renders empty (with separator
 *   collapse); an UNKNOWN token renders literally.
 * - parse() matches calendar words case-insensitively; bare numbers are ALWAYS
 *   the raw stored step. Guaranteed property: format(parse(format(n))) ===
 *   format(n). Exact integer recovery is NOT promised under lossy formats.
 *
 * Everything here is pure. No atlas imports beyond nothing — this module is
 * consumed by the charts room, popovers, and (via freeze) the publish path.
 */

// ---- Config shape (persisted in the `atlas_calendar` element field) ----

export interface CalendarEra {
  name: string;
  abbrev?: string;
  /** Up-era: domain start (inclusive). Down-era: the PIVOT (exclusive upper bound). */
  start: number;
  /** Up-era: domain end (exclusive); defaults to the next era's start. Down-era: lower bound (inclusive); defaults to -infinity. */
  end?: number;
  /** true (default): years number from `start`. false: pure label, {year} shows the absolute year index. */
  restart?: boolean;
  /** First year number of a restart era: 0 or 1 (default 1). */
  year_base?: 0 | 1;
  /** 'up' (default) or 'down' (BC / Dune B.G. — counts toward the pivot). */
  direction?: 'up' | 'down';
  /** Closed eras format old dates but are never offered at date entry. */
  closed?: boolean;
}

export interface CalendarMonths {
  names: string[];
  /** Same length as names. */
  lengths: number[];
}

export interface CalendarWeek {
  length: number;
  names: string[];
  /** 'free' (default): runs across month boundaries, anchor step 0 = names[0].
   *  'nested': weekday = (day_of_month - 1) mod length; ragged final week legal. */
  mode?: 'free' | 'nested';
}

export interface CalendarIntercalary {
  name: string;
  /** 0 = before month 1; k = after month k. Requires months. */
  after_month: number;
  /** Present only in years where floorMod(absYear, N) === 0 (the leap rule). */
  every_years?: number;
  /** Counts in the free-running week (default true). The Shire lock = opting
   *  exactly Mid-year's Day + Overlithe out (364 = 52 × 7). */
  in_week?: boolean;
}

export interface CalendarConfig {
  version: number;
  /** Immutable sentinel: the world's time_basic_unit at creation. Machinery only. */
  grain: string;
  /** The culture's display word for one step ("Sol"). Defaults to grain. */
  step_name?: string;
  eras?: CalendarEra[];
  bundles?: {
    /** Coarse-calendar year length. Legal ONLY when months are absent. */
    year?: { steps: number };
    months?: CalendarMonths;
    week?: CalendarWeek;
  };
  intercalary?: CalendarIntercalary[];
  /** Regular-day template. Tokens: {day} {month} {weekday} {year} {era} {step}. */
  format?: string;
  /** Intercalary-day template; may also use {intercalary}. */
  format_intercalary?: string;
}

/** A step, taken apart. Fields are null when the structure doesn't exist. */
export interface StepBreakdown {
  step: number;
  /** Absolute year index (zero-based from step 0). */
  absYear: number;
  /** The era-local display year (restart arithmetic applied), or absYear when no era / restart:false. */
  year: number;
  era: CalendarEra | null;
  /** 1-based month index, or null (intercalary day / no months). */
  month: number | null;
  monthName: string | null;
  /** 1-based day within the month, or null. */
  day: number | null;
  /** Intercalary day name when the step IS one, else null. */
  intercalary: string | null;
  weekday: string | null;
}

export interface ParseResult {
  step: number;
}

export interface ParseError {
  error: string;
}

// ---- Euclidean division (the contract's floor semantics) ----

export function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

export function floorMod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

// ---- Validation (the builder rejects loudly; wild configs fall back) ----

export function validateCalendarConfig(cfg: CalendarConfig): string[] {
  const errors: string[] = [];
  if (cfg.version !== 1) errors.push(`Unsupported calendar version: ${cfg.version}`);
  if (!cfg.grain || typeof cfg.grain !== 'string') errors.push('Grain is required');

  const months = cfg.bundles?.months;
  if (months) {
    if (!Array.isArray(months.names) || !Array.isArray(months.lengths)
      || months.names.length === 0 || months.names.length !== months.lengths.length) {
      errors.push('months.names and months.lengths must be same-length non-empty arrays');
    } else if (months.lengths.some((l) => !Number.isInteger(l) || l < 1)) {
      errors.push('Every month length must be a whole number, 1 or more');
    }
    if (cfg.bundles?.year) errors.push('year.steps is legal only when no months are defined (year length is derived from months)');
  } else if (cfg.bundles?.year) {
    if (!Number.isInteger(cfg.bundles.year.steps) || cfg.bundles.year.steps < 1) {
      errors.push('year.steps must be a positive integer');
    }
  }

  const week = cfg.bundles?.week;
  if (week) {
    if (!Number.isInteger(week.length) || week.length < 1) errors.push('The week length must be a whole number, 1 or more');
    else if (!Array.isArray(week.names) || week.names.length !== week.length) errors.push('Give the week as many day names as its length');
  }

  const inter = cfg.intercalary ?? [];
  if (inter.length > 0 && !months) errors.push('Festival days need months');
  const monthCount = months?.names.length ?? 0;
  for (const ic of inter) {
    if (!Number.isInteger(ic.after_month) || ic.after_month < 0 || ic.after_month > monthCount) {
      errors.push(`Festival day "${ic.name}": pick the month it follows`);
    }
    if (ic.every_years != null && (!Number.isInteger(ic.every_years) || ic.every_years < 1)) {
      errors.push(`Festival day "${ic.name}": every N yrs must be a whole number, 1 or more`);
    }
  }

  const eras = cfg.eras ?? [];
  for (const era of eras) {
    if (!era.name) errors.push('Every era needs a name');
    if (!Number.isFinite(era.start)) errors.push(`Era "${era.name}": start must be a number`);
    if (era.end != null && !Number.isFinite(era.end)) errors.push(`Era "${era.name}": end must be a number`);
    if ((era.direction ?? 'up') === 'up' && era.end != null && era.end <= era.start) {
      errors.push(`Era "${era.name}": end must be after start`);
    }
    if ((era.direction ?? 'up') === 'down' && era.end != null && era.end >= era.start) {
      errors.push(`Era "${era.name}": a counting-down era must end below its start`);
    }
  }
  // Overlap check over resolved domains.
  const domains = resolveEraDomains(eras);
  for (let i = 0; i < domains.length; i++) {
    for (let j = i + 1; j < domains.length; j++) {
      const a = domains[i]; const b = domains[j];
      if (a.lo < b.hi && b.lo < a.hi) {
        errors.push(`Eras "${a.era.name}" and "${b.era.name}" overlap`);
      }
    }
  }
  return errors;
}

/**
 * Defensive reader for wild configs (hand-edited files, other tools). Returns
 * null when the value is not a structurally usable calendar — callers fall
 * back to bare numbers, never a broken axis.
 */
export function readCalendarConfig(value: unknown): CalendarConfig | null {
  if (typeof value !== 'object' || value === null) return null;
  const cfg = value as CalendarConfig;
  if (cfg.version !== 1 || typeof cfg.grain !== 'string') return null;
  // Structural sanity only — validateCalendarConfig covers semantics. A config
  // with semantic errors (overlaps) still formats via deterministic fallbacks.
  const months = cfg.bundles?.months;
  if (months && (!Array.isArray(months.names) || !Array.isArray(months.lengths)
    || months.names.length !== months.lengths.length || months.names.length === 0)) return null;
  if (cfg.eras && !Array.isArray(cfg.eras)) return null;
  if (cfg.eras?.some((e) => typeof e?.name !== 'string' || !Number.isFinite(e?.start))) return null;
  if (cfg.intercalary && (!Array.isArray(cfg.intercalary)
    || cfg.intercalary.some((i) => typeof i?.name !== 'string' || !Number.isInteger(i?.after_month)))) return null;
  // S367 critic K1: every divisor and step size must be a positive integer, or
  // the year arithmetic can loop forever. Values, not just shapes.
  if (months && !months.lengths.every(isPositiveInt)) return null;
  const year = cfg.bundles?.year;
  if (year != null && !isPositiveInt(year.steps)) return null;
  const week = cfg.bundles?.week;
  if (week != null && (!isPositiveInt(week.length) || !Array.isArray(week.names))) return null;
  if (cfg.intercalary?.some((i) => i.every_years != null && !isPositiveInt(i.every_years))) return null;
  return cfg;
}

function isPositiveInt(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) >= 1;
}

// ---- Year arithmetic ----

interface YearShape {
  /** Base year length: months + non-leap intercalary (or year.steps, or 1). */
  baseLen: number;
  /** Leap entries: every_years periods (one extra step each in leap years). */
  leapPeriods: number[];
}

function yearShape(cfg: CalendarConfig): YearShape {
  const months = cfg.bundles?.months;
  const inter = cfg.intercalary ?? [];
  const leapPeriods = inter.filter((i) => i.every_years != null).map((i) => i.every_years as number);
  if (months) {
    const base = months.lengths.reduce((a, b) => a + b, 0)
      + inter.filter((i) => i.every_years == null).length;
    return { baseLen: base, leapPeriods };
  }
  return { baseLen: cfg.bundles?.year?.steps ?? 1, leapPeriods };
}

/** Signed count of leap years k (floorMod(k, N) === 0) with 0 <= k < y, minus those with y <= k < 0. */
function leapYearsBefore(y: number, N: number): number {
  if (y > 0) return floorDiv(y - 1, N) + 1; // k = 0, N, 2N, ... < y
  if (y === 0) return 0;
  return -floorDiv(-y, N); // k = -N, -2N, ... >= y (year 0 itself is not in [y, 0))
}

/** True when absolute year y contains the leap entry with period N. */
export function isLeapYear(y: number, N: number): boolean {
  return floorMod(y, N) === 0;
}

/** First step of absolute year y. yearStart(0) === 0 by construction. */
export function yearStartStep(cfg: CalendarConfig, y: number): number {
  const shape = yearShape(cfg);
  let start = y * shape.baseLen;
  for (const N of shape.leapPeriods) start += leapYearsBefore(y, N);
  return start;
}

/** Length in steps of absolute year y. */
export function yearLength(cfg: CalendarConfig, y: number): number {
  const shape = yearShape(cfg);
  let len = shape.baseLen;
  for (const N of shape.leapPeriods) if (isLeapYear(y, N)) len += 1;
  return len;
}

/** Correction laps allowed per direction. A valid config needs about
 *  (leap periods + 2); the cap only stops a malformed one from hanging. */
const MAX_YEAR_CORRECTION = 10_000;

/** Absolute year index of a step. Zero-based; closed-form seed + bounded correction. */
export function absoluteYear(cfg: CalendarConfig, step: number): number {
  const shape = yearShape(cfg);
  // Seed on the MEAN year length (leap days included) so the correction stays
  // a few laps at any distance from zero (S367 critic K1).
  const meanLen = shape.leapPeriods.reduce((a, N) => a + 1 / N, shape.baseLen);
  let y = floorDiv(step, meanLen);
  if (!Number.isFinite(y)) return y; // non-finite step or zero-length year: nothing to correct
  // Bounded laps (S367 critic K1): a config that slips the reader must not hang.
  for (let i = 0; i < MAX_YEAR_CORRECTION && step < yearStartStep(cfg, y); i++) y -= 1;
  for (let i = 0; i < MAX_YEAR_CORRECTION && step >= yearStartStep(cfg, y + 1); i++) y += 1;
  return y;
}

// ---- Era arithmetic ----

export interface EraDomain {
  era: CalendarEra;
  lo: number; // inclusive
  hi: number; // exclusive
}

export function resolveEraDomains(eras: CalendarEra[]): EraDomain[] {
  const sorted = [...eras].sort((a, b) => a.start - b.start);
  const out: EraDomain[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const era = sorted[i];
    if ((era.direction ?? 'up') === 'down') {
      // Domain [end-or--inf, start): counts toward the pivot; pivot belongs to the next (up) era.
      out.push({ era, lo: era.end ?? -Infinity, hi: era.start });
    } else {
      const nextStart = sorted[i + 1]?.start;
      out.push({ era, lo: era.start, hi: era.end ?? nextStart ?? Infinity });
    }
  }
  return out;
}

/** The era owning a step: domain containment; wild overlaps resolve to latest start (up wins ties). */
export function eraForStep(cfg: CalendarConfig, step: number): CalendarEra | null {
  const eras = cfg.eras ?? [];
  if (eras.length === 0) return null;
  const holding = resolveEraDomains(eras).filter((d) => step >= d.lo && step < d.hi);
  if (holding.length === 0) return null;
  holding.sort((a, b) => (b.era.start - a.era.start)
    || ((a.era.direction ?? 'up') === 'up' ? -1 : 1));
  return holding[0].era;
}

/** The display year for a step under an era (or the absolute year without one). */
export function displayYear(cfg: CalendarConfig, step: number, era: CalendarEra | null): number {
  const abs = absoluteYear(cfg, step);
  if (!era || era.restart === false) return abs;
  const base = era.year_base ?? 1;
  if ((era.direction ?? 'up') === 'down') {
    // Step -1 with pivot 0 and base 1 => year 1 (no year zero on the down side).
    return absoluteYear(cfg, era.start) - abs + base - 1;
  }
  return abs - absoluteYear(cfg, era.start) + base;
}

// ---- The year's day sequence (months + intercalary interleave) ----

interface DaySlot {
  kind: 'month' | 'intercalary';
  month?: number;     // 1-based, kind 'month'
  day?: number;       // 1-based within month
  intercalary?: CalendarIntercalary;
}

/** The slots of absolute year y, in step order. O(config). */
function yearSlots(cfg: CalendarConfig, y: number): DaySlot[] {
  const months = cfg.bundles?.months;
  if (!months) return [];
  const inter = cfg.intercalary ?? [];
  const active = (ic: CalendarIntercalary): boolean =>
    ic.every_years == null || isLeapYear(y, ic.every_years);
  const slots: DaySlot[] = [];
  const push = (afterMonth: number): void => {
    for (const ic of inter) if (ic.after_month === afterMonth && active(ic)) slots.push({ kind: 'intercalary', intercalary: ic });
  };
  push(0);
  for (let m = 1; m <= months.names.length; m++) {
    for (let d = 1; d <= months.lengths[m - 1]; d++) slots.push({ kind: 'month', month: m, day: d });
    push(m);
  }
  return slots;
}

// ---- Weekday ----

function skippedWeekDaysPerYear(cfg: CalendarConfig): { base: number; leapPeriods: number[] } {
  const inter = (cfg.intercalary ?? []).filter((i) => i.in_week === false);
  return {
    base: inter.filter((i) => i.every_years == null).length,
    leapPeriods: inter.filter((i) => i.every_years != null).map((i) => i.every_years as number),
  };
}

/** Weekday name for a step, or null (no week / nested outside months / skipped intercalary day). */
export function weekdayForStep(cfg: CalendarConfig, step: number, pre?: StepPosition): string | null {
  const week = cfg.bundles?.week;
  if (!week || week.length < 1 || week.names.length !== week.length) return null;
  const pos = pre ?? positionOf(cfg, step);
  if ((week.mode ?? 'free') === 'nested') {
    if (pos.slot?.kind !== 'month') return null;
    return week.names[floorMod((pos.slot.day as number) - 1, week.length)];
  }
  // Free mode: counted steps exclude in_week:false intercalary days. Anchor: counted 0 -> names[0].
  if (pos.slot?.kind === 'intercalary' && pos.slot.intercalary?.in_week === false) return null;
  const skipped = skippedWeekDaysPerYear(cfg);
  const y = pos.absYear;
  let skippedBeforeYear = y * skipped.base;
  for (const N of skipped.leapPeriods) skippedBeforeYear += leapYearsBefore(y, N);
  let skippedInYear = 0;
  if (pos.slots) {
    for (let i = 0; i < pos.offset; i++) {
      const s = pos.slots[i];
      if (s.kind === 'intercalary' && s.intercalary?.in_week === false) skippedInYear += 1;
    }
  }
  const counted = step - skippedBeforeYear - skippedInYear;
  return week.names[floorMod(counted, week.length)];
}

// ---- Breakdown + format ----

interface StepPosition {
  absYear: number;
  offset: number;           // steps into the year
  slot: DaySlot | null;     // null when no months
  slots: DaySlot[] | null;
}

function positionOf(cfg: CalendarConfig, step: number): StepPosition {
  const y = absoluteYear(cfg, step);
  const offset = step - yearStartStep(cfg, y);
  if (!cfg.bundles?.months) return { absYear: y, offset, slot: null, slots: null };
  const slots = yearSlots(cfg, y);
  return { absYear: y, offset, slot: slots[offset] ?? null, slots };
}

export function breakdownStep(cfg: CalendarConfig, step: number): StepBreakdown {
  const pos = positionOf(cfg, step);
  const era = eraForStep(cfg, step);
  const months = cfg.bundles?.months;
  const slot = pos.slot;
  return {
    step,
    absYear: pos.absYear,
    year: displayYear(cfg, step, era),
    era,
    month: slot?.kind === 'month' ? (slot.month as number) : null,
    monthName: slot?.kind === 'month' && months ? months.names[(slot.month as number) - 1] : null,
    day: slot?.kind === 'month' ? (slot.day as number) : null,
    intercalary: slot?.kind === 'intercalary' ? (slot.intercalary as CalendarIntercalary).name : null,
    weekday: weekdayForStep(cfg, step, pos),
  };
}

const KNOWN_TOKENS = ['day', 'month', 'weekday', 'year', 'era', 'step', 'intercalary'] as const;

const DEFAULT_FORMAT_MONTHS = '{day} {month}, {year} {era}';
const DEFAULT_FORMAT_PLAIN = '{year} {era}';
const DEFAULT_FORMAT_INTERCALARY = '{intercalary}, {year} {era}';

/**
 * Substitute + collapse. KNOWN tokens with no value render empty and adjacent
 * separators collapse; UNKNOWN tokens render literally (visible, never
 * swallowed).
 */
/**
 * Placeholder for a KNOWN token that resolved to nothing, so the collapse pass
 * can find and absorb it along with any separators hugging it.
 *
 * U+E000 is a private-use code point, deliberately NOT a raw NUL. A NUL byte
 * makes ripgrep classify this entire file as BINARY, so every content search
 * over it silently returns no matches — while `--count` still returns a
 * plausible number, which is worse than an obvious failure. 704 lines of
 * calendar logic were invisible to search until this changed. Whatever this
 * sentinel becomes, it must never be NUL.
 */
const EMPTY_KNOWN = '\uE000';

function renderTemplate(template: string, values: Record<string, string | null>): string {
  let out = template.replace(/\{([a-z_]+)\}/g, (whole, token: string) => {
    if (!(KNOWN_TOKENS as readonly string[]).includes(token)) return whole; // unknown: literal
    const v = values[token];
    return v == null || v === '' ? EMPTY_KNOWN : v;
  });
  // Collapse around empty-known markers: absorb adjacent separators/spaces.
  out = out
    .replace(/\s*[,;·]?\s*\uE000\s*[,;·]?\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[\s,;·]+|[\s,;·]+$/g, '');
  return out;
}

/** Format a step. Total: every integer formats to a string under every readable config. */
export function formatStep(cfg: CalendarConfig, step: number): string {
  const b = breakdownStep(cfg, step);
  const values: Record<string, string | null> = {
    day: b.day != null ? String(b.day) : null,
    month: b.monthName,
    weekday: b.weekday,
    year: String(b.year),
    era: b.era ? (b.era.abbrev ?? b.era.name) : null,
    step: String(step),
    intercalary: b.intercalary,
  };
  const template = b.intercalary != null
    ? (cfg.format_intercalary ?? DEFAULT_FORMAT_INTERCALARY)
    : (cfg.format ?? (cfg.bundles?.months ? DEFAULT_FORMAT_MONTHS : DEFAULT_FORMAT_PLAIN));
  return renderTemplate(template, values);
}

/**
 * Compact year-level label: "{year} {era-abbrev}" — the axis-tick wording when
 * zoomed wide (full formatStep at tick density would be a wall of month names).
 * Outside every era: the absolute year index alone.
 */
export function formatYearLabel(cfg: CalendarConfig, step: number): string {
  const era = eraForStep(cfg, step);
  const year = displayYear(cfg, step, era);
  const eraLabel = era ? (era.abbrev ?? era.name) : '';
  return eraLabel ? `${year} ${eraLabel}` : String(year);
}

/**
 * The base year length in steps (leap days excluded), or null when the
 * calendar has no year structure above the step. Consumers use it as a
 * zoom threshold (ticks tighter than a year → full dates, else year labels).
 */
export function approxYearLength(cfg: CalendarConfig): number | null {
  if (cfg.bundles?.months) {
    return cfg.bundles.months.lengths.reduce((a, b) => a + b, 0)
      + (cfg.intercalary ?? []).filter(i => i.every_years == null).length;
  }
  return cfg.bundles?.year?.steps ?? null;
}

/**
 * A duration in steps, spoken: "19 years" when the calendar has year
 * structure and the span reaches it, else "12 days" in the step word. Uses
 * the BASE year length (leap days are noise at duration granularity); one
 * decimal below 10 years, whole above. Pure.
 */
export function formatDuration(cfg: CalendarConfig, steps: number): string {
  const n = Math.abs(steps);
  const unit = (cfg.step_name ?? cfg.grain ?? 'step').trim() || 'step';
  const plural = (word: string, v: number): string => (v === 1 ? word : `${word}s`);
  const yearLen = cfg.bundles?.months
    ? cfg.bundles.months.lengths.reduce((a, b) => a + b, 0)
      + (cfg.intercalary ?? []).filter(i => i.every_years == null).length
    : cfg.bundles?.year?.steps ?? (unit.toLowerCase() === 'year' ? 1 : null);
  if (yearLen != null && yearLen > 1 && n >= yearLen) {
    const years = n / yearLen;
    const rounded = years >= 10 ? Math.round(years) : Math.round(years * 10) / 10;
    return `${rounded} ${plural('year', rounded)}`;
  }
  const shown = Math.round(n * 100) / 100;
  return `${shown} ${plural(unit, shown)}`;
}

/**
 * The first step of each month in absolute year y, in order. O(config) — walks
 * month lengths + intercalary placement, never the year's days. Empty when the
 * calendar has no months.
 */
export function monthStartSteps(cfg: CalendarConfig, y: number): { month: number; name: string; step: number }[] {
  const months = cfg.bundles?.months;
  if (!months) return [];
  const inter = cfg.intercalary ?? [];
  const active = (ic: CalendarIntercalary): boolean =>
    ic.every_years == null || isLeapYear(y, ic.every_years);
  const out: { month: number; name: string; step: number }[] = [];
  let offset = inter.filter((i) => i.after_month === 0 && active(i)).length;
  const start = yearStartStep(cfg, y);
  for (let m = 1; m <= months.names.length; m++) {
    out.push({ month: m, name: months.names[m - 1], step: start + offset });
    offset += months.lengths[m - 1] + inter.filter((i) => i.after_month === m && active(i)).length;
  }
  return out;
}

/**
 * Mid-rung label for dense axis ticks: "11 Greening 454" — day, month, display
 * year, NO era word (the era bands carry the era; a label wall repeating "FT"
 * is noise). Intercalary steps read "Hearthmoot 454". Monthless calendars fall
 * back to the year label.
 */
export function formatMidLabel(cfg: CalendarConfig, step: number): string {
  const b = breakdownStep(cfg, step);
  if (b.intercalary != null) return `${b.intercalary} ${b.year}`;
  if (b.monthName != null && b.day != null) return `${b.day} ${b.monthName} ${b.year}`;
  return formatYearLabel(cfg, step);
}

// ---- Parse ----

export interface ParseOptions {
  /** The world's now (used to default a missing year, per contract rule 9). */
  now?: number | null;
}

interface EraMatch { era: CalendarEra; }

function findEra(cfg: CalendarConfig, word: string): EraMatch | null {
  const lower = word.toLowerCase();
  for (const era of cfg.eras ?? []) {
    if (era.abbrev && era.abbrev.toLowerCase() === lower) return { era };
    if (era.name.toLowerCase() === lower) return { era };
  }
  return null;
}

/** Absolute year for an era-local display year (inverse of displayYear). */
export function absYearForEraYear(cfg: CalendarConfig, era: CalendarEra, Y: number): number {
  if (era.restart === false) return Y;
  const base = era.year_base ?? 1;
  if ((era.direction ?? 'up') === 'down') return absoluteYear(cfg, era.start) - (Y - base + 1);
  return absoluteYear(cfg, era.start) + (Y - base);
}

/** Preferred era when the input names none: the era holding the now, else the latest-started open era, else the latest-started. */
function defaultEra(cfg: CalendarConfig, now: number | null | undefined): CalendarEra | null {
  const eras = cfg.eras ?? [];
  if (eras.length === 0) return null;
  if (now != null) {
    const holder = eraForStep(cfg, now);
    if (holder) return holder;
  }
  const open = eras.filter((e) => !e.closed);
  const pool = open.length > 0 ? open : eras;
  return [...pool].sort((a, b) => b.start - a.start)[0];
}

/**
 * Parse a written date to a step.
 *
 * Accepted shapes (calendar words case-insensitive):
 *   "-454" / "454"                      -> the raw stored step, always
 *   "454 AE" / "Year 12 FT"             -> year (+ era)
 *   "Frostwane 454" / "12 Frostwane 454" (+ era)
 *   "Shieldmeet 1372" (+ era)           -> intercalary day
 *   "Frostwane 12" (no year)            -> resolved against the now's year
 * Partial dates snap to the period's first step. Missing year with no now =
 * error (never guess). p(f(n)) == n is NOT promised; f(p(f(n))) == f(n) is.
 */
export function parseDate(cfg: CalendarConfig, input: string, opts: ParseOptions = {}): ParseResult | ParseError {
  const raw = input.trim();
  if (raw === '') return { error: 'empty date' };

  // Bare number = the raw stored step, always (contract rule 9).
  if (/^-?\d+$/.test(raw)) return { step: parseInt(raw, 10) };

  // Normalize input AND candidate keys identically (case-insensitive matching,
  // punctuation-tolerant: "S.R." must match "s r", "B.G." must match "b g").
  const normalize = (s: string): string =>
    ` ${s.toLowerCase().replace(/[,.]/g, ' ').replace(/\s+/g, ' ').trim()} `;

  const months = cfg.bundles?.months;
  const inter = cfg.intercalary ?? [];

  let era: CalendarEra | null = null;
  let monthIndex: number | null = null;
  let intercalary: CalendarIntercalary | null = null;
  // Eat NAMES from the normalized string BEFORE extracting numbers — some
  // calendar names legitimately contain digits ("2 Yule").
  let rest = normalize(raw).replace(/ year /g, ' ');

  const eat = (name: string): boolean => {
    const needle = normalize(name);
    if (rest.includes(needle)) { rest = rest.replace(needle, ' '); return true; }
    return false;
  };

  // Eras first (longest names first so "After Empire" beats "Empire").
  const eraCandidates = [...(cfg.eras ?? [])]
    .flatMap((e) => [{ key: e.name, e }, ...(e.abbrev ? [{ key: e.abbrev, e }] : [])])
    .sort((a, b) => b.key.length - a.key.length);
  for (const c of eraCandidates) if (eat(c.key)) { era = c.e; break; }

  const interCandidates = [...inter].sort((a, b) => b.name.length - a.name.length);
  for (const c of interCandidates) if (eat(c.name)) { intercalary = c; break; }

  if (!intercalary && months) {
    for (let m = 1; m <= months.names.length; m++) {
      if (eat(months.names[m - 1])) { monthIndex = m; break; }
    }
  }

  // What remains must be numbers only.
  const numbers: number[] = [];
  for (const p of rest.trim().split(/\s+/).filter(Boolean)) {
    if (/^-?\d+$/.test(p)) numbers.push(parseInt(p, 10));
    else return { error: `unrecognized: "${p}"` };
  }

  // Distribute numbers: with a month, [day?, year?]; with an intercalary, [year?]; else [year].
  let day: number | null = null;
  let year: number | null = null;
  if (monthIndex != null) {
    if (numbers.length === 2) {
      // Day-first and day-second both occur ("12 Frostwane 454" / "Frostwane 12, 454"):
      // the day is the one that fits the month; ties resolve day-first.
      const len = months ? months.lengths[monthIndex - 1] : 0;
      const [a, b] = numbers;
      if (a >= 1 && a <= len) { day = a; year = b; }
      else if (b >= 1 && b <= len) { day = b; year = a; }
      else return { error: `no day in ${months?.names[monthIndex - 1]} matches ${a}/${b}` };
    } else if (numbers.length === 1) {
      const len = months ? months.lengths[monthIndex - 1] : 0;
      const n = numbers[0];
      // One number beside a month: a plausible day resolves against the now's
      // year; otherwise it is the year (snap to the month's first day).
      if (n >= 1 && n <= len) { day = n; year = null; } else { year = n; }
    } else if (numbers.length !== 0) {
      return { error: 'too many numbers' };
    }
  } else if (intercalary != null) {
    if (numbers.length > 1) return { error: 'too many numbers' };
    year = numbers[0] ?? null;
  } else {
    if (numbers.length !== 1) return { error: 'expected a year' };
    year = numbers[0];
  }

  // Resolve to a step for a given absolute year.
  const resolveInYear = (abs: number): ParseResult | ParseError => {
    const start = yearStartStep(cfg, abs);
    if (monthIndex == null && intercalary == null) return { step: start };
    const slots = yearSlots(cfg, abs);
    if (intercalary != null) {
      const idx = slots.findIndex((s) => s.kind === 'intercalary' && s.intercalary === intercalary);
      if (idx === -1) return { error: `${intercalary.name} does not occur in that year` };
      return { step: start + idx };
    }
    const idx = slots.findIndex((s) => s.kind === 'month' && s.month === monthIndex && s.day === (day ?? 1));
    if (idx === -1) return { error: 'that day does not exist in that month' };
    return { step: start + idx };
  };

  if (year == null) {
    if (opts.now == null) return { error: 'add a year (the world clock has no now set)' };
    return resolveInYear(absoluteYear(cfg, opts.now));
  }

  const target = era ?? defaultEra(cfg, opts.now);
  if (!target) return resolveInYear(year);

  // Era arithmetic first; if the resulting step falls OUTSIDE the era's own
  // domain (e.g. "S.R. -10" — format shows absolute years outside era
  // domains, often under a literal era word in the template), fall back to
  // the absolute-year reading so format(parse(format(n))) stays stable.
  const viaEra = resolveInYear(absYearForEraYear(cfg, target, year));
  if (isParseError(viaEra)) return viaEra;
  if (eraForStep(cfg, viaEra.step) === target) return viaEra;
  return resolveInYear(year);
}

export function isParseError(r: ParseResult | ParseError): r is ParseError {
  return (r as ParseError).error !== undefined;
}
