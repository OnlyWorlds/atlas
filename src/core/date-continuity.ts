/**
 * Date continuity (#281, after Kael's notes on date-continuity checkers):
 * the dates in a world worth a second look. Pure and read-only: Home's loose
 * threads list them as "dates to check", each a statement of both dates,
 * never a verdict; nothing is written.
 *
 * Two kinds cannot both be true. Three are links across a birth: the
 * standard's own words make them possible (an Event's and a Relation's
 * `characters` are "relevant to" it, so a historian born after a war; a
 * Title's `holders` "hold or represent" it, so a pretender to an abolished
 * crown), but far more often they are a typed date gone wrong (a review
 * found the first wording called the possible impossible). On the standard's
 * fields (`keel/schema/*.yaml`):
 *
 *  - reversed (cannot be): a span whose end comes before its start (every
 *    type with a start and an end in `TEMPORAL_TYPE_FIELDS`: an event, a
 *    relation, a title's grant and revoke, a construct, a narrative, a zone).
 *  - cause-after-effect (cannot be): an Event's `triggers` are the events
 *    that precipitated it (the schema's words), so a trigger that starts
 *    after the event it set off.
 *  - born-after-event (to check): a character or creature an Event lists
 *    (`characters`, `creatures`), born once the event was over: at or after
 *    its `end_date` (half-open, as Skeld ruled every dated type, 2026-10-15),
 *    or after its `start_date` when it has no end (a moment). An end that is
 *    there but is not a number (felt text) is unknown: no check.
 *  - born-after-relation (to check): the same for a Relation's `characters`
 *    and `creatures`, once it has an `end_date` (with none it still runs).
 *  - holder-born-after-revoke (to check): a Title's `holders` born at or
 *    after the title was revoked.
 *
 * Dates are bare integers in the world's units: compared, never interpreted.
 * Not checked: a parent born after a child (the standard has no parent
 * field, only Family) and anything after death (no death date).
 */

import type { Element } from './types';
import { linkIdsOf } from './link-ids';
import { TEMPORAL_TYPE_FIELDS, parseTemporalValue } from '../visualization/timeline/temporal-fields';

export type DateConflictKind =
  | 'reversed'
  | 'born-after-event'
  | 'born-after-relation'
  | 'holder-born-after-revoke'
  | 'cause-after-effect';

/** One side of a conflict: an element and the date field that disagrees. */
export interface DatedRef {
  id: string;
  type: string;
  name: string;
  field: string;
  date: number;
}

/**
 * Two dates worth a look (`IMPOSSIBLE_KINDS`: two that cannot both be true). For `reversed`, both sides are the
 * same element (a: its start, b: its end); otherwise `a` is the one born or
 * the cause, `b` the event, relation or title it meets.
 */
export interface DateConflict {
  kind: DateConflictKind;
  a: DatedRef;
  b: DatedRef;
}

const KIND_ORDER: DateConflictKind[] = [
  'reversed', 'cause-after-effect', 'born-after-event', 'born-after-relation', 'holder-born-after-revoke',
];

/** The two kinds whose dates cannot both be true; the rest are links across a birth, worth a look. */
export const IMPOSSIBLE_KINDS: ReadonlySet<DateConflictKind> = new Set(['reversed', 'cause-after-effect']);
const BORN = new Set(['character', 'creature']);

function raw(el: Element, field: string): unknown {
  return (el as unknown as Record<string, unknown>)[field];
}

function dated(el: Element, field: string): DatedRef | null {
  const date = parseTemporalValue(raw(el, field));
  if (date === null) return null;
  return { id: el.id, type: el.type, name: el.name || '(unnamed)', field, date };
}

/** A span's start and end, or null when either is missing. */
function span(el: Element): { start: DatedRef; end: DatedRef } | null {
  const m = TEMPORAL_TYPE_FIELDS[el.type];
  if (!m?.end) return null;
  const start = dated(el, m.start);
  const end = dated(el, m.end);
  return start && end ? { start, end } : null;
}

function isReversed(el: Element): boolean {
  const s = span(el);
  return !!s && s.end.date < s.start.date;
}

/**
 * When a span was over: its end (half-open, so at the end it is over). With
 * no end, an event is a moment, over at its start; a relation is still
 * running ("ended if any", the schema says), so never over. Null when there
 * is no date to be over at.
 */
function overAt(el: Element): { ref: DatedRef; inclusive: boolean } | null {
  const m = TEMPORAL_TYPE_FIELDS[el.type];
  if (!m) return null;
  const end = m.end ? dated(el, m.end) : null;
  if (end) return { ref: end, inclusive: true };
  // An end that is there and not a number ("that spring") is unknown, not a moment.
  const rawEnd = m.end ? raw(el, m.end) : undefined;
  if (rawEnd != null && rawEnd !== '') return null;
  if (el.type !== 'event') return null;
  const start = dated(el, m.start);
  return start ? { ref: start, inclusive: false } : null;
}

export function findDateConflicts(elements: readonly Element[]): DateConflict[] {
  const byId = new Map<string, Element>();
  for (const el of elements) byId.set(el.id, el);
  const out: DateConflict[] = [];

  const born = (id: string): DatedRef | null => {
    const el = byId.get(id);
    return el && BORN.has(el.type) ? dated(el, 'birth_date') : null;
  };

  for (const el of elements) {
    const s = span(el);
    if (s && s.end.date < s.start.date) {
      out.push({ kind: 'reversed', a: s.start, b: s.end });
      continue; // a reversed span's other rules would only echo it
    }

    if (el.type === 'event' || el.type === 'relation') {
      const over = overAt(el);
      if (over) {
        const kind: DateConflictKind = el.type === 'event' ? 'born-after-event' : 'born-after-relation';
        const ids = new Set([...linkIdsOf(raw(el, 'characters')), ...linkIdsOf(raw(el, 'creatures'))]);
        for (const id of ids) {
          const b = born(id);
          if (b && (over.inclusive ? b.date >= over.ref.date : b.date > over.ref.date)) {
            out.push({ kind, a: b, b: over.ref });
          }
        }
      }
    }

    if (el.type === 'title') {
      const revoked = dated(el, 'revoke_date');
      if (revoked) {
        for (const id of new Set(linkIdsOf(raw(el, 'holders')))) {
          const b = born(id);
          if (b && b.date >= revoked.date) out.push({ kind: 'holder-born-after-revoke', a: b, b: revoked });
        }
      }
    }

    if (el.type === 'event') {
      const effect = dated(el, 'start_date');
      if (effect) {
        for (const id of new Set(linkIdsOf(raw(el, 'triggers')))) {
          const cause = byId.get(id);
          if (!cause || cause.type !== 'event' || cause.id === el.id || isReversed(cause)) continue;
          const c = dated(cause, 'start_date');
          if (c && c.date > effect.date) out.push({ kind: 'cause-after-effect', a: c, b: effect });
        }
      }
    }
  }

  return out.sort((x, y) =>
    KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind)
    || (x.a.name ?? '').localeCompare(y.a.name ?? '')
    || (x.b.name ?? '').localeCompare(y.b.name ?? ''));
}
