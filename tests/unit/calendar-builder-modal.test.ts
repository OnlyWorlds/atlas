/**
 * Calendar builder edit path: saving an existing calendar
 * must keep the structure the form does not show (months, week and festival
 * days on a year-grain world, a coarse `bundles.year`, unknown keys) and must
 * never rewrite the stored grain.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { CalendarBuilderModal } from '../../src/ui/calendar-builder-modal';
import { validateCalendarConfig, eraForStep, formatStep, readCalendarConfig, type CalendarConfig } from '@onlyworlds/sdk';

const toasts = { success: vi.fn(), error: vi.fn(), show: vi.fn() } as any;

function setup(unit: string, cfg: unknown) {
  const el = { id: 'cal-1', type: 'construct', name: 'Imperial Reckoning', supertype: 'calendar', atlas_calendar: cfg };
  patchSlice('active', { worldId: 'w1', meta: { time_basic_unit: unit } } as any);
  patchSlice('data', { elements: [el] } as any);
  const updateElement = vi.fn(async () => {});
  const createElement = vi.fn(async () => ({ id: 'new-1' }));
  setActiveStore({ updateElement, createElement, listElements: async () => [el] } as any);
  return { updateElement, createElement };
}

function openBuilder(elementId?: string): HTMLElement {
  new CalendarBuilderModal(toasts, { elementId, sampleSteps: [0, 454] }).open();
  return document.querySelector<HTMLElement>('[data-modal="calendar-builder"]') ?? document.body;
}

async function save(): Promise<void> {
  document.querySelector<HTMLButtonElement>('[data-action="save-calendar"]')!.click();
  await new Promise(r => setTimeout(r, 0));
}

function written(fn: { mock: { calls: unknown[][] } }): CalendarConfig {
  return (fn.mock.calls[0] as any)[1].atlas_calendar;
}

afterEach(() => { document.body.innerHTML = ''; setActiveStore(null); toasts.error.mockClear(); });

const MONTHFUL = {
  version: 1, grain: 'day',
  eras: [{ name: 'After Empire', abbrev: 'AE', start: 0 }],
  bundles: {
    months: { names: ['Frostwane', 'Greening'], lengths: [30, 30] },
    week: { length: 5, names: ['a', 'b', 'c', 'd', 'e'], mode: 'free' },
  },
  intercalary: [{ name: 'Hearthmoot', after_month: 1 }],
  format_intercalary: '{intercalary} of {year}',
  x_foreign: { kept: true },
};

describe('calendar builder edit keeps what the form cannot show', () => {
  it('year-grain world: a no-change save keeps months, week, festival days, grain and unknown keys', async () => {
    const { updateElement } = setup('year', structuredClone(MONTHFUL));
    openBuilder('cal-1');
    // The form says why the structure is hidden rather than silently dropping it.
    expect(document.querySelector('[data-role="grain-note"]')?.textContent).toMatch(/day/);
    await save();
    expect(updateElement).toHaveBeenCalledTimes(1);
    expect(written(updateElement)).toEqual(MONTHFUL);
  });

  it('day-grain world: a coarse calendar keeps its year length on a no-change save', async () => {
    const cfg = { version: 1, grain: 'day', eras: [{ name: 'AE', start: 0 }], bundles: { year: { steps: 360 } } };
    expect(validateCalendarConfig(cfg as CalendarConfig)).toEqual([]);
    const { updateElement } = setup('day', structuredClone(cfg));
    openBuilder('cal-1');
    await save();
    expect(written(updateElement)).toEqual(cfg);
  });

  it('fields the form shows are still owned by it: a removed month and a new format land, the rest stays', async () => {
    const { updateElement } = setup('day', structuredClone(MONTHFUL));
    const root = openBuilder('cal-1');
    root.querySelector<HTMLButtonElement>('[data-remove="month:1"]')!.click();
    const fmt = root.querySelector<HTMLInputElement>('[data-field="format"]')!;
    fmt.value = '{day} {month} {year}';
    fmt.dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    const out = written(updateElement);
    expect(out.bundles?.months).toEqual({ names: ['Frostwane'], lengths: [30] });
    expect(out.format).toBe('{day} {month} {year}');
    expect(out.bundles?.week).toEqual(MONTHFUL.bundles.week);
    expect((out as any).x_foreign).toEqual({ kept: true });
    expect(out.grain).toBe('day');
  });

  it('an up era listed before a countdown era at its pivot keeps its order and reads right (SDK 4.76, 2026-10-25)', async () => {
    const after = { name: 'After', abbrev: 'AF', start: 0 };
    const before = { name: 'Before', abbrev: 'BF', start: 0, direction: 'down' as const };
    const { updateElement } = setup('year', { version: 1, grain: 'year', eras: [after, before] });
    openBuilder('cal-1');
    await save();
    const out = written(updateElement);
    expect(out.eras!.map(e => e.name)).toEqual(['After', 'Before']);
    expect(eraForStep(out, 5)?.name).toBe('After');
    expect(formatStep(out, 5)).toContain('6 AF');
  });

  it('a version 2 leap rule keeps its except and offset through a save the form does not draw them in (SDK 4.76)', async () => {
    const greg = {
      version: 2, grain: 'day',
      bundles: { months: { names: ['Jan', 'Feb', 'Mar'], lengths: [31, 28, 31] } },
      intercalary: [{ name: 'Leap day', after_month: 2, every_years: 4, except: [100, 400], offset: 1 }],
    };
    const { updateElement } = setup('day', greg);
    openBuilder('cal-1');
    await save();
    const out = written(updateElement) as CalendarConfig & { intercalary: Array<Record<string, unknown>> };
    expect(out.version).toBe(2);
    expect(out.intercalary[0]).toMatchObject({ name: 'Leap day', every_years: 4, except: [100, 400], offset: 1 });
  });

  it('a version 1 calendar stays version 1 when nothing uses except or offset', async () => {
    const { updateElement } = setup('day', { version: 1, grain: 'day', bundles: { months: { names: ['A'], lengths: [30] } }, intercalary: [{ name: 'Rest', after_month: 1, every_years: 4 }] });
    openBuilder('cal-1');
    await save();
    expect(written(updateElement).version).toBe(1);
  });

  it('create still stamps the world grain', async () => {
    const { createElement } = setup('day', null);
    const root = openBuilder();
    const name = root.querySelector<HTMLInputElement>('[data-field="name"]')!;
    name.value = 'New Reckoning';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    expect((createElement.mock.calls[0] as any)[1].atlas_calendar).toEqual({ version: 1, grain: 'day' });
  });

  it('a blank world clock unit never writes an empty grain (the profile requires one, SDK 4.102.5)', async () => {
    const { createElement } = setup('', null);
    const root = openBuilder();
    const name = root.querySelector<HTMLInputElement>('[data-field="name"]')!;
    name.value = 'Blank Reckoning';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await save();
    const cfg = (createElement.mock.calls[0] as any)[1].atlas_calendar;
    expect(cfg.grain).toBe('step');
    expect(readCalendarConfig(cfg)).not.toBeNull();
  });
});
