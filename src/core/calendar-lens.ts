/**
 * Calendar lens resolution — which calendars a world HAS and which one the
 * charts room currently speaks.
 *
 * Detection keys on `atlas_calendar` FIELD PRESENCE, never the supertype
 * (Skeld's swap, design §4): users hand-mint Constructs with arbitrary
 * supertypes, and a lore-only "Calendar" Construct must never surface as a
 * broken lens. Supertype `calendar` is convention and display only.
 *
 * Everything degrades to bare numbers: dangling active id, deleted construct,
 * malformed config — never an error, never a broken axis (design §8).
 */

import type { Element } from './types';
import { readCalendarConfig, type CalendarConfig } from './calendar';

export const CALENDAR_SUPERTYPE = 'calendar';

export interface WorldCalendar {
  /** The calendar Construct's element id (the lens reference everywhere). */
  id: string;
  /** The element's name — the calendar's display name. */
  name: string;
  config: CalendarConfig;
}

/**
 * Every usable calendar in the world: elements carrying a structurally valid
 * `atlas_calendar`. Accepts the config as an object OR a JSON string (foreign
 * tools may serialize; we read both, write objects). Malformed configs are
 * skipped silently — a broken calendar is invisible, not a broken room.
 */
export function worldCalendars(elements: Element[]): WorldCalendar[] {
  const out: WorldCalendar[] = [];
  for (const el of elements) {
    const raw = (el as Record<string, unknown>)['atlas_calendar'];
    if (raw == null) continue;
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw); } catch { continue; }
    }
    const config = readCalendarConfig(value);
    if (!config) continue;
    out.push({ id: el.id, name: el.name || '(unnamed calendar)', config });
  }
  return out;
}

/**
 * Resolve an active-lens id against the live elements. Null id, dangling id,
 * or invalid config all resolve to null = bare numbers.
 */
export function resolveCalendarLens(
  elements: Element[],
  activeId: string | null | undefined,
): WorldCalendar | null {
  if (!activeId) return null;
  return worldCalendars(elements).find(c => c.id === activeId) ?? null;
}
