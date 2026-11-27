/**
 * Calendar lens resolution (2B design §3/§4): detection by atlas_calendar
 * presence (never supertype), dangling-id degrade, JSON-string tolerance,
 * and the saved-chart lens id-swap rewrite.
 */
import { describe, it, expect } from 'vitest';
import { worldCalendars, resolveCalendarLens, readCalendarValue } from '../../src/core/calendar-lens';
import { rewriteChartScopeIds } from '../../src/visualization/timeline/charts-store';
import { setWorldActiveCalendar, loadRegistry } from '../../src/registry/registry';
import type { Element } from '../../src/core/types';
import type { ChartConfig } from '../../src/visualization/timeline/types';

const CONFIG = {
  version: 1,
  grain: 'year',
  eras: [{ name: 'Third Age', abbrev: 'TA', start: 0 }],
  format: '{year} {era}',
};

function el(partial: Partial<Element> & { id: string; type: Element['type']; name: string }): Element {
  return { local_updated_at: '2026-07-14T00:00:00.000Z', ...partial } as Element;
}

describe('worldCalendars', () => {
  it('detects by atlas_calendar presence, never by supertype', () => {
    const elements: Element[] = [
      el({ id: 'c1', type: 'construct', name: 'Imperial Reckoning', supertype: 'calendar', atlas_calendar: CONFIG } as never),
      // Lore-only "Calendar" Construct: supertype says calendar, no config —
      // must NOT surface as a lens (a case raised in review).
      el({ id: 'c2', type: 'construct', name: 'The Old Calendar', supertype: 'Calendar' }),
      // Config on a non-construct still counts (presence is the whole rule).
      el({ id: 'c3', type: 'phenomenon', name: 'Tide Count', atlas_calendar: CONFIG } as never),
    ];
    const found = worldCalendars(elements);
    expect(found.map(c => c.id)).toEqual(['c1', 'c3']);
  });
  it('accepts a JSON-string config (foreign serialization) and skips malformed ones', () => {
    const elements: Element[] = [
      el({ id: 's1', type: 'construct', name: 'Stringy', atlas_calendar: JSON.stringify(CONFIG) } as never),
      el({ id: 's2', type: 'construct', name: 'Broken', atlas_calendar: '{not json' } as never),
      el({ id: 's3', type: 'construct', name: 'Wrong shape', atlas_calendar: { version: 9 } } as never),
    ];
    const found = worldCalendars(elements);
    expect(found.map(c => c.id)).toEqual(['s1']);
  });
});

describe('readCalendarValue (the one shared tolerant read)', () => {
  // The builder's edit path MUST use this: an object-only read loads an empty
  // draft for a string-config calendar and saving would blank the real config.
  it('reads objects and JSON strings identically, null for junk', () => {
    expect(readCalendarValue(CONFIG)?.grain).toBe('year');
    expect(readCalendarValue(JSON.stringify(CONFIG))?.grain).toBe('year');
    expect(readCalendarValue(JSON.stringify(CONFIG))?.eras?.[0].name).toBe('Third Age');
    expect(readCalendarValue('{not json')).toBe(null);
    expect(readCalendarValue(null)).toBe(null);
    expect(readCalendarValue(42)).toBe(null);
  });
});

describe('resolveCalendarLens', () => {
  const elements: Element[] = [
    el({ id: 'c1', type: 'construct', name: 'Imperial', atlas_calendar: CONFIG } as never),
  ];
  it('resolves a live id and degrades dangling/null to bare numbers', () => {
    expect(resolveCalendarLens(elements, 'c1')?.name).toBe('Imperial');
    expect(resolveCalendarLens(elements, 'gone')).toBe(null);
    expect(resolveCalendarLens(elements, null)).toBe(null);
    expect(resolveCalendarLens([], 'c1')).toBe(null);
  });

  // A world holding exactly one calendar, whose owner has never opened
  // the lens menu, should speak that calendar rather than bare numbers.
  it('falls back to the ONLY calendar when a lens was never chosen', () => {
    expect(resolveCalendarLens(elements, undefined, { fallbackToOnly: true, world: null })?.name)
      .toBe('Imperial');
  });

  it('respects an EXPLICIT no-calendar choice even when one exists', () => {
    // null is the menu's "no calendar"; falling back here would make the
    // choice impossible to hold while the world has a calendar.
    expect(resolveCalendarLens(elements, null, { fallbackToOnly: true, world: null })).toBe(null);
  });

  it('does not guess when the world has more than one calendar', () => {
    const two: Element[] = [
      ...elements,
      el({ id: 'c2', type: 'construct', name: 'Guild', atlas_calendar: CONFIG } as never),
    ];
    expect(resolveCalendarLens(two, undefined, { fallbackToOnly: true, world: null })).toBe(null);
  });

  // The calendar profile's "Which calendar speaks" (serial 147): the World
  // names its calendar in x_calendar, and a reader with no choice made on this
  // device speaks that one.
  describe("the World's own x_calendar", () => {
    const two: Element[] = [
      ...elements,
      el({ id: 'c2', type: 'construct', name: 'Guild', atlas_calendar: CONFIG } as never),
      el({ id: 'lore', type: 'construct', name: 'No calendar here' }),
    ];
    it('speaks the calendar the World names, among several', () => {
      expect(resolveCalendarLens(two, undefined, { fallbackToOnly: true, world: { x_calendar: 'c2' } })?.name).toBe('Guild');
    });
    it('a person\'s own pick on this device wins over the World\'s', () => {
      expect(resolveCalendarLens(two, 'c1', { fallbackToOnly: true, world: { x_calendar: 'c2' } })?.name).toBe('Imperial');
      expect(resolveCalendarLens(two, null, { fallbackToOnly: true, world: { x_calendar: 'c2' } })).toBe(null);
    });
    it('a name that points at nothing usable speaks no calendar, never the only one in its place', () => {
      for (const x of ['gone', 'lore', '', 'C1', 42, {}]) {
        expect(resolveCalendarLens(elements, undefined, { fallbackToOnly: true, world: { x_calendar: x } })).toBe(null);
      }
    });
    it('a World that names none (absent or null) falls back to the only calendar', () => {
      expect(resolveCalendarLens(elements, undefined, { fallbackToOnly: true, world: {} })?.id).toBe('c1');
      expect(resolveCalendarLens(elements, undefined, { fallbackToOnly: true, world: { x_calendar: null } })?.id).toBe('c1');
      expect(resolveCalendarLens(elements, undefined, { fallbackToOnly: true, world: undefined })?.id).toBe('c1');
    });
    it('the saved-chart path reads no World', () => {
      expect(resolveCalendarLens(two, undefined)).toBe(null);
    });
  });

  it('is opt-in: the saved-chart path keeps resolving strictly', () => {
    // A chart saved with no lens must reopen with no lens, not adopt a
    // calendar minted after it was saved.
    expect(resolveCalendarLens(elements, undefined)).toBe(null);
  });
});

describe('saved-chart lens id-swap (gate 2026-07-14)', () => {
  it('rewrites calendarId alongside scope ids', () => {
    const charts: ChartConfig[] = [{
      schema_version: 1, id: 'ch1', name: 'Fall of the Empire',
      axis: { kind: 'time', direction: 'both' },
      scope: { kind: 'all' }, render: '2d',
      calendarId: 'old-cal',
    }];
    const { charts: next, changed } = rewriteChartScopeIds(charts, 'old-cal', 'new-cal');
    expect(changed).toBe(true);
    expect(next[0].calendarId).toBe('new-cal');
    expect(next[0].scope).toEqual({ kind: 'all' });
  });
  it('leaves unrelated charts untouched (no false change flag)', () => {
    const charts: ChartConfig[] = [{
      schema_version: 1, id: 'ch1', name: 'X',
      axis: { kind: 'time', direction: 'both' },
      scope: { kind: 'all' }, render: '2d',
      calendarId: 'keep',
    }];
    const { charts: next, changed } = rewriteChartScopeIds(charts, 'other', 'new');
    expect(changed).toBe(false);
    expect(next).toBe(charts);
  });
});

describe('registry active-calendar lens', () => {
  it('sets and clears the per-world active lens', () => {
    const reg = loadRegistry();
    const withWorld = { ...reg, worlds: [...reg.worlds, {
      id: 'w1', name: 'W', state: 'local-only' as const,
      folder: { handle_key: 'k', folder_name: 'w' },
      created_at: '2026-07-14T00:00:00.000Z',
    }] };
    const set = setWorldActiveCalendar(withWorld, 'w1', 'cal-1');
    expect(set.worlds.find(w => w.id === 'w1')?.active_calendar_id).toBe('cal-1');
    const cleared = setWorldActiveCalendar(set, 'w1', null);
    expect(cleared.worlds.find(w => w.id === 'w1')?.active_calendar_id).toBe(null);
  });
});
