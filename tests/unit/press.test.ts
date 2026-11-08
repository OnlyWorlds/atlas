// The press guard: a redraw driven by data waits while a press is down; at a person's click the
// click's own redraw runs at once and the held ones on the next turn; a script's click ends nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Press = typeof import('../../src/ui/press');

// The module's own listeners, taken as it installs them on jsdom's window: jsdom's `isTrusted`
// cannot be set on a real event, so each test calls them with a plain one.
let heard: Map<string, Array<(e: unknown) => void>>;
/** Handlers a test adds after the module's, as the app's own click handlers are. */
let after: Map<string, Array<() => void>>;

async function fresh(): Promise<Press> {
  vi.resetModules();
  heard = new Map();
  after = new Map();
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, fn: (e: unknown) => void) => {
    heard.set(type, [...(heard.get(type) ?? []), fn]);
  }) as typeof window.addEventListener);
  const p = await import('../../src/ui/press');
  p.watchPresses();
  return p;
}

/** A person's event (the browser's own); `trusted: false` is a script's `el.click()`. */
const fire = (type: string, trusted = true) => {
  for (const fn of heard.get(type) ?? []) fn({ type, isTrusted: trusted });
  for (const fn of after.get(type) ?? []) fn();
};
const onClick = (fn: () => void) => after.set('click', [...(after.get('click') ?? []), fn]);

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('press guard', () => {
  it('runs a redraw at once when no press is down', async () => {
    const p = await fresh();
    const fn = vi.fn();
    p.afterPress(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('holds a redraw through the press and runs it on the turn after the click', async () => {
    const p = await fresh();
    fire('pointerdown');
    const held = vi.fn();
    p.afterPress(held);
    fire('pointerup');
    fire('click');
    expect(held).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it("runs the click's own redraw at once, inside the click", async () => {
    const p = await fresh();
    const own = vi.fn();
    onClick(() => p.afterPress(own));
    fire('pointerdown');
    fire('pointerup');
    fire('click');
    expect(own).toHaveBeenCalledTimes(1);
  });

  it("a script's click during a press ends nothing (a download's link landing)", async () => {
    const p = await fresh();
    fire('pointerdown');
    const held = vi.fn();
    p.afterPress(held);
    fire('click', false);
    vi.advanceTimersByTime(0);
    expect(held).not.toHaveBeenCalled();
    expect(p.pressHeld()).toBe(true);
    fire('pointerup');
    fire('click');
    vi.advanceTimersByTime(0);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('keeps running the held redraws when one throws', async () => {
    const p = await fresh();
    fire('pointerdown');
    const first = vi.fn(() => { throw new Error('boom'); });
    const second = vi.fn();
    p.afterPress(first);
    p.afterPress(second);
    fire('pointercancel');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(() => vi.advanceTimersByTime(0)).toThrow('boom');
  });

  it('frees a press that never becomes a click 300 ms after the lift, and one whose lift never comes at 5 s', async () => {
    const p = await fresh();
    fire('pointerdown');
    const a = vi.fn();
    p.afterPress(a);
    fire('pointerup');
    vi.advanceTimersByTime(299);
    expect(a).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(a).toHaveBeenCalledTimes(1);
    fire('pointerdown');
    const b = vi.fn();
    p.afterPress(b);
    vi.advanceTimersByTime(4999);
    expect(b).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('takes one entry per redraw, however often it is asked during a press', async () => {
    const p = await fresh();
    fire('pointerdown');
    const repaint = vi.fn();
    for (let i = 0; i < 20; i++) p.afterPress(repaint);
    fire('pointercancel');
    expect(repaint).toHaveBeenCalledTimes(1);
  });
});
