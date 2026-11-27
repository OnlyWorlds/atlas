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
import { readCalendarConfig, speakingCalendar, type CalendarConfig } from '@onlyworlds/sdk';
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
 * Resolve an active-lens id against the live elements. Null id, dangling id,
 * or an invalid config (a calendar past the profile's size bounds included,
 * which the SDK's reader refuses) all resolve to null = bare numbers.
 */
export function resolveCalendarLens(
  elements: Element[],
  activeId: string | null | undefined,
  opts?:
    | { fallbackToOnly?: false }
    | {
      /**
       * When no lens has EVER been chosen on this device, speak the calendar
       * the World itself names (the calendar profile, "Which calendar
       * speaks", by the SDK's `speakingCalendar`): the element its
       * `x_calendar` names, or, when it names none, the world's only
       * calendar. A user who mints a calendar has said what their world's
       * dates mean, and answering them with bare numbers until they also
       * pick it from a menu is a worse default than simply using it.
       *
       * Deliberately keyed on `undefined` (never chosen), not on falsiness:
       * `null` is an explicit "no calendar" from the menu and must survive, or
       * the choice would be un-makeable while one calendar exists. A person's
       * own pick wins over the World's, as the profile allows.
       *
       * Opt-in, because the saved-chart restore path resolves a chart's OWN
       * stored `calendarId`: a chart saved with no lens should reopen with no
       * lens, not silently adopt one that was minted afterwards.
       */
      fallbackToOnly: true;
      /**
       * The World's keys (`world.json`, the active world's meta), so its
       * `x_calendar` is read. Required with the fallback, so no caller can
       * forget it; null or undefined when no World is known (it then names
       * none).
       */
      world: object | null | undefined;
    },
): WorldCalendar | null {
  if (activeId === undefined && opts?.fallbackToOnly) {
    const world = opts.world && typeof opts.world === 'object' && !Array.isArray(opts.world) ? opts.world : {};
    const spoken = speakingCalendar(world, elements as unknown as Parameters<typeof speakingCalendar>[1]);
    return spoken ? worldCalendars(elements).find(c => c.id === spoken.id) ?? null : null;
  }
  if (!activeId) return null;
  return worldCalendars(elements).find(c => c.id === activeId) ?? null;
}
