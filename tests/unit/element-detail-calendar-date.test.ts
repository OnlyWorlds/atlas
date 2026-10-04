/**
 * Dates on element pages in the world's calendar (S369): beside a schema date
 * field's number, read-only, only when the world has an active calendar.
 */
import { describe, it, expect } from 'vitest';
import { calendarDateText, isSchemaDateField } from '../../src/middle/element-detail-fields';
import { formatStep, type CalendarConfig } from '../../src/core/calendar';
import type { WorldCalendar } from '../../src/core/calendar-lens';

const VESSACH: CalendarConfig = {
  version: 1,
  grain: 'year',
  eras: [
    { name: 'First Age', abbrev: 'FA', start: -20000, end: -10000, restart: true, year_base: 0 },
    { name: 'Third Age', abbrev: 'TA', start: 0, restart: true, year_base: 0 },
  ],
  format: '{year} {era}',
};
const LENS: WorldCalendar = { id: 'cal-1', name: 'Vessach reckoning', config: VESSACH };

const num = (name: string) => ({ name, widget: 'number' as const });

describe('isSchemaDateField', () => {
  it('knows the schema date fields', () => {
    for (const n of ['birth_date', 'founding_date', 'formation_date', 'start_date', 'end_date', 'grant_date', 'revoke_date', 'date']) {
      expect(isSchemaDateField(num(n)), n).toBe(true);
    }
  });

  it('refuses other numbers, text fields and custom fields', () => {
    expect(isSchemaDateField(num('courage'))).toBe(false);
    expect(isSchemaDateField(num('width'))).toBe(false);
    expect(isSchemaDateField({ name: 'start_date', widget: 'text-short' })).toBe(false);
    expect(isSchemaDateField(num('x_wedding_date'))).toBe(false);
  });
});

describe('calendarDateText', () => {
  it('formats a stored date in the active calendar', () => {
    expect(calendarDateText(num('start_date'), 12, LENS)).toBe(formatStep(VESSACH, 12));
    expect(calendarDateText(num('start_date'), 12, LENS)).toBe('12 TA');
  });

  it('reads a numeric string the way the charts do', () => {
    expect(calendarDateText(num('birth_date'), '12', LENS)).toBe('12 TA');
  });

  it('says nothing without a calendar, for a non-date field, or for a value that is not a whole number', () => {
    expect(calendarDateText(num('start_date'), 12, null)).toBeNull();
    expect(calendarDateText(num('courage'), 12, LENS)).toBeNull();
    expect(calendarDateText(num('start_date'), null, LENS)).toBeNull();
    expect(calendarDateText(num('start_date'), '', LENS)).toBeNull();
    expect(calendarDateText(num('start_date'), 12.5, LENS)).toBeNull();
    expect(calendarDateText(num('start_date'), 'that winter', LENS)).toBeNull();
  });
});
