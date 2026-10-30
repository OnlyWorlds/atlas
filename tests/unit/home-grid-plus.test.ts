/**
 * The plain + square (the home that grows, release b): its list of kinds by
 * keys, and a make from it never writes the path's pointer, so a world past
 * the path (no pointer, all five dots lit) gets no card back after a make.
 * The demo, Moppetopia and a view-only world draw no + and light nothing.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import { pathShowing } from '../../src/core/guide-path';
import { resetGridActsForTests } from '../../src/middle/home-grid-acts';

const made: { type: string; name: string }[] = [];
vi.mock('../../src/ui/home-grid-make', () => ({
  makeFromSquare: async (type: string, name: string) => { made.push({ type, name }); return { id: 'new', type }; },
}));

const { buildHomeGrid, mayPlace } = await import('../../src/middle/home-grow');

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const E = (n: number, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: uuid(n), type, name, ...extra }) as unknown as Element;
const keep = E(2, 'location', 'Keep');
const ada = E(1, 'character', 'Ada', { location: keep.id });
const ev = E(3, 'event', 'Founding', { start_date: 120 });
const tale = E(4, 'narrative', 'Tale', { supertype: 'Book' });

function world(elements: Element[], entry: Partial<WorldRegistryEntry> = {}): void {
  const e = { id: 'w', name: 'W', where: 'folder', state: 'local-only', ...entry } as unknown as WorldRegistryEntry;
  patchSlice('registry', { worlds: [e] } as never);
  patchSlice('active', { worldId: 'w', meta: { name: 'W' } } as never);
  patchSlice('data', { elements, loading: false } as never);
}

/** Home's grid drawn at a card width jsdom does not lay out. */
function drawn(): HTMLElement {
  const g = buildHomeGrid('w', () => {})!;
  document.body.appendChild(g.section);
  g.mount();
  return g.section;
}

/** The card's width as jsdom reports it, and the grid's resize observers: a test changes the one and calls the others to owe a redraw. */
let width = 600;
const observers: (() => void)[] = [];
const resize = (w: number): void => { width = w; for (const cb of observers) cb(); };

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return width; } });
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    constructor(cb: () => void) { observers.push(cb); }
    observe(): void {}
    disconnect(): void {}
  };
});
afterEach(() => {
  width = 600;
  observers.length = 0;
  resetGridActsForTests();
  document.body.innerHTML = '';
  made.length = 0;
  patchSlice('active', null);
});

const key = (el: EventTarget | null, k: string) => {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  (el as HTMLElement).dispatchEvent(e);
  return e;
};

describe('the plain +', () => {
  it('a world past the path draws it plain, "add", and a make from it never writes the pointer', async () => {
    world([ada, keep, ev, tale]);
    expect(pathShowing('w')).toBe(false);
    const section = drawn();
    const plus = section.querySelector<HTMLElement>('[data-grid-plus]')!;
    expect(plus.getAttribute('data-grid-plus')).toBe('any');
    expect(plus.textContent).toContain('add');
    plus.click();
    const menu = section.querySelector<HTMLElement>('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Add which kind');
    expect([...menu.querySelectorAll('[role="menuitem"]')].map(b => b.textContent))
      .toEqual(['a character', 'a location', 'an event', 'a story', 'Another kind…']);
    menu.querySelector<HTMLElement>('[data-kind="character"]')!.click();
    const name = section.querySelector<HTMLInputElement>('.atlas-home-grid-make input')!;
    name.value = 'Bren';
    key(name, 'Enter');
    await Promise.resolve();
    expect(made).toEqual([{ type: 'character', name: 'Bren' }]);
    expect(getState().registry.worlds[0].guide_step).toBeUndefined();
    expect(pathShowing('w')).toBe(false);
  });

  it('its list by keys: arrows move, Escape closes with the focus on the +, Enter picks', () => {
    world([ada, keep]);
    const section = drawn();
    const plus = section.querySelector<HTMLElement>('[data-grid-plus]')!;
    key(plus, 'Enter');
    let menu = section.querySelector<HTMLElement>('[role="menu"]')!;
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    expect(document.activeElement).toBe(items[0]);
    key(items[0], 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(items[1], 'ArrowUp');
    key(items[0], 'ArrowUp');
    expect(document.activeElement).toBe(items[4]);
    key(items[4], 'Escape');
    expect(section.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(plus);
    expect(plus.getAttribute('aria-expanded')).toBe('false');
    // Tab closes it too, the focus handed to the + for the browser's own Tab.
    key(plus, ' ');
    menu = section.querySelector<HTMLElement>('[role="menu"]')!;
    const tab = key(menu.querySelector('[role="menuitem"]'), 'Tab');
    expect(tab.defaultPrevented).toBe(false);
    expect(section.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(plus);
  });

  it('a press outside closes the list', () => {
    world([ada, keep]);
    const section = drawn();
    section.querySelector<HTMLElement>('[data-grid-plus]')!.click();
    expect(section.querySelector('[role="menu"]')).not.toBeNull();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(section.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('where the grid acts', () => {
  for (const [why, entry] of [
    ['the demo', { demo: true }],
    ['a view-only copy', { copy_of: { world_id: 'x', at: '2026-10-30T00:00:00Z' } }],
    ['a read key', { api: { read_only: true } }],
  ] as const) {
    it(`${why}: no + square and no target`, () => {
      world([E(1, 'character', 'Ada'), keep], entry as never);
      const section = drawn();
      expect(section.querySelector('[data-grid-plus]')).toBeNull();
      section.querySelector<HTMLElement>(`[data-grid-id="${uuid(1)}"]`)!.click();
      expect(section.querySelector('.is-selected')).not.toBeNull();
      expect(section.querySelector('.is-target')).toBeNull();
    });
  }
  it('a world of one\'s own: the + and the target', () => {
    world([E(1, 'character', 'Ada'), keep]);
    const section = drawn();
    expect(section.querySelector('[data-grid-plus]')).not.toBeNull();
    section.querySelector<HTMLElement>(`[data-grid-id="${uuid(1)}"]`)!.click();
    expect(section.querySelector('.is-target')).not.toBeNull();
  });
});

describe('a hold never outlives the person\'s attention', () => {
  const sqOf = (section: HTMLElement) => section.querySelector<HTMLElement>('[data-grid-plus]')!.style.getPropertyValue('--sq');
  const openBox = (section: HTMLElement): HTMLInputElement => {
    section.querySelector<HTMLElement>('[data-grid-plus]')!.click();
    section.querySelector<HTMLElement>('[data-kind="character"]')!.click();
    return section.querySelector<HTMLInputElement>('.atlas-home-grid-make input')!;
  };

  it('a kind picked after a redraw was owed opens its box on the live +, the focus in it (C2)', async () => {
    world([ada, keep]);
    const section = drawn();
    expect(sqOf(section)).toBe('64px');
    section.querySelector<HTMLElement>('[data-grid-plus]')!.click();
    // A resize while the list is open: owed, not drawn.
    resize(500);
    expect(section.querySelector('[role="menu"]')).not.toBeNull();
    expect(sqOf(section)).toBe('64px');
    section.querySelector<HTMLElement>('[data-kind="character"]')!.click();
    const live = section.querySelector<HTMLElement>('[data-grid-plus]')!;
    expect(live.querySelector('form')).not.toBeNull();
    expect(live.contains(document.activeElement)).toBe(true);
    // The box holds the redraw in turn; Escape lets it run.
    expect(sqOf(section)).toBe('64px');
    key(document.activeElement, 'Escape');
    expect(sqOf(section)).toBe('48px');
    expect(made).toEqual([]);
  });

  it('the box closes when the focus leaves it: nothing made, and the redraw it held runs (C1)', async () => {
    world([ada, keep]);
    const section = drawn();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    const name = openBox(section);
    name.value = 'Bren';
    resize(500);
    expect(sqOf(section)).toBe('64px');
    elsewhere.focus();
    // Wait for the held redraw itself, not a time: a busy machine runs the two timers late.
    await vi.waitFor(() => expect(sqOf(section)).toBe('48px'));
    expect(section.querySelector('.atlas-home-grid-make')).toBeNull();
    expect(made).toEqual([]);
    expect(sqOf(section)).toBe('48px');
  });

  it('the box closes on a press outside it, and the redraw waits until that press has landed (C1, C5)', async () => {
    world([ada, keep]);
    const section = drawn();
    openBox(section);
    resize(500);
    const mira = section.querySelector<HTMLElement>(`[data-grid-id="${uuid(1)}"]`)!;
    mira.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(section.querySelector('.atlas-home-grid-make')).toBeNull();
    // The press is still under way: its square is still the one in the page, and it acts.
    expect(mira.isConnected).toBe(true);
    expect(sqOf(section)).toBe('64px');
    window.dispatchEvent(new MouseEvent('pointerup'));
    mira.click();
    // Wait for the held redraw itself, not a time: a busy machine runs the two timers late.
    await vi.waitFor(() => expect(sqOf(section)).toBe('48px'));
    expect(sqOf(section)).toBe('48px');
    expect(section.querySelector(`[data-grid-id="${uuid(1)}"]`)!.classList.contains('is-selected')).toBe(true);
  });

  it('the list closes when the focus leaves it (C1)', async () => {
    world([ada, keep]);
    const section = drawn();
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    section.querySelector<HTMLElement>('[data-grid-plus]')!.click();
    resize(500);
    elsewhere.focus();
    // Wait for the held redraw itself, not a time: a busy machine runs the two timers late.
    await vi.waitFor(() => expect(sqOf(section)).toBe('48px'));
    expect(section.querySelector('[role="menu"]')).toBeNull();
    expect(sqOf(section)).toBe('48px');
  });
});

describe('Place asks who may act at the press', () => {
  it('a contributor may place their own Mira, never on the owner\'s Event (the write is the Event\'s)', () => {
    const mira = E(1, 'character', 'Mira', { created_by: 'me' });
    const founding = E(5, 'event', 'The Founding', { created_by: null });
    world([mira, keep, founding]);
    expect(mayPlace('w', uuid(1), uuid(5))).toBe(true);
    world([mira, keep, founding], { api: { member_role: 'contributor', membership: 'me' } } as never);
    expect(mayPlace('w', uuid(1), uuid(2))).toBe(true);
    expect(mayPlace('w', uuid(1), uuid(5))).toBe(false);
    world([mira, keep, founding], { demo: true });
    expect(mayPlace('w', uuid(1), uuid(2))).toBe(false);
  });
});
