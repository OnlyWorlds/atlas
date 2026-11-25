/**
 * Calendar lens resolution — which calendars a world HAS and which one the
 * charts room currently speaks.
 *
 * Detection keys on `atlas_calendar` FIELD PRESENCE, never the supertype
 * (design §4): users hand-mint Constructs with arbitrary
 * supertypes, and a lore-only "Calendar" Construct must never surface as a
 * broken lens. Supertype `calendar` is convention and display only.
 *
 * Everything degrades to bare numbers: dangling active id, deleted construct,
 * malformed config — never an error, never a broken axis (design §8).
 */

import type { Element } from './types';
import { readCalendarConfig, type CalendarConfig } from '@onlyworlds/sdk';
import { nameOrUnnamed, ownName } from './type-words';

/** The calendar room's own word for its Construct: a calendar with no name is "the unnamed calendar". */
export const CALENDAR_WORD = 'calendar';

export const CALENDAR_SUPERTYPE = 'calendar';

export interface WorldCalendar {
  /** The calendar Construct's element id (the lens reference everywhere). */
  id: string;
  /** The element's name, the calendar's display name ("The unnamed construct" when it has none). */
  name: string;
  /** True when the element has no name: `name` then holds the unnamed form, for `nameOrUnnamed` mid-sentence. */
  unnamed?: boolean;
  /** The element's type and supertype, so its unnamed form is said in the world's own words. */
  type: string;
  supertype?: unknown;
  config: CalendarConfig;
}

/**
 * The tolerant `atlas_calendar` read: object OR JSON string (foreign tools may
 * serialize; we read both, write objects). Null for anything unusable. EVERY
 * consumer of the field goes through this — a reader that only accepts objects
 * would silently blank a string-config calendar (the paired-readers trap).
 */
export function readCalendarValue(raw: unknown): CalendarConfig | null {
  if (raw == null) return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try { value = JSON.parse(raw); } catch { return null; }
  }
  return readCalendarConfig(value);
}

/**
 * Every usable calendar in the world: elements carrying a structurally valid
 * `atlas_calendar`. Malformed configs are skipped silently — a broken calendar
 * is invisible, not a broken room.
 */
export function worldCalendars(elements: Element[]): WorldCalendar[] {
  const out: WorldCalendar[] = [];
  for (const el of elements) {
    const config = readCalendarValue((el as Record<string, unknown>)['atlas_calendar']);
    if (!config) continue;
    out.push({ id: el.id, name: nameOrUnnamed(el, { start: true, word: CALENDAR_WORD }), unnamed: !ownName(el) || undefined, type: el.type, supertype: el.supertype, config });
  }
  return out;
}

/**
 * How much a calendar may hold before Atlas stops wording dates by it. A world
 * file is anyone's, and the SDK's `formatStep` costs more with each era,
 * month, extra day and template character: the timeline words one date per
 * event, so a calendar with tens of thousands of eras cost a visitor's tab
 * seconds to minutes (SDK 4.203.1: 15,000 eras 40 ms a label, 150,000 eras
 * 39 s). At these bounds, every count at its line at once, a label costs
 * under 2 ms (an ordinary calendar about 0.25 ms). Looser than the bounds the
 * server keeps for its own pages, until one bound for every tool lives in
 * the standard.
 */
export const CALENDAR_BOUNDS = Object.freeze({
  eras: 256,
  months: 256,
  intercalary: 64,
  except: 8,
  weekdays: 256,
  template: 1000,
  name: 1000,
});

/** What a calendar holds past {@link CALENDAR_BOUNDS}, in words, with the bound it passed. */
export interface CalendarTooCostly {
  /** "eras", "months", "extra days", … as a sentence says it: "more than 256 eras". */
  what: string;
  bound: number;
}

/**
 * The first count of `cfg` past {@link CALENDAR_BOUNDS}, or null when Atlas
 * may word its dates. Reads only what `readCalendarConfig` let through.
 */
export function calendarTooCostly(cfg: CalendarConfig): CalendarTooCostly | null {
  const B = CALENDAR_BOUNDS;
  const over = (n: number, bound: number, what: string): CalendarTooCostly | null =>
    n > bound ? { what, bound } : null;
  const longName = (names: ReadonlyArray<string | undefined>): CalendarTooCostly | null =>
    names.some(n => typeof n === 'string' && n.length > B.name) ? { what: 'characters in one name', bound: B.name } : null;
  const eras = cfg.eras ?? [];
  const months = cfg.bundles?.months?.names ?? [];
  const weekdays = cfg.bundles?.week?.names ?? [];
  const extra = cfg.intercalary ?? [];
  return over(eras.length, B.eras, 'eras')
    ?? over(months.length, B.months, 'months')
    ?? over(extra.length, B.intercalary, 'extra days')
    ?? over(extra.reduce((m, e) => Math.max(m, e.except?.length ?? 0), 0), B.except, 'exceptions in one leap rule')
    ?? over(weekdays.length, B.weekdays, 'weekdays')
    ?? over(Math.max(cfg.format?.length ?? 0, cfg.format_intercalary?.length ?? 0), B.template, 'characters in its date pattern')
    ?? longName([cfg.step_name, ...eras.flatMap(e => [e.name, e.abbrev]), ...months, ...weekdays, ...extra.map(e => e.name)]);
}

/**
 * Resolve an active-lens id against the live elements. Null id, dangling id,
 * invalid config, or a calendar past {@link CALENDAR_BOUNDS} all resolve to
 * null = bare numbers.
 */
export function resolveCalendarLens(
  elements: Element[],
  activeId: string | null | undefined,
  opts?: {
    /**
     * When no lens has EVER been chosen and the world holds exactly one
     * calendar, speak it. A user who mints a calendar has said what their
     * world's dates mean, and answering them with bare numbers until they
     * also pick it from a menu is a worse default than simply using it.
     *
     * Deliberately keyed on `undefined` (never chosen), not on falsiness:
     * `null` is an explicit "no calendar" from the menu and must survive, or
     * the choice would be un-makeable while one calendar exists.
     *
     * Opt-in, because the saved-chart restore path resolves a chart's OWN
     * stored `calendarId`: a chart saved with no lens should reopen with no
     * lens, not silently adopt one that was minted afterwards.
     */
    fallbackToOnly?: boolean;
  },
): WorldCalendar | null {
  const wordable = (c: WorldCalendar | undefined): WorldCalendar | null =>
    c && !calendarTooCostly(c.config) ? c : null;
  if (activeId === undefined && opts?.fallbackToOnly) {
    const all = worldCalendars(elements);
    return all.length === 1 ? wordable(all[0]) : null;
  }
  if (!activeId) return null;
  return wordable(worldCalendars(elements).find(c => c.id === activeId));
}
