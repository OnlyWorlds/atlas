/**
 * The calendar profile's size bounds (standard serial 149), read by the SDK's
 * own reader: a calendar past one is no calendar, in every reader alike, so its
 * dates show as numbers ("every reader refuses the same values"). Atlas keeps
 * no bound of its own since 1.125.42 (its own, from 1.125.38, was looser for
 * months and weekdays). The line is exact through Atlas's own list and lens,
 * and the cost the bounds exist for holds: a huge calendar resolves at once,
 * and a label at every bound together stays cheap.
 */
import { describe, it, expect } from 'vitest';
import { formatStep, type CalendarConfig } from '@onlyworlds/sdk';
import { readCalendarValue, resolveCalendarLens, worldCalendars } from '../../src/core/calendar-lens';
import type { Element } from '../../src/core/types';

/** The profile's bounds (profiles/calendar.md, "Not a calendar"). */
const BOUNDS = { eras: 256, months: 64, weekdays: 64, intercalary: 16, except: 8, template: 256, name: 256 } as const;

const months = (n: number) => ({ names: Array.from({ length: n }, (_, i) => `M${i}`), lengths: Array.from({ length: n }, () => 3) });
const base = (): Record<string, unknown> => ({ version: 2, grain: 'day', bundles: { months: months(2) }, format: '{day} {month} {year}' });

/** One config per count, holding `n` of that thing. */
const SHAPES: Record<keyof typeof BOUNDS, (n: number) => Record<string, unknown>> = {
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

describe("the profile's bounds through Atlas's list and lens: the line is exact for every count", () => {
  for (const [key, make] of Object.entries(SHAPES) as Array<[keyof typeof BOUNDS, (n: number) => Record<string, unknown>]>) {
    const bound = BOUNDS[key];
    it(`${key}: ${bound} speaks, ${bound + 1} is no calendar and its dates are numbers`, () => {
      const at = [calendarEl('at', make(bound))];
      expect(worldCalendars(at).map(c => c.id)).toEqual(['at']);
      expect(resolveCalendarLens(at, 'at')?.id).toBe('at');
      expect(resolveCalendarLens(at, undefined, { fallbackToOnly: true, world: null })?.id).toBe('at');
      const past = [calendarEl('past', make(bound + 1))];
      expect(worldCalendars(past)).toEqual([]);
      expect(resolveCalendarLens(past, 'past')).toBeNull();
      expect(resolveCalendarLens(past, undefined, { fallbackToOnly: true, world: null })).toBeNull();
    });
  }
});

describe('the cost the bounds exist for', () => {
  it('150,000 eras resolve to no lens in well under a second', () => {
    const elements = [calendarEl('huge', SHAPES.eras(150_000))];
    const t0 = performance.now();
    expect(resolveCalendarLens(elements, 'huge')).toBeNull();
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it('with every count at its line at once, a label costs under 50 ms (a margin for a shared runner)', () => {
    const B = BOUNDS;
    const cfg = read({
      version: 2, grain: 'day',
      eras: Array.from({ length: B.eras }, (_, i) => ({ name: `E${i}`, start: i * 10 })),
      bundles: { months: months(B.months), week: { length: B.weekdays, names: Array.from({ length: B.weekdays }, (_, i) => `W${i}`) } },
      intercalary: Array.from({ length: B.intercalary }, (_, i) => ({ name: `I${i}`, after_month: 1, every_years: 2, except: Array.from({ length: B.except }, (_, k) => 2 ** (k + 2)) })),
      format: ('{day} {month} {year} {era} {weekday}' + ' '.repeat(B.template)).slice(0, B.template),
    });
    let worst = 0;
    // Each step's fastest of three calls: one call alone also times the first call's warm-up and any
    // collection that lands on it, which is the runner, not the label.
    for (const s of [0, 12_345, 9_999_999, 99_999_999, 2 ** 31 - 2]) {
      let best = Infinity;
      for (let k = 0; k < 3; k++) {
        const t0 = performance.now();
        formatStep(cfg, s);
        best = Math.min(best, performance.now() - t0);
      }
      worst = Math.max(worst, best);
    }
    expect(worst).toBeLessThan(50);
  });
});
