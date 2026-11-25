/**
 * 1.125.38: a calendar past Atlas's bound words no dates. A world file is anyone's, and the SDK's
 * `formatStep` costs more with each era (SDK 4.203.1: 150,000 eras cost 39 s a label), so a calendar
 * holding more than `CALENDAR_BOUNDS` is never the lens: its dates show as numbers, it still counts as
 * a calendar of the world (the builder edits it and its save keeps it whole), and the bound's line is
 * exact for every count.
 */
import { describe, it, expect } from 'vitest';
import { formatStep, type CalendarConfig } from '@onlyworlds/sdk';
import {
  CALENDAR_BOUNDS, calendarTooCostly, readCalendarValue, resolveCalendarLens, worldCalendars,
} from '../../src/core/calendar-lens';
import type { Element } from '../../src/core/types';

const months = (n: number) => ({ names: Array.from({ length: n }, (_, i) => `M${i}`), lengths: Array.from({ length: n }, () => 3) });
const base = (): Record<string, unknown> => ({ version: 2, grain: 'day', bundles: { months: months(2) }, format: '{day} {month} {year}' });

/** One config per count, holding `n` of that thing. */
const SHAPES: Record<keyof typeof CALENDAR_BOUNDS, (n: number) => Record<string, unknown>> = {
  eras: n => ({ ...base(), eras: Array.from({ length: n }, (_, i) => ({ name: `E${i}`, start: i * 10 })) }),
  months: n => ({ ...base(), bundles: { months: months(n) } }),
  intercalary: n => ({ ...base(), intercalary: Array.from({ length: n }, (_, i) => ({ name: `I${i}`, after_month: 1, every_years: 1 })) }),
  except: n => ({ ...base(), intercalary: [{ name: 'Leap', after_month: 1, every_years: 2, except: Array.from({ length: n }, (_, k) => 2 ** (k + 2)) }] }),
  weekdays: n => ({ ...base(), bundles: { months: months(2), week: { length: n, names: Array.from({ length: n }, (_, i) => `W${i}`) } } }),
  template: n => ({ ...base(), format: '{day}' + ' '.repeat(n - 5) }),
  name: n => ({ ...base(), bundles: { months: { names: ['x'.repeat(n), 'B'], lengths: [3, 3] } } }),
};

const read = (raw: unknown): CalendarConfig => {
  const cfg = readCalendarValue(raw);
  if (!cfg) throw new Error('the fixture is no calendar');
  return cfg;
};
const calendarEl = (id: string, cfg: unknown): Element =>
  ({ id, type: 'construct', name: id, supertype: 'calendar', atlas_calendar: cfg }) as unknown as Element;

describe('calendarTooCostly: the line is exact for every count', () => {
  for (const [key, make] of Object.entries(SHAPES) as Array<[keyof typeof CALENDAR_BOUNDS, (n: number) => Record<string, unknown>]>) {
    const bound = CALENDAR_BOUNDS[key];
    it(`${key}: ${bound} is worded, ${bound + 1} is not`, () => {
      expect(calendarTooCostly(read(make(bound)))).toBeNull();
      expect(calendarTooCostly(read(make(bound + 1)))).toMatchObject({ bound });
    });
  }

  it('an ordinary calendar is worded', () => {
    expect(calendarTooCostly(read(base()))).toBeNull();
  });
});

describe('resolveCalendarLens: a calendar past the bound is no lens, and stays a calendar of the world', () => {
  const big = SHAPES.eras(CALENDAR_BOUNDS.eras + 1);
  const ok = SHAPES.eras(CALENDAR_BOUNDS.eras);

  it('chosen by id, or the only calendar of the world: null, so dates show as numbers', () => {
    const elements = [calendarEl('big', big)];
    expect(resolveCalendarLens(elements, 'big')).toBeNull();
    expect(resolveCalendarLens(elements, undefined, { fallbackToOnly: true })).toBeNull();
  });

  it('at the bound it is the lens', () => {
    const elements = [calendarEl('ok', ok)];
    expect(resolveCalendarLens(elements, 'ok')?.id).toBe('ok');
    expect(resolveCalendarLens(elements, undefined, { fallbackToOnly: true })?.id).toBe('ok');
  });

  it('worldCalendars still lists it, and the builder still reads it whole', () => {
    const elements = [calendarEl('big', big)];
    expect(worldCalendars(elements).map(c => c.id)).toEqual(['big']);
    expect(readCalendarValue(big)?.eras).toHaveLength(CALENDAR_BOUNDS.eras + 1);
  });

  it('150,000 eras resolve to no lens in well under a second', () => {
    const elements = [calendarEl('huge', SHAPES.eras(150_000))];
    const t0 = performance.now();
    expect(resolveCalendarLens(elements, 'huge')).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('at the bound, with every count at its line at once, a label costs under the stated time', () => {
  it('under 20 ms a label (measured under 2 ms in Node; the margin is for a slow runner)', () => {
    const B = CALENDAR_BOUNDS;
    const cfg = read({
      version: 2, grain: 'day',
      eras: Array.from({ length: B.eras }, (_, i) => ({ name: `E${i}`, start: i * 10 })),
      bundles: { months: months(B.months), week: { length: B.weekdays, names: Array.from({ length: B.weekdays }, (_, i) => `W${i}`) } },
      intercalary: Array.from({ length: B.intercalary }, (_, i) => ({ name: `I${i}`, after_month: 1, every_years: 2, except: Array.from({ length: B.except }, (_, k) => 2 ** (k + 2)) })),
      format: ('{day} {month} {year} {era} {weekday}' + ' '.repeat(B.template)).slice(0, B.template),
    });
    expect(calendarTooCostly(cfg)).toBeNull();
    let worst = 0;
    for (const s of [0, 12_345, 9_999_999, 99_999_999, 2 ** 31 - 2]) {
      const t0 = performance.now();
      formatStep(cfg, s);
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(20);
  });
});
