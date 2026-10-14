/**
 * Calendar-axis geometry tests — ticks at real unit boundaries with era-local
 * ROUND display years, rung selection by zoom, era landmark pruning, era
 * bands, and the season segmentation. Fixtures mirror calendar.test.ts
 * (Kirrowmoss / Dune / Vessach / Harptos).
 */
import { describe, it, expect } from 'vitest';
import type { CalendarConfig } from '@onlyworlds/sdk';
import {
  calendarTicks, eraBandsInRange, seasonBandsInRange, inEraGap,
} from '../../src/core/calendar-axis';

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
      lengths: [30, 28, 32, 30, 31, 29, 30, 28, 32, 30, 29, 31], // 360
    },
    week: { length: 6, names: ['Ondel', 'Tresk', 'Mireth', 'Aldun', 'Volk', 'Hearth'], mode: 'free' },
  },
  format: '{day} {month}, Year {year} {era}',
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

const VESSACH: CalendarConfig = {
  version: 1,
  grain: 'year',
  eras: [
    { name: 'First Age', abbrev: 'FA', start: -20000, end: -10000, restart: true, year_base: 0 },
    { name: 'Third Age', abbrev: 'TA', start: 0, restart: true, year_base: 0 },
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
  },
  intercalary: [
    { name: 'Midsummer', after_month: 7 },
    { name: 'Shieldmeet', after_month: 7, every_years: 4 },
  ],
  format: '{day} {month}, {year} {era}',
  format_intercalary: '{intercalary}, {year} {era}',
};

/** Linear step→px over [min,max] for a given width — the caller's dateToX. */
const linearToX = (min: number, max: number, w: number) =>
  (step: number): number => ((step - min) / (max - min)) * w;

describe('calendarTicks — year rung', () => {
  it('lands on era-local ROUND display years, never raw step multiples', () => {
    const min = -36000; const max = 7200; const w = 1000;
    const ticks = calendarTicks(KIRROWMOSS, min, max, w, linearToX(min, max, w));
    const yearTicks = ticks.filter(t => t.rung === 'year');
    expect(yearTicks.length).toBeGreaterThan(2);
    for (const t of yearTicks) {
      const m = t.label.match(/^(\d+) (KR|OC|FT)$/);
      expect(m, `label "${t.label}" should be a round era year`).toBeTruthy();
      expect(Number(m![1]) % 25).toBe(0); // stride 25 at this zoom
    }
  });

  it('marks era domain boundaries as landmark ticks', () => {
    const min = -36000; const max = 7200; const w = 1000;
    const ticks = calendarTicks(KIRROWMOSS, min, max, w, linearToX(min, max, w));
    const eraTicks = ticks.filter(t => t.rung === 'era');
    expect(eraTicks.map(t => t.step)).toContain(-3600); // OC start
    expect(eraTicks.map(t => t.step)).toContain(0);     // FT start
    expect(eraTicks.find(t => t.step === 0)?.label).toBe('1 FT');
    expect(eraTicks.find(t => t.step === -3600)?.label).toBe('1 OC');
  });

  it('down-era ticks count in round B.G. years toward the pivot', () => {
    const min = -500; const max = 500; const w = 1000;
    const ticks = calendarTicks(DUNE, min, max, w, linearToX(min, max, w));
    const labels = ticks.map(t => t.label);
    expect(labels).toContain('250 B.G.');
    // Pivot 0 is A.G. territory and a landmark.
    expect(ticks.find(t => t.step === 0)?.rung).toBe('era');
    expect(ticks.find(t => t.step === 0)?.label).toBe('0 A.G.'); // year_base 0
  });

  it('a vast span stays bounded and fast', () => {
    const min = -1_000_000; const max = 1_000_000; const w = 1000;
    const ticks = calendarTicks(KIRROWMOSS, min, max, w, linearToX(min, max, w));
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThan(60);
  });

  it('deep time spreads year ticks across the WHOLE axis, not the first 400 strides (S367 critic K4)', () => {
    const cfg: CalendarConfig = { version: 1, grain: 'year', eras: [{ name: 'Aeon', abbrev: 'AE', start: 0 }] };
    const min = 0; const max = 100_000_000; const w = 1000;
    const toX = linearToX(min, max, w);
    const years = calendarTicks(cfg, min, max, w, toX).filter(t => t.rung === 'year');
    expect(years.length).toBeGreaterThanOrEqual(3);
    expect(years.length).toBeLessThan(20);
    expect(Math.max(...years.map(t => t.step))).toBeGreaterThan(max * 0.6);
    const xs = years.map(t => toX(t.step)).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(60);
  });
});

describe('calendarTicks — month rung', () => {
  it('ticks month starts by name; year starts keep the year label', () => {
    const min = 0; const max = 720; const w = 1200; // 2 Kirrowmoss years
    const ticks = calendarTicks(KIRROWMOSS, min, max, w, linearToX(min, max, w));
    const monthTicks = ticks.filter(t => t.rung === 'month');
    expect(monthTicks.length).toBeGreaterThan(3);
    // Month labels are bare names (no year, no era — the year ticks carry those).
    for (const t of monthTicks) expect(t.label).toMatch(/^[A-Z][a-z]+$/);
    // Greening opens at 30 + 28 = 58.
    expect(monthTicks.find(t => t.step === 58)?.label).toBe('Greening');
    // The year boundary speaks the year, not "Sowmarch".
    const at360 = ticks.find(t => t.step === 360);
    expect(at360?.label).toBe('2 FT');
  });
});

describe('calendarTicks — day rung', () => {
  it('strides days anchored at day 1 with mid-rung labels (no era word)', () => {
    const min = 0; const max = 60; const w = 1200;
    const ticks = calendarTicks(KIRROWMOSS, min, max, w, linearToX(min, max, w));
    const dayTicks = ticks.filter(t => t.rung === 'day');
    expect(dayTicks.length).toBeGreaterThan(2);
    expect(dayTicks.find(t => t.step === 10)?.label).toBe('11 Sowmarch 1');
    for (const t of dayTicks) expect(t.label).not.toMatch(/FT|KR|OC/);
  });

  it('intercalary days tick by name at day zoom', () => {
    // Harptos leap year 0: Midsummer (step 210) + Shieldmeet (211) after month 7.
    // Zoomed tight enough that adjacent-step labels both fit.
    const min = 205; const max = 215; const w = 1400;
    const ticks = calendarTicks(HARPTOS, min, max, w, linearToX(min, max, w));
    const labels = ticks.map(t => t.label);
    expect(labels.some(l => l.startsWith('Midsummer'))).toBe(true);
    expect(labels.some(l => l.startsWith('Shieldmeet'))).toBe(true);
    // At coarser zoom the two collide and pruning keeps exactly one — never a smear.
    const coarse = calendarTicks(HARPTOS, 190, 230, 1400, linearToX(190, 230, 1400));
    const festivals = coarse.filter(t => /^(Midsummer|Shieldmeet)/.test(t.label));
    expect(festivals.length).toBe(1);
  });

  it('era landmarks outrank colliding day ticks', () => {
    const min = -30; const max = 30; const w = 1200;
    const ticks = calendarTicks(KIRROWMOSS, min, max, w, linearToX(min, max, w));
    const at0 = ticks.filter(t => Math.abs(t.step) < 6);
    expect(at0.some(t => t.rung === 'era' && t.step === 0)).toBe(true);
  });
});

describe('eraBandsInRange', () => {
  it('clips domains to the window and indexes them in order', () => {
    const bands = eraBandsInRange(KIRROWMOSS, -40000, 7200);
    expect(bands.map(b => [b.era.abbrev, b.lo, b.hi])).toEqual([
      ['KR', -40000, -3600],
      ['OC', -3600, 0],
      ['FT', 0, 7200],
    ]);
    expect(bands.map(b => b.index)).toEqual([0, 1, 2]);
  });

  it('a real era gap yields NO band (the gap is unshaded)', () => {
    const bands = eraBandsInRange(VESSACH, -15000, 5000);
    expect(bands.map(b => b.era.abbrev)).toEqual(['FA', 'TA']);
    expect(bands[0].hi).toBe(-10000);
    expect(bands[1].lo).toBe(0);
  });
});

describe('seasonBandsInRange', () => {
  it('segments months with rising frac, intercalary runs flagged', () => {
    // Exactly leap year 0: length 362 (360 + Midsummer + Shieldmeet), steps 0..361.
    const bands = seasonBandsInRange(HARPTOS, 0, 361);
    const months = bands.filter(b => !b.intercalary);
    const inter = bands.filter(b => b.intercalary);
    expect(months.length).toBe(12);
    expect(inter.map(i => i.name)).toContain('Midsummer');
    expect(inter.map(i => i.name)).toContain('Shieldmeet'); // leap year 0
    const fracs = months.map(m => m.frac);
    expect([...fracs].sort((a, b) => a - b)).toEqual(fracs); // rises through the year
  });

  it('a non-leap year omits the leap festival', () => {
    const y1 = seasonBandsInRange(HARPTOS, 362, 362 + 361);
    expect(y1.filter(b => b.intercalary).map(b => b.name)).not.toContain('Shieldmeet');
  });

  it('returns nothing over wide windows or monthless calendars', () => {
    expect(seasonBandsInRange(KIRROWMOSS, 0, 360 * 30).length).toBe(0);
    expect(seasonBandsInRange(DUNE, 0, 10).length).toBe(0);
  });
});

describe('inEraGap', () => {
  it('true only inside a real gap of an era-bearing calendar', () => {
    expect(inEraGap(VESSACH, -5000)).toBe(true);   // the disputed Second Age
    expect(inEraGap(VESSACH, 5)).toBe(false);
    expect(inEraGap(VESSACH, -25000)).toBe(true);  // before the first era
    const noEras: CalendarConfig = { version: 1, grain: 'day' };
    expect(inEraGap(noEras, 0)).toBe(false);
  });
});
