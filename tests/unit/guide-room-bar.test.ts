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
  it('the first steps retired (1.115.0): no bar in the chart or the writing room, whatever the world holds', () => {
    world([ada, keep, ev], { guide_step: 'happened' });
    expect(roomBarStep('w', 'timeline')).toBeNull();
    expect(roomBarStep('w', 'writing')).toBeNull();
    world([ada, keep, ev, tale], { guide_step: 'story' });
    expect(roomBarStep('w', 'writing')).toBeNull();
    expect(roomBarStep('w', 'timeline')).toBeNull();
    // No pointer at all: the dots alone once drew it.
    world([ada, keep, ev]);
    expect(roomBarStep('w', 'timeline')).toBeNull();
    world([ada, keep, ev, tale]);
    expect(roomBarStep('w', 'writing')).toBeNull();
  });

  it('the step unlit (no dated Event): the card offers Create, not the room', () => {
    world([ada, keep, undated], { guide_step: 'happened' });
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
    block.innerHTML = '<div data-role="home-grid"><div data-grid-id="a" tabindex="-1">Ada</div><div data-grid-id="k" tabindex="0">Keep</div></div>';
    document.body.appendChild(block);
    return block;
  };

  it('the asking world\'s home takes it: the grid\'s own Tab stop focused (the home that grows)', () => {
    world([ada, keep, ev], { guide_step: 'happened' });
    askFocusAfterHome('w');
    const block = homeBlock();
    settleAfterDraw(block);
    expect(document.activeElement?.getAttribute('data-grid-id')).toBe('k');
    block.remove();
  });

  it('another world\'s home drops it (a switch before the draw), and it is gone after', () => {
    world([ada, keep, ev], { guide_step: 'happened' });
    askFocusAfterHome('elsewhere');
    const block = homeBlock();
    settleAfterDraw(block);
    expect(document.activeElement?.getAttribute('data-grid-id')).toBeNull();
    // The ask is spent: the next draw, now in the asking world, has nothing to take.
    settleAfterDraw(block);
    expect(document.activeElement?.getAttribute('data-grid-id')).toBeNull();
    block.remove();
  });
});

describe('mountGuideRoomBar', () => {
  it('the first steps retired (1.115.0): in the chart and the writing room the bar never shows, across ticks, and unmounts clean', () => {
    for (const [room, at] of [['timeline', 'happened'], ['writing', 'story']] as const) {
      world([ada, keep, ev, ...(room === 'writing' ? [tale] : [])], { guide_step: at });
      const host = document.createElement('div');
      host.appendChild(document.createElement('header'));
      const unmount = mountGuideRoomBar(host, room);
      const bar = host.querySelector<HTMLElement>('[data-role="guide-room-bar"]');
      expect(bar?.hidden ?? true, room).toBe(true);
      expect(bar?.textContent ?? '', room).not.toContain('Step ');
      // A tick that once drew it (the world at the step, the pointer gone) still draws nothing.
      world([ada, keep, ev, ...(room === 'writing' ? [tale] : [])]);
      expect(bar?.hidden ?? true, room).toBe(true);
      unmount();
      expect(host.querySelector('[data-role="guide-room-bar"]')).toBeNull();
    }
  });
});
