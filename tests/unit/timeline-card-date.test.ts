/**
 * The docked card's click-to-edit date: Enter on the
 * untouched prefill must write nothing, and a lens that cannot round-trip the
 * stored value exactly must prefill the raw stored number, not a lossy form.
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { mountTimelineView } from '../../src/visualization/timeline/timeline-view';
import type { TimelineNode } from '../../src/visualization/timeline/types';
import type { CalendarConfig } from '@onlyworlds/sdk';

beforeAll(() => {
  (globalThis as any).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  (HTMLCanvasElement.prototype as any).getContext = () => null;
});
afterEach(() => { document.body.innerHTML = ''; });

function node(id: string, startDate: number): TimelineNode {
  return {
    id, elementType: 'event', name: 'The Siege', startDate, endDate: null,
    color: '#f00', dateSpec: { kind: 'exact', value: startDate }, links: [], degree: 0, contentMass: 0,
  } as TimelineNode;
}

/** Mount, select the node, click the card date, optionally type, press Enter. */
function openAndEnter(n: TimelineNode, calendar: CalendarConfig | null, typed?: string) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const onDateElement = vi.fn();
  const h = mountTimelineView(target, {
    onSelect: () => {}, onFocus: () => {}, onOpenElement: () => {}, onDateElement,
  });
  h.setNodes([n], [n], { now: null, calendar, undated: [], focusId: null, chartLabel: null });
  h.setSelection(n.id);
  target.querySelector<HTMLButtonElement>('.atlas-timeline-card-date')!.click();
  const input = document.querySelector<HTMLInputElement>('.atlas-edit-popover input')!;
  const prefill = input.value;
  if (typed != null) {
    input.value = typed;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  h.destroy();
  return { prefill, calls: onDateElement.mock.calls };
}

const MONTHS = { names: ['Frostwane', 'Greening'], lengths: [30, 30] };

describe('card date popover: a no-op Enter never moves the date', () => {
  it('lossy lens ("{month} {year}"): prefills the raw step and writes nothing', () => {
    const cal: CalendarConfig = { version: 1, grain: 'day', bundles: { months: MONTHS }, format: '{month} {year}' };
    const r = openAndEnter(node('e1', 60 * 454 + 11), cal);
    expect(r.prefill).toBe(String(60 * 454 + 11));
    expect(r.calls).toHaveLength(0);
  });

  it('duplicate month names: prefills the raw step and writes nothing', () => {
    const cal: CalendarConfig = {
      version: 1, grain: 'day',
      bundles: { months: { names: ['Dark', 'Light', 'Dark'], lengths: [10, 10, 10] } },
    };
    const r = openAndEnter(node('e2', 30 * 5 + 25), cal);
    expect(r.prefill).toBe(String(30 * 5 + 25));
    expect(r.calls).toHaveLength(0);
  });

  it('no lens: a fractional date prefills exactly and is not rounded by Enter', () => {
    const r = openAndEnter(node('e3', 1066.8), null);
    expect(r.prefill).toBe('1066.8');
    expect(r.calls).toHaveLength(0);
  });

  it('lossless lens: prefills the spoken date and still writes nothing on a no-op Enter', () => {
    const cal: CalendarConfig = { version: 1, grain: 'day', bundles: { months: MONTHS } };
    const r = openAndEnter(node('e4', 60 * 454 + 11), cal);
    expect(r.prefill).toBe('12 Frostwane, 454');
    expect(r.calls).toHaveLength(0);
  });

  it('a real edit still writes, through the lens or as a number', () => {
    const cal: CalendarConfig = { version: 1, grain: 'day', bundles: { months: MONTHS }, format: '{month} {year}' };
    const viaLens = openAndEnter(node('e5', 60 * 454 + 11), cal, 'Greening 454');
    expect(viaLens.calls).toEqual([['e5', 60 * 454 + 30, 'start']]);
    const bare = openAndEnter(node('e6', 1066.8), null, '1070');
    expect(bare.calls).toEqual([['e6', 1070, 'start']]);
  });
});
