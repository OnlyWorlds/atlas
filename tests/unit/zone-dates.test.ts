import { describe, it, expect } from 'vitest';
import { zoneShownAt, zoneDateRange, effectiveZoneDate, isDatedZone, zoneSpan, elementSpan, spanShownAt, spanDateRange } from '../../src/core/zone-dates';

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

describe('an element\'s span, for its pins (Q11)', () => {
  it('reads each type\'s own date fields, as the charts do', () => {
    expect(elementSpan({ type: 'character', birth_date: 100 })).toEqual({ start: 100, end: null });
    expect(elementSpan({ type: 'location', founding_date: '40' })).toEqual({ start: 40, end: null });
    expect(elementSpan({ type: 'event', start_date: 120, end_date: 140 })).toEqual({ start: 120, end: 140 });
    expect(elementSpan({ type: 'title', grant_date: 5, revoke_date: 9 })).toEqual({ start: 5, end: 9 });
    // Another type's field names never count: an Event has no birth.
    expect(elementSpan({ type: 'event', birth_date: 100 })).toEqual({ start: null, end: null });
  });

  it('has none for a type without dates, a missing element or a foreign type', () => {
    expect(elementSpan({ type: 'object', start_date: 100 })).toEqual({ start: null, end: null });
    expect(elementSpan(undefined)).toEqual({ start: null, end: null });
    expect(elementSpan({ type: 'toString' })).toEqual({ start: null, end: null });
    expect(elementSpan({ type: 7, start_date: 1 })).toEqual({ start: null, end: null });
  });

  it('shows half-open, as a zone: from the start, gone at the end, always when undated', () => {
    const siege = { start: 120, end: 140 };
    expect(spanShownAt(siege, 119)).toBe(false);
    expect(spanShownAt(siege, 120)).toBe(true);
    expect(spanShownAt(siege, 139)).toBe(true);
    expect(spanShownAt(siege, 140)).toBe(false);
    expect(spanShownAt({ start: 100, end: null }, 5000)).toBe(true);
    expect(spanShownAt({ start: null, end: null }, -5)).toBe(true);
    expect(spanShownAt(siege, null)).toBe(true);
  });

  it('reaches over zones and pins together', () => {
    expect(spanDateRange([{ start: 100, end: null }, { start: 120, end: 140 }, { start: null, end: null }], null)).toEqual({ min: 100, max: 140 });
    expect(spanDateRange([{ start: null, end: null }], 454)).toBeNull();
  });
});
