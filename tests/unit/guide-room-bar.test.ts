/**
 * The guide's bar in a room (#975): shown exactly when the home would draw the
 * card at this room's step with its dot lit, read from the world.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { resetGuidePathForTests } from '../../src/core/guide-path';
import { mountGuideRoomBar, roomBarStep, roomBarWords } from '../../src/middle/guide-room-bar';
import { askFocusAfterHome, settleAfterDraw } from '../../src/middle/home-guide';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const E = (n: number, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: uuid(n), type, name, ...extra }) as unknown as Element;
const keep = E(2, 'location', 'Keep');
const ada = E(1, 'character', 'Ada', { location: keep.id });
const ev = E(3, 'event', 'Founding', { start_date: 120 });
const undated = E(5, 'event', 'Rumour');
const tale = E(4, 'narrative', 'Tale', { supertype: 'Book' });

function world(elements: Element[], entry: Partial<WorldRegistryEntry> = {}, id = 'w'): void {
  const e = { id, name: 'W', where: 'folder', state: 'local-only', ...entry } as unknown as WorldRegistryEntry;
  patchSlice('registry', { worlds: [e] } as never);
  patchSlice('active', { worldId: id, meta: { name: 'W' } } as never);
  patchSlice('data', { elements, loading: false } as never);
}

afterEach(() => {
  resetGuidePathForTests();
  patchSlice('active', null);
  try { localStorage.clear(); } catch { /* */ }
});

describe('roomBarStep', () => {
  it('the chart at step 3 with a dated Event; the writing room at step 4 with a story', () => {
    world([ada, keep, ev], { guide_step: 'happened' });
    expect(roomBarStep('w', 'timeline')).toBe('happened');
    expect(roomBarStep('w', 'writing')).toBeNull();
    world([ada, keep, ev, tale], { guide_step: 'story' });
    expect(roomBarStep('w', 'writing')).toBe('story');
    expect(roomBarStep('w', 'timeline')).toBeNull();
  });

  it('the step unlit (no dated Event): the card offers Create, not the room', () => {
    world([ada, keep, undated], { guide_step: 'happened' });
    expect(roomBarStep('w', 'timeline')).toBeNull();
  });

  it('the card read from the dots (the home that grows): the bar shows at its step and the one after, whatever the pointer', () => {
    // The card at story (the step after the chart's): the chart's bar shows, a stale pointer ignored.
    world([ada, keep, ev], { guide_step: 'placed' });
    expect(roomBarStep('w', 'timeline')).toBe('happened');
    // The card past it (all lit, at the copy card): no bar in the chart, the writing room's still.
    world([ada, keep, ev, tale], { guide_step: 'placed' });
    expect(roomBarStep('w', 'timeline')).toBeNull();
    expect(roomBarStep('w', 'writing')).toBe('story');
    world([ada, keep, ev, tale], { guide_step: 'done' });
    expect(roomBarStep('w', 'timeline')).toBeNull();
    world([ada, keep, undated]);
    expect(roomBarStep('w', 'timeline')).toBeNull();
  });

  it('a demo, a dismissed home, a world not active or still loading draws nothing', () => {
    world([ada, keep, ev], { guide_step: 'happened', demo: true });
    expect(roomBarStep('w', 'timeline')).toBeNull();
    world([ada, keep, ev], { guide_step: 'happened', tour_dismissed: ['home-cards'] });
    expect(roomBarStep('w', 'timeline')).toBeNull();
    world([ada, keep, ev], { guide_step: 'happened' });
    expect(roomBarStep('other', 'timeline')).toBeNull();
    expect(roomBarStep(null, 'timeline')).toBeNull();
    patchSlice('data', { elements: [ada, keep, ev], loading: true } as never);
    expect(roomBarStep('w', 'timeline')).toBeNull();
  });

  it('the words name the step, never the element', () => {
    expect(roomBarWords('happened')).toBe('Step 3 of 5, Something happened');
    expect(roomBarWords('story')).toBe('Step 4 of 5, A story');
  });
});

describe('Back\'s focus ask', () => {
  const homeBlock = () => {
    const block = document.createElement('section');
    block.innerHTML = '<div data-role="guide-card"><button data-step-action="next">Next</button></div>';
    document.body.appendChild(block);
    return block;
  };

  it('the asking world\'s home takes it: Next focused', () => {
    world([ada, keep, ev], { guide_step: 'happened' });
    askFocusAfterHome('w');
    const block = homeBlock();
    settleAfterDraw(block);
    expect(document.activeElement?.getAttribute('data-step-action')).toBe('next');
    block.remove();
  });

  it('another world\'s home drops it (a switch before the draw), and it is gone after', () => {
    world([ada, keep, ev], { guide_step: 'happened' });
    askFocusAfterHome('elsewhere');
    const block = homeBlock();
    settleAfterDraw(block);
    expect(document.activeElement?.getAttribute('data-step-action')).toBeNull();
    // The ask is spent: the next draw, now in the asking world, has nothing to take.
    settleAfterDraw(block);
    expect(document.activeElement?.getAttribute('data-step-action')).toBeNull();
    block.remove();
  });
});

describe('mountGuideRoomBar', () => {
  it('first child, shown and hidden by the world, its node kept across ticks', () => {
    world([ada, keep, ev], { guide_step: 'happened' });
    const host = document.createElement('div');
    host.appendChild(document.createElement('header'));
    const unmount = mountGuideRoomBar(host, 'timeline');
    const bar = host.firstElementChild as HTMLElement;
    expect(bar.getAttribute('data-role')).toBe('guide-room-bar');
    expect(bar.hidden).toBe(false);
    expect(bar.querySelector('[data-action="guide-room-back"]')).not.toBeNull();
    // The world moves past the step after (a story made): the bar leaves; the story gone, it is back.
    world([ada, keep, ev, tale], { guide_step: 'happened' });
    expect(bar.hidden).toBe(true);
    world([ada, keep, ev], { guide_step: 'happened' });
    expect(bar.hidden).toBe(false);
    unmount();
    expect(host.querySelector('[data-role="guide-room-bar"]')).toBeNull();
  });
});
