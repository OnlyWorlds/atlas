/**
 * A calendar past the standard's size limits (serial 149: 256 eras, 64
 * months, ...) is refused by every reader, so its dates show as numbers. Its
 * owner keeps a way back: the calendar menu lists it with the limit it passes,
 * and the builder opens it with its own eras and months loaded (the SDK's
 * `readCalendarShape`, 4.217.0), the preview and Save refused until the limit
 * passes. Found by Seethe's read of 1.125.42, where it left the menu with no
 * word and the builder would have opened it empty.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { CalendarBuilderModal } from '../../src/ui/calendar-builder-modal';
import { calendarsPastLimits, worldCalendars } from '../../src/core/calendar-lens';
import type { Element } from '../../src/core/types';

const toasts = { success: vi.fn(), error: vi.fn(), show: vi.fn() } as any;
const months = { names: ['Ash', 'Bloom'], lengths: [30, 31] };
const eras = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Era ${i}`, start: i * 1000 }));
const cal = (id: string, name: string, atlas_calendar: unknown) =>
  ({ id, type: 'construct', name, supertype: 'calendar', atlas_calendar }) as unknown as Element;

const BIG = cal('cal-big', 'The Long Count', { version: 1, grain: 'day', eras: eras(300), bundles: { months } });
const FINE = cal('cal-fine', 'The Almanac', { version: 1, grain: 'day', eras: eras(3), bundles: { months } });
const BROKEN = cal('cal-broken', 'Torn', { version: 1, grain: 'day', bundles: { months: { names: ['A'], lengths: [] } } });

afterEach(() => { document.body.innerHTML = ''; setActiveStore(null); toasts.error.mockClear(); });

describe('a calendar past the limits', () => {
  it('is listed with the limit it passes; a fine or a broken one is not', () => {
    expect(calendarsPastLimits([BIG, FINE, BROKEN])).toEqual([{ id: 'cal-big', name: 'The Long Count', limit: 'A calendar holds at most 256 eras' }]);
    expect(worldCalendars([BIG, FINE, BROKEN]).map(c => c.id)).toEqual(['cal-fine']);
  });

  it('a JSON string value is read the same', () => {
    const asText = cal('cal-big', 'The Long Count', JSON.stringify((BIG as any).atlas_calendar));
    expect(calendarsPastLimits([asText])).toHaveLength(1);
  });

  it('opens in the builder with its own eras, the preview and Save refused', async () => {
    patchSlice('active', { worldId: 'w1', meta: { time_basic_unit: 'day' } } as any);
    patchSlice('data', { elements: [BIG] } as any);
    const updateElement = vi.fn(async () => {});
    setActiveStore({ updateElement, createElement: vi.fn(), listElements: async () => [BIG] } as any);
    new CalendarBuilderModal(toasts, { elementId: 'cal-big', sampleSteps: [0, 454] }).open();
    expect(document.querySelectorAll('[data-row^="era:"]').length).toBe(300);
    expect(document.querySelectorAll('[data-row^="month:"]').length).toBe(2);
    const preview = document.querySelector('[data-role="preview"]')!;
    expect(preview.textContent).toContain('A calendar holds at most 256 eras');
    expect(preview.querySelector('.atlas-calbuilder-preview-date')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-action="save-calendar"]')!.click();
    await new Promise(r => setTimeout(r, 0));
    expect(updateElement).not.toHaveBeenCalled();
    expect(toasts.error).toHaveBeenCalledWith('A calendar holds at most 256 eras');
  });
});
