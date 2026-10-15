import { describe, it, expect } from 'vitest';
import { zoneShownAt, zoneDateRange, effectiveZoneDate, isDatedZone, zoneSpan } from '../../src/core/zone-dates';

// #280: a map shows each zone as of a chosen date, on the zone's own dates.
describe('zone dates (#280)', () => {
  const early = { start_date: 100, end_date: 200 };   // the border's first era
  const late = { start_date: 200 };                     // its second, still standing
  const undated = {};

  it('a zone with no dates always shows', () => {
    for (const d of [-1e6, 0, 150, 1e6, null]) expect(zoneShownAt(undated, d)).toBe(true);
  });

  it('the span is half-open: two eras meeting at a date never both draw there', () => {
    expect(zoneShownAt(early, 99)).toBe(false);
    expect(zoneShownAt(early, 100)).toBe(true);
    expect(zoneShownAt(early, 199)).toBe(true);
    expect(zoneShownAt(early, 200)).toBe(false);
    expect(zoneShownAt(late, 199)).toBe(false);
    expect(zoneShownAt(late, 200)).toBe(true);
    expect(zoneShownAt(late, 1e9)).toBe(true);
  });

  it('an end with no start is open to the past', () => {
    expect(zoneShownAt({ end_date: 50 }, -1000)).toBe(true);
    expect(zoneShownAt({ end_date: 50 }, 50)).toBe(false);
  });

  it('a zone whose end is not after its start shows at its start only', () => {
    expect(zoneShownAt({ start_date: 10, end_date: 10 }, 10)).toBe(true);
    expect(zoneShownAt({ start_date: 10, end_date: 10 }, 11)).toBe(false);
    expect(zoneShownAt({ start_date: 10, end_date: 5 }, 10)).toBe(true);
    expect(zoneShownAt({ start_date: 10, end_date: 5 }, 7)).toBe(false);
  });

  it('All dates (a null date) shows every zone', () => {
    expect(zoneShownAt(early, null)).toBe(true);
    expect(zoneShownAt({ start_date: 10, end_date: 5 }, null)).toBe(true);
  });

  it('dates read as the charts read them: numeric strings count, junk is no date', () => {
    expect(zoneSpan({ start_date: '100', end_date: 'that winter' })).toEqual({ start: 100, end: null });
    expect(isDatedZone({ start_date: '', end_date: null })).toBe(false);
    expect(isDatedZone({ end_date: 0 })).toBe(true);
  });

  it('the slider reaches every date and the now', () => {
    expect(zoneDateRange([early, late, undated], null)).toEqual({ min: 100, max: 200 });
    expect(zoneDateRange([early, late], 454)).toEqual({ min: 100, max: 454 });
    expect(zoneDateRange([early], -20)).toEqual({ min: -20, max: 200 });
    expect(zoneDateRange([undated], 454)).toBeNull();
  });

  it('the bar follows the now by default, and a chosen date or All dates wins', () => {
    expect(effectiveZoneDate({ kind: 'now' }, 454)).toBe(454);
    expect(effectiveZoneDate({ kind: 'now' }, null)).toBeNull();
    expect(effectiveZoneDate({ kind: 'date', value: 120 }, 454)).toBe(120);
    expect(effectiveZoneDate({ kind: 'all' }, 454)).toBeNull();
  });
});
