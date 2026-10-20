/**
 * Calendar kernel contract tests — every rule in the gated contract
 * (Notes/2026-07-14-calendar-design-final.md §5) plus the materials fixtures.
 *
 * Fixtures: Kirrowmoss (irregular months, 3 eras incl. closed, free 6-day
 * week), Vessach (year-grain, era gap), Dune B.G./A.G. (down-era astride 0),
 * Harptos (intercalary festivals + Shieldmeet leap + nested tendays), Shire
 * (the weekday lock via per-day in_week).
 */
import { describe, it, expect } from 'vitest';
import {
  type CalendarConfig,
  floorDiv, floorMod, isLeapYear, yearStartStep, yearLength, absoluteYear,
  eraForStep, displayYear, breakdownStep, formatStep, parseDate, isParseError,
  validateCalendarConfig, readCalendarConfig, weekdayForStep,
  formatYearLabel, formatDuration, approxYearLength,
} from '@onlyworlds/sdk';

// ---- Fixtures ----

const KIRROWMOSS: CalendarConfig = {
  version: 1,
  grain: 'day',
  eras: [
    { name: 'Kingsreckoning', abbrev: 'KR', start: -131400, end: -3600, restart: true, closed: true },
    { name: 'Occupation Count', abbrev: 'OC', start: -3600, restart: true, closed: true },
    { name: 'Freehold Tally', abbrev: 'FT', start: 0, restart: true },
  ],
  bundles: {
    months: {
      names: ['Sowmarch', 'Thistlewane', 'Greening', 'Suncrest', 'Longhay', 'Ashfall',
        'Rootdeep', 'Frostwake', 'Bellmoot', 'Hearthtide', 'Graytide', 'Coldmark'],
      lengths: [30, 28, 32, 30, 31, 29, 30, 28, 32, 30, 29, 31], // sums to 360
    },
    week: { length: 6, names: ['Ondel', 'Tresk', 'Mireth', 'Aldun', 'Volk', 'Hearth'], mode: 'free' },
  },
  format: '{day} {month}, Year {year} {era}',
};

const VESSACH: CalendarConfig = {
  version: 1,
  grain: 'year',
  eras: [
    // Explicit end creates the REAL interior gap (the disputed Second Age).
    { name: 'First Age', abbrev: 'FA', start: -20000, end: -10000, restart: true, year_base: 0 },
    { name: 'Third Age', abbrev: 'TA', start: 0, restart: true, year_base: 0 },
  ],
  format: '{year} {era}',
};

const DUNE: CalendarConfig = {
  version: 1,
  grain: 'year',
  eras: [
    { name: 'Before Guild', abbrev: 'B.G.', start: 0, direction: 'down', restart: true },
    { name: 'After Guild', abbrev: 'A.G.', start: 0, restart: true, year_base: 0 },
  ],
  format: '{year} {era}',
};

const HARPTOS: CalendarConfig = {
  version: 1,
  grain: 'day',
  eras: [{ name: 'Dalereckoning', abbrev: 'DR', start: 0, restart: true, year_base: 0 }],
  bundles: {
    months: {
      names: ['Hammer', 'Alturiak', 'Ches', 'Tarsakh', 'Mirtul', 'Kythorn',
        'Flamerule', 'Eleasis', 'Eleint', 'Marpenoth', 'Uktar', 'Nightal'],
      lengths: [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    },
    week: { length: 10, names: ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'], mode: 'nested' },
  },
  intercalary: [
    { name: 'Midwinter', after_month: 1 },
    { name: 'Greengrass', after_month: 3 },
    { name: 'Midsummer', after_month: 7 },
    { name: 'Shieldmeet', after_month: 7, every_years: 4 },
    { name: 'Highharvestide', after_month: 9 },
    { name: 'Feast of the Moon', after_month: 11 },
  ],
  format: '{day} {month}, {year} {era}',
  format_intercalary: '{intercalary}, {year} {era}',
};

const SHIRE: CalendarConfig = {
  version: 1,
  grain: 'day',
  eras: [{ name: 'Shire Reckoning', abbrev: 'S.R.', start: 0, restart: true }],
  bundles: {
    months: {
      names: ['Afteryule', 'Solmath', 'Rethe', 'Astron', 'Thrimidge', 'Forelithe',
        'Afterlithe', 'Wedmath', 'Halimath', 'Winterfilth', 'Blotmath', 'Foreyule'],
      lengths: [30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    },
    week: { length: 7, names: ['Sterday', 'Sunday', 'Monday', 'Trewsday', 'Hevensday', 'Mersday', 'Highday'], mode: 'free' },
  },
  intercalary: [
    { name: '2 Yule', after_month: 0 },                                  // first day of the year
    { name: '1 Lithe', after_month: 6 },
    { name: "Mid-year's Day", after_month: 6, in_week: false },          // the lock: out of the week
    { name: 'Overlithe', after_month: 6, every_years: 4, in_week: false },
    { name: '2 Lithe', after_month: 6 },
    { name: '1 Yule', after_month: 12 },                                 // last day of the year
  ],
  format: '{day} {month}, S.R. {year}',
  format_intercalary: '{intercalary}, S.R. {year}',
};

// Minimal: eras + format on a year-grain world must feel complete.
const MINIMAL: CalendarConfig = {
  version: 1,
  grain: 'year',
  eras: [{ name: 'Third Age', abbrev: 'TA', start: 0, restart: true, year_base: 0 }],
  format: '{year} {era}',
};

// ---- Euclidean division (contract rule 1: floor, never truncation) ----

describe('floor division', () => {
  it('floors toward negative infinity', () => {
    expect(floorDiv(-400, 360)).toBe(-2);
    expect(floorDiv(400, 360)).toBe(1);
    expect(floorDiv(-360, 360)).toBe(-1);
  });
  it('floorMod stays periodic for negatives (the leap rule depends on it)', () => {
    expect(floorMod(-1, 4)).toBe(3);
    expect(floorMod(-4, 4)).toBe(0);
    expect(floorMod(-8, 4)).toBe(0);
  });
});

// ---- Absolute year index (rule 1: zero-based, step 0 opens year 0) ----

describe('absolute year index', () => {
  it('is zero-based with Euclidean floor', () => {
    expect(absoluteYear(KIRROWMOSS, 0)).toBe(0);
    expect(absoluteYear(KIRROWMOSS, 359)).toBe(0);
    expect(absoluteYear(KIRROWMOSS, 360)).toBe(1);
    expect(absoluteYear(KIRROWMOSS, -1)).toBe(-1);
    expect(absoluteYear(KIRROWMOSS, -360)).toBe(-1);
    expect(absoluteYear(KIRROWMOSS, -361)).toBe(-2);
  });
  it('year-grain: the step IS the year', () => {
    expect(absoluteYear(DUNE, 10191)).toBe(10191);
    expect(absoluteYear(DUNE, -108)).toBe(-108);
  });
});

// ---- Leap arithmetic (rule 6 + astride year 0) ----

describe('leap years', () => {
  it('fires on floorMod(absYear, N) === 0, including negatives and year 0', () => {
    expect(isLeapYear(0, 4)).toBe(true);
    expect(isLeapYear(4, 4)).toBe(true);
    expect(isLeapYear(-4, 4)).toBe(true);
    expect(isLeapYear(-1, 4)).toBe(false);
    expect(isLeapYear(3, 4)).toBe(false);
  });
  it('year lengths and starts account for leap days astride year 0', () => {
    // Harptos: 360 month days + 5 fixed festivals = 365; Shieldmeet years 366.
    expect(yearLength(HARPTOS, 0)).toBe(366);
    expect(yearLength(HARPTOS, 1)).toBe(365);
    expect(yearLength(HARPTOS, 4)).toBe(366);
    expect(yearLength(HARPTOS, -4)).toBe(366);
    // yearStart(0) is 0 by construction; year 1 starts after leap year 0.
    expect(yearStartStep(HARPTOS, 0)).toBe(0);
    expect(yearStartStep(HARPTOS, 1)).toBe(366);
    expect(yearStartStep(HARPTOS, 2)).toBe(731);
    // Negative side: year -1 (365) and year -4 (leap, 366).
    expect(yearStartStep(HARPTOS, -1)).toBe(-365);
    expect(yearStartStep(HARPTOS, -4)).toBe(-365 * 3 - 366);
    // Consistency: absoluteYear inverts yearStartStep everywhere.
    for (const y of [-5, -4, -1, 0, 1, 3, 4, 100]) {
      expect(absoluteYear(HARPTOS, yearStartStep(HARPTOS, y))).toBe(y);
      expect(absoluteYear(HARPTOS, yearStartStep(HARPTOS, y + 1) - 1)).toBe(y);
    }
  });
});

// ---- Era domains, gaps, down-eras (rules 3 + 4) ----

describe('eras', () => {
  it('selects by domain: [start, end ?? next start)', () => {
    expect(eraForStep(KIRROWMOSS, 0)?.abbrev).toBe('FT');       // boundary: latest start wins
    expect(eraForStep(KIRROWMOSS, -1)?.abbrev).toBe('OC');
    expect(eraForStep(KIRROWMOSS, -3600)?.abbrev).toBe('OC');
    expect(eraForStep(KIRROWMOSS, -3601)?.abbrev).toBe('KR');
  });
  it('an explicit end creates a REAL interior gap (Vessach Second Age)', () => {
    expect(eraForStep(VESSACH, -20000)?.abbrev).toBe('FA');
    expect(eraForStep(VESSACH, -10001)?.abbrev).toBe('FA');
    expect(eraForStep(VESSACH, -10000)).toBe(null);            // the gap
    expect(eraForStep(VESSACH, -5000)).toBe(null);
    expect(eraForStep(VESSACH, 0)?.abbrev).toBe('TA');
  });
  it('gap and pre-era formatting: {era} empty, {year} = absolute year', () => {
    expect(formatStep(VESSACH, -5000)).toBe('-5000');
    expect(formatStep(VESSACH, -30000)).toBe('-30000');        // before the first era
  });
  it('down-era: start is the pivot (exclusive); the up-era owns the shared step', () => {
    expect(eraForStep(DUNE, 0)?.abbrev).toBe('A.G.');
    expect(eraForStep(DUNE, -1)?.abbrev).toBe('B.G.');
  });
  it('down-era year formula: step -1 is "1 B.G." (no year zero on the down side)', () => {
    expect(formatStep(DUNE, -1)).toBe('1 B.G.');
    expect(formatStep(DUNE, -108)).toBe('108 B.G.');
    expect(formatStep(DUNE, 0)).toBe('0 A.G.');
    expect(formatStep(DUNE, 10191)).toBe('10191 A.G.');
  });
  it('year_base picks 0- or 1-based numbering per era (the fixture conflict)', () => {
    // Kirrowmoss: 1-based (default). Step 0 = Year 1 FT.
    expect(formatStep(KIRROWMOSS, 0)).toBe('1 Sowmarch, Year 1 FT');
    // Vessach: 0-based. Step 0 = 0 TA; step 1204 = 1204 TA; step -19912 = 88 FA.
    expect(formatStep(VESSACH, 0)).toBe('0 TA');
    expect(formatStep(VESSACH, 1204)).toBe('1204 TA');
    expect(formatStep(VESSACH, -19912)).toBe('88 FA');
  });
  it('restart:false shows the absolute year index under the era label', () => {
    const cfg: CalendarConfig = {
      version: 1, grain: 'year',
      eras: [{ name: 'Common Era', abbrev: 'CE', start: -500, restart: false }],
      format: '{year} {era}',
    };
    expect(formatStep(cfg, 454)).toBe('454 CE');
    expect(formatStep(cfg, -100)).toBe('-100 CE');
  });
});

// ---- The gate-verified Kirrowmoss vector + round trips ----

describe('Kirrowmoss (irregular months, free week)', () => {
  it('the gate-verified vector: step 7603 = 14 Thistlewane, Year 22 FT', () => {
    // 21 complete years × 360 + Sowmarch 30 + day-offset 13.
    expect(formatStep(KIRROWMOSS, 7603)).toBe('14 Thistlewane, Year 22 FT');
    const r = parseDate(KIRROWMOSS, '14 Thistlewane, Year 22 FT');
    expect(isParseError(r)).toBe(false);
    if (!isParseError(r)) expect(r.step).toBe(7603);
  });
  it('irregular month boundaries land correctly', () => {
    const b = breakdownStep(KIRROWMOSS, 30);                    // day after 30-day Sowmarch
    expect(b.monthName).toBe('Thistlewane');
    expect(b.day).toBe(1);
    const c = breakdownStep(KIRROWMOSS, 30 + 28);               // Thistlewane has 28
    expect(c.monthName).toBe('Greening');
    expect(c.day).toBe(1);
  });
  it('free week anchors at step 0 and runs across month boundaries', () => {
    expect(weekdayForStep(KIRROWMOSS, 0)).toBe('Ondel');
    expect(weekdayForStep(KIRROWMOSS, 5)).toBe('Hearth');
    expect(weekdayForStep(KIRROWMOSS, 6)).toBe('Ondel');
    expect(weekdayForStep(KIRROWMOSS, 30)).toBe('Ondel');       // 30 mod 6 = 0: crosses months without reset
    expect(weekdayForStep(KIRROWMOSS, -1)).toBe('Hearth');      // negative steps stay periodic
  });
});

// ---- Intercalary days (rule 8 + the three-lens convergent blocker) ----

describe('Harptos (intercalary + leap + nested tendays)', () => {
  it('festival days render through format_intercalary by name', () => {
    // Year 0 (leap): Hammer 30 days, then Midwinter at offset 30.
    expect(formatStep(HARPTOS, 30)).toBe('Midwinter, 0 DR');
    const b = breakdownStep(HARPTOS, 30);
    expect(b.intercalary).toBe('Midwinter');
    expect(b.month).toBe(null);
    expect(b.day).toBe(null);
  });
  it('Shieldmeet exists only in leap years, right after Midsummer', () => {
    // Offset of Midsummer in any year: 7 months × 30 + Midwinter + Greengrass = 212.
    const y1372 = yearStartStep(HARPTOS, 1372);                 // 1372 mod 4 = 0: leap
    expect(formatStep(HARPTOS, y1372 + 212)).toBe('Midsummer, 1372 DR');
    expect(formatStep(HARPTOS, y1372 + 213)).toBe('Shieldmeet, 1372 DR');
    const y1373 = yearStartStep(HARPTOS, 1373);                 // not leap: no Shieldmeet
    expect(formatStep(HARPTOS, y1373 + 213)).toBe('1 Eleasis, 1373 DR');
  });
  it('parses an intercalary date, and rejects it in a non-leap year', () => {
    const ok = parseDate(HARPTOS, 'Shieldmeet 1372');
    expect(isParseError(ok)).toBe(false);
    if (!isParseError(ok)) expect(formatStep(HARPTOS, ok.step)).toBe('Shieldmeet, 1372 DR');
    const bad = parseDate(HARPTOS, 'Shieldmeet 1373');
    expect(isParseError(bad)).toBe(true);
  });
  it('nested tendays: weekday from day-of-month; intercalary days have none', () => {
    expect(weekdayForStep(HARPTOS, 0)).toBe('1st');             // 1 Hammer
    expect(weekdayForStep(HARPTOS, 9)).toBe('10th');
    expect(weekdayForStep(HARPTOS, 10)).toBe('1st');            // tenday resets
    expect(weekdayForStep(HARPTOS, 30)).toBe(null);             // Midwinter: no tenday slot
  });
});

// ---- The Shire weekday lock (rule 7: per-day in_week) ----

describe('Shire Reckoning (the weekday lock)', () => {
  it('counts 364 week-days per year: every date keeps its weekday across years, leap or not', () => {
    // 360 month days + 2 Yule + 1&2 Lithe (in week) = 364 = 52 × 7;
    // Mid-year's Day + Overlithe are out of the week.
    const dateWeekday = (year: number, month: string, day: number): string | null => {
      const r = parseDate(SHIRE, `${day} ${month} ${year}`);
      if (isParseError(r)) throw new Error(r.error);
      return weekdayForStep(SHIRE, r.step);
    };
    const w1 = dateWeekday(1, 'Afteryule', 1);
    for (const y of [2, 3, 4, 5, 9, 100, 1401]) {               // 4, 100: leap years included
      expect(dateWeekday(y, 'Afteryule', 1)).toBe(w1);
    }
    const mid = dateWeekday(1, 'Halimath', 22);                 // Bilbo's birthday
    for (const y of [2, 4, 5, 1401]) {
      expect(dateWeekday(y, 'Halimath', 22)).toBe(mid);
    }
  });
  it('the out-of-week days themselves carry no weekday', () => {
    const r = parseDate(SHIRE, "Mid-year's Day 1401");
    expect(isParseError(r)).toBe(false);
    if (!isParseError(r)) expect(weekdayForStep(SHIRE, r.step)).toBe(null);
  });
  it('in-week intercalary days DO carry weekdays (2 Yule opens the year)', () => {
    const r = parseDate(SHIRE, '2 Yule 1401');
    expect(isParseError(r)).toBe(false);
    if (!isParseError(r)) expect(weekdayForStep(SHIRE, r.step)).not.toBe(null);
  });
});

// ---- Format token rules (rule 8) ----

describe('format tokens', () => {
  it('unknown tokens render literally; known-inapplicable render empty with collapse', () => {
    const cfg: CalendarConfig = { ...MINIMAL, format: '{day} {month}, {year} {era} {frob}' };
    expect(formatStep(cfg, 454)).toBe('454 TA {frob}');
  });
  it('a monthless calendar with a monthful format collapses cleanly', () => {
    const cfg: CalendarConfig = { ...MINIMAL, format: '{day} {month}, {year} {era}' };
    expect(formatStep(cfg, 454)).toBe('454 TA');
  });
  it('{step} always exposes the raw integer', () => {
    const cfg: CalendarConfig = { ...MINIMAL, format: '{year} {era} (step {step})' };
    expect(formatStep(cfg, 454)).toBe('454 TA (step 454)');
  });
  it('defaults exist when format is absent', () => {
    const noFmt: CalendarConfig = { version: 1, grain: 'year', eras: MINIMAL.eras };
    expect(formatStep(noFmt, 454)).toBe('454 TA');
  });
});

// ---- Parser rules (rule 9) ----

describe('parser', () => {
  it('bare numbers are ALWAYS the raw stored step', () => {
    const r = parseDate(KIRROWMOSS, '454');
    expect(!isParseError(r) && r.step === 454).toBe(true);
    const n = parseDate(KIRROWMOSS, '-480');
    expect(!isParseError(n) && n.step === -480).toBe(true);
  });
  it('matches calendar words case-insensitively', () => {
    const r = parseDate(KIRROWMOSS, '14 thistlewane, year 22 ft');
    expect(!isParseError(r) && r.step === 7603).toBe(true);
  });
  it('partial dates snap to the period start', () => {
    const yearOnly = parseDate(KIRROWMOSS, 'Year 22 FT');
    expect(!isParseError(yearOnly) && yearOnly.step === 21 * 360).toBe(true);
    const monthOnly = parseDate(KIRROWMOSS, 'Thistlewane 22');  // 22 fits as a day -> needs now
    expect(isParseError(monthOnly)).toBe(true);                 // no now set: never guess
    const monthYear = parseDate(KIRROWMOSS, 'Thistlewane 400'); // 400 can't be a day -> year 400
    expect(!isParseError(monthYear) && formatStep(KIRROWMOSS, monthYear.step) === '1 Thistlewane, Year 400 FT').toBe(true);
  });
  it('a month+day with no year resolves against the year containing the now', () => {
    const r = parseDate(KIRROWMOSS, 'Thistlewane 14', { now: 7900 }); // now inside year 22 FT
    expect(!isParseError(r) && r.step === 7603).toBe(true);
  });
  it('era-less years prefer the era containing the now, else the latest open era', () => {
    // Both KR and OC are closed; FT is the only open era.
    const r = parseDate(KIRROWMOSS, 'Year 12');
    expect(!isParseError(r) && r.step === 11 * 360).toBe(true);
    // With a now inside OC, the OC reading wins.
    const oc = parseDate(KIRROWMOSS, 'Year 2', { now: -3000 });
    expect(!isParseError(oc) && oc.step === -3600 + 360).toBe(true);
  });
  it('down-era years parse back across the pivot', () => {
    const r = parseDate(DUNE, '108 B.G.');
    expect(!isParseError(r) && r.step === -108).toBe(true);
  });
  it('the stability property: format(parse(format(n))) === format(n)', () => {
    for (const cfg of [KIRROWMOSS, HARPTOS, SHIRE, DUNE, VESSACH]) {
      for (const n of [-3601, -108, -1, 0, 30, 213, 7603, 500596]) {
        const f = formatStep(cfg, n);
        const p = parseDate(cfg, f, { now: 0 });
        if (isParseError(p)) throw new Error(`parse failed on "${f}" (${cfg.eras?.[0]?.name}): ${p.error}`);
        expect(formatStep(cfg, p.step)).toBe(f);
      }
    }
  });
  it('rejects garbage with a reason, never a guess', () => {
    expect(isParseError(parseDate(KIRROWMOSS, 'the fifth of never'))).toBe(true);
    expect(isParseError(parseDate(KIRROWMOSS, ''))).toBe(true);
  });
});

// ---- Validation + defensive read (rule §5 general + §8) ----

describe('validation', () => {
  it('rejects year.steps alongside months (the derive rule)', () => {
    const bad: CalendarConfig = {
      ...KIRROWMOSS,
      bundles: { ...KIRROWMOSS.bundles, year: { steps: 360 } },
    };
    expect(validateCalendarConfig(bad).some((e) => e.includes('year.steps'))).toBe(true);
  });
  it('rejects overlapping era domains loudly', () => {
    const bad: CalendarConfig = {
      version: 1, grain: 'year',
      eras: [
        { name: 'A', start: 0, end: 100 },
        { name: 'B', start: 50 },
      ],
    };
    expect(validateCalendarConfig(bad).some((e) => e.includes('overlap'))).toBe(true);
  });
  it('era gaps are legal and silent — no validation error', () => {
    expect(validateCalendarConfig(VESSACH)).toEqual([]);
  });
  it('rejects intercalary without months', () => {
    const bad: CalendarConfig = {
      version: 1, grain: 'year',
      intercalary: [{ name: 'Floating Day', after_month: 0 }],
    };
    expect(validateCalendarConfig(bad).some((e) => e.includes('Festival days need months'))).toBe(true);
  });
  it('all five fixture calendars validate clean', () => {
    for (const cfg of [KIRROWMOSS, VESSACH, DUNE, HARPTOS, SHIRE, MINIMAL]) {
      expect(validateCalendarConfig(cfg)).toEqual([]);
    }
  });
});

describe('surface helpers (2B sweep)', () => {
  it('formatYearLabel: compact "{year} {era}" for ticks; bare absolute year outside eras', () => {
    expect(formatYearLabel(KIRROWMOSS, 7603)).toBe('22 FT');
    expect(formatYearLabel(DUNE, -108)).toBe('108 B.G.');
    expect(formatYearLabel(VESSACH, -5000)).toBe('-5000'); // the era gap
  });
  it('approxYearLength: derived from months + fixed intercalary, or year.steps, else null', () => {
    expect(approxYearLength(KIRROWMOSS)).toBe(360);
    expect(approxYearLength(HARPTOS)).toBe(365); // 360 + 5 fixed festivals; Shieldmeet excluded
    expect(approxYearLength(MINIMAL)).toBe(null);
  });
  it('formatDuration: years when the span reaches a year, else step words', () => {
    expect(formatDuration(KIRROWMOSS, 360 * 19)).toBe('19 years');
    expect(formatDuration(KIRROWMOSS, 540)).toBe('1.5 years');
    expect(formatDuration(KIRROWMOSS, 14)).toBe('14 days');
    expect(formatDuration(KIRROWMOSS, 1)).toBe('1 day');
    // Year-grain worlds: the step word IS "year".
    expect(formatDuration(MINIMAL, 19)).toBe('19 years');
    // A renamed step speaks the culture's word.
    const sol: CalendarConfig = { version: 1, grain: 'day', step_name: 'sol' };
    expect(formatDuration(sol, 14)).toBe('14 sols');
  });
});

describe('defensive read (wild configs fall back, never a broken axis)', () => {
  it('returns null on garbage', () => {
    expect(readCalendarConfig(null)).toBe(null);
    expect(readCalendarConfig('a string')).toBe(null);
    expect(readCalendarConfig({ version: 2, grain: 'day' })).toBe(null);
    expect(readCalendarConfig({ version: 1 })).toBe(null);
    expect(readCalendarConfig({ version: 1, grain: 'day', bundles: { months: { names: ['a'], lengths: [1, 2] } } })).toBe(null);
    expect(readCalendarConfig({ version: 1, grain: 'day', eras: [{ name: 'X' }] })).toBe(null);
  });
  it('accepts every fixture', () => {
    for (const cfg of [KIRROWMOSS, VESSACH, DUNE, HARPTOS, SHIRE, MINIMAL]) {
      expect(readCalendarConfig(JSON.parse(JSON.stringify(cfg)))).not.toBe(null);
    }
  });
});

// S367 critic K1: a hand-edited or foreign config with a bad step size used to
// pass the reader and hang absoluteYear (tab freeze).
describe('malformed step sizes (S367 critic K1)', () => {
  const base = { version: 1, grain: 'day' };
  it('the reader rejects non-positive, fractional or non-finite divisors and step sizes', () => {
    const bad: unknown[] = [
      { ...base, bundles: { months: { names: ['Frost', 'Thaw'], lengths: [-30, 10] } } },
      { ...base, bundles: { months: { names: ['Frost'], lengths: [0] } } },
      { ...base, bundles: { months: { names: ['Frost'], lengths: [2.5] } } },
      { ...base, bundles: { months: { names: ['Frost'], lengths: ['30'] } } },
      { ...base, bundles: { year: { steps: -5 } } },
      { ...base, bundles: { year: { steps: 0 } } },
      { ...base, bundles: { year: { steps: Infinity } } },
      { ...base, bundles: { year: {} } },
      { ...base, bundles: { week: { length: 0, names: [] } } },
      { ...base, bundles: { week: { length: 3, names: 'abc' } } },
      { ...base, bundles: { months: { names: ['a'], lengths: [30] } }, intercalary: [{ name: 'Leap', after_month: 1, every_years: 0 }] },
      { ...base, bundles: { months: { names: ['a'], lengths: [30] } }, intercalary: [{ name: 'Leap', after_month: 1, every_years: -4 }] },
    ];
    for (const cfg of bad) expect(readCalendarConfig(cfg), JSON.stringify(cfg)).toBe(null);
  });

  /** A config whose `bundles` read throws after `limit` reads: a hang turns into a failure. */
  function tripwire(bundles: CalendarConfig['bundles'], limit = 1_000_000): CalendarConfig {
    let reads = 0;
    return {
      version: 1, grain: 'day',
      get bundles() {
        reads += 1;
        if (reads > limit) throw new Error('runaway loop: absoluteYear never exits');
        return bundles;
      },
    } as CalendarConfig;
  }

  it('absoluteYear and formatStep terminate on a config that slips the reader', () => {
    const negMonth = tripwire({ months: { names: ['Frost', 'Thaw'], lengths: [-30, 10] } });
    expect(Number.isFinite(absoluteYear(negMonth, 100))).toBe(true);
    expect(typeof formatStep(tripwire({ months: { names: ['Frost', 'Thaw'], lengths: [-30, 10] } }), 100)).toBe('string');
    const negYear = tripwire({ year: { steps: -5 } });
    expect(Number.isFinite(absoluteYear(negYear, 100))).toBe(true);
    expect(typeof formatStep(tripwire({ year: { steps: -5 } }), 100)).toBe('string');
  });

  it('the bound never bites a valid calendar far from zero (leap-aware seed)', () => {
    for (const step of [0, 1, -1, 1e9, -1e9, 1e12, -1e12]) {
      const y = absoluteYear(HARPTOS, step);
      expect(yearStartStep(HARPTOS, y)).toBeLessThanOrEqual(step);
      expect(yearStartStep(HARPTOS, y + 1)).toBeGreaterThan(step);
    }
    // One step per month, a festival every year: the old seed was off by half the step count.
    const dense: CalendarConfig = {
      version: 1, grain: 'day',
      bundles: { months: { names: ['a'], lengths: [1] } },
      intercalary: [{ name: 'F', after_month: 1, every_years: 1 }, { name: 'G', after_month: 0, every_years: 3 }],
    };
    for (const step of [0, 7, -7, 5_000_000, -5_000_000]) {
      const y = absoluteYear(dense, step);
      expect(yearStartStep(dense, y)).toBeLessThanOrEqual(step);
      expect(yearStartStep(dense, y + 1)).toBeGreaterThan(step);
    }
  });
});

describe('a down era with a mid-year pivot (Quillon h58 #8962)', () => {
  // Day grain, two 10-day months, a down era and an up era both pivoting at
  // step 5, half way through a month. What Atlas shows, typed back into the
  // timeline, must land on the same step on both sides of the pivot; SDK 4.42.2
  // moved the display and left parseDate's inverse, so dates before the pivot
  // parsed a year early. Held for the SDK bump past 4.42.2 (4.42.3).
  const MIDYEAR: CalendarConfig = {
    version: 1,
    grain: 'day',
    eras: [
      { name: 'Before Gate', abbrev: 'BG', start: 5, direction: 'down', restart: true },
      { name: 'After Gate', abbrev: 'AG', start: 5, restart: true },
    ],
    bundles: { months: { names: ['Frost', 'Thaw'], lengths: [10, 10] } },
    format: '{day} {month}, {year} {era}',
  };

  it('every step from 60 before the pivot to 60 after reads back as itself', () => {
    const misses: string[] = [];
    for (let step = -55; step <= 65; step++) {
      const words = formatStep(MIDYEAR, step);
      const r = parseDate(MIDYEAR, words);
      const back = isParseError(r) ? 'error' : r.step;
      if (back !== step) misses.push(`${step} "${words}" -> ${back}`);
    }
    expect(misses).toEqual([]);
  });
});
