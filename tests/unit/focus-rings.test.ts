/**
 * Focus rings painted whole. jsdom lays nothing out and paints nothing, so
 * these read the rules themselves; the measure on a real page is a keyboard
 * walk's ring census.
 *
 * - A field section clips its overflow (rounded corners), so the global ring,
 *   drawn 2px outside its control, showed only the header's bottom edge: the
 *   header's ring is drawn inside its box, as the tab bar's is.
 * - The scroll view fades its cards toward the viewport's edges. An opacity on
 *   the card fades its head's ring too (0.79 read as another colour), so the
 *   fade is a custom property: the card is whole while its head shows a ring,
 *   and the fade moves to the card's parts.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountScrollView } from '../../src/visualization/timeline/scroll-view';
import type { TimelineNode } from '../../src/visualization/timeline/types';

const css = (): string => readFileSync(resolve(process.cwd(), 'src/styles/atlas.css'), 'utf8');

/** The body of the one rule whose selector is exactly `selector`. */
function ruleBody(selector: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css().match(new RegExp(`\\n${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

describe("the field section header's ring", () => {
  it('the section still clips (the reason), and the header draws its ring inside its box', () => {
    expect(ruleBody('.atlas-detail-section')).toMatch(/overflow:\s*hidden/);
    const body = ruleBody('.atlas-detail-section-header:focus-visible');
    expect(body, 'a ring rule for the section header').not.toBeNull();
    // As wide inside as the ring is thick (the global ring is 2px): all four edges inside the box.
    expect(body!).toMatch(/outline-offset:\s*-2px/);
    // The width and colour stay the global ring's (the theme's cyan): no literal of its own.
    expect(body!).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });
});

describe("the scroll card head's ring", () => {
  const HAS = '.atlas-scroll-card:has(.atlas-scroll-card-head:focus-visible)';

  it('the card fades by a custom property, and stays whole while its head shows a ring', () => {
    expect(ruleBody('.atlas-scroll-card')!).toMatch(/opacity:\s*var\(--atlas-scroll-fade,\s*1\)/);
    const whole = ruleBody(HAS);
    expect(whole, 'the card whole while its head has a ring').not.toBeNull();
    expect(whole!).toMatch(/opacity:\s*1\s*;/);
  });

  it("the fade moves to the card's parts, never the head itself", () => {
    const text = css();
    const at = text.indexOf(`\n${HAS} :is(`);
    expect(at, 'the parts rule').toBeGreaterThan(-1);
    const open = text.indexOf('{', at);
    const parts = text.slice(at, open);
    const body = text.slice(open, text.indexOf('}', open));
    expect(parts).toContain('.atlas-scroll-card-dot');
    expect(parts).toContain('.atlas-scroll-card-body > :not(.atlas-scroll-card-head)');
    expect(parts).toContain('.atlas-scroll-card-head > *');
    expect(body).toMatch(/opacity:\s*var\(--atlas-scroll-fade,\s*1\)/);
  });

  describe('as the view sets it', () => {
    beforeAll(() => {
      (globalThis as Record<string, unknown>).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
    });
    afterEach(() => { document.body.innerHTML = ''; });

    it('a scroll sets the fade as the custom property, never the card\'s own opacity', async () => {
      const target = document.createElement('div');
      document.body.appendChild(target);
      const h = mountScrollView(target, { onSelect: () => {}, onFocus: () => {}, onOpenElement: () => {} });
      const node = {
        id: 'e1', elementType: 'event', name: 'The crossing', startDate: 1200, endDate: 1250, color: '#f00',
        dateSpec: { kind: 'exact', value: 1200 }, links: [], degree: 0, contentMass: 0,
      } as unknown as TimelineNode;
      h.setNodes([node], [node], { now: null, calendar: null, undated: [], focusId: null, chartLabel: null });
      target.querySelector('.atlas-scroll-view')!.dispatchEvent(new Event('scroll'));
      await new Promise<void>(r => requestAnimationFrame(() => r()));
      const card = target.querySelector<HTMLElement>('.atlas-scroll-card')!;
      expect(card.style.getPropertyValue('--atlas-scroll-fade')).toMatch(/^\d\.\d{3}$/);
      expect(card.style.opacity).toBe('');
      h.destroy();
    });
  });
});
