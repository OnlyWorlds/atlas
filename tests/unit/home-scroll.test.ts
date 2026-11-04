/**
 * Home keeps its scroll on every redraw (Atlas 1.122.1, `src/middle/home-scroll.ts`): the keeper reads the
 * scroll before a draw, writes it back once the draw is built, then runs the draw's settle; the same world
 * keeps its place, another world or a first open lands at the top; a draw that does not draw writes
 * nothing and leaves nothing saved; a draw started inside another leaves the scroll to the outer one.
 */
import { describe, it, expect } from 'vitest';
import { homeScrollKeeper, scrollAfterDraw } from '../../src/middle/home-scroll';

/** A scroller that clamps as the browser does, its end moved by the draw. */
function scroller(end: number) {
  let top = 0;
  const s = {
    end,
    writes: [] as number[],
    get scrollTop() { return top; },
    set scrollTop(v: number) { top = Math.max(0, Math.min(v, s.end)); s.writes.push(top); },
  };
  return s;
}

describe('scrollAfterDraw', () => {
  it('keeps the position on the same world, the top on another world or the first draw', () => {
    expect(scrollAfterDraw(480, 'w1', 'w1')).toBe(480);
    expect(scrollAfterDraw(480, 'w1', 'w2')).toBe(0);
    expect(scrollAfterDraw(480, null, 'w1')).toBe(0);
    expect(scrollAfterDraw(480, 'w1', null)).toBe(0);
  });
});

describe('homeScrollKeeper', () => {
  it('puts back the scroll read before the draw, after a draw that clamped it short, then settles', () => {
    const sc = scroller(1000);
    let world = 'w1';
    const keep = homeScrollKeeper(sc, () => world);
    keep(() => ({ drew: true }));
    sc.scrollTop = 640;
    const order: string[] = [];
    keep(() => {
      // The draw empties Home and reads layout part way: the browser clamps the scroll to the part built.
      sc.end = 200; sc.scrollTop = sc.scrollTop;
      sc.end = 1000;
      return { drew: true, settle: () => order.push(`settle at ${sc.scrollTop}`) };
    });
    expect(sc.scrollTop).toBe(640);
    // The focus settles on the position put back, never on the clamped one.
    expect(order).toEqual(['settle at 640']);
    void world;
  });

  it('is clamped by the new end when the new content is shorter, never past it', () => {
    const sc = scroller(1000);
    const keep = homeScrollKeeper(sc, () => 'w1');
    keep(() => ({ drew: true }));
    sc.scrollTop = 900;
    keep(() => { sc.end = 500; return { drew: true }; });
    expect(sc.scrollTop).toBe(500);
  });

  it('lands at the top on another world, and on the first draw', () => {
    const sc = scroller(1000);
    let world: string | null = 'w1';
    const keep = homeScrollKeeper(sc, () => world);
    sc.scrollTop = 300;
    keep(() => ({ drew: true }));
    expect(sc.scrollTop).toBe(0);
    sc.scrollTop = 700;
    world = 'w2';
    keep(() => ({ drew: true }));
    expect(sc.scrollTop).toBe(0);
    // Forget, then the same world opened again: no world drawn between, so it lands at the top too.
    sc.scrollTop = 400;
    world = null;
    keep(() => ({ drew: true }));
    world = 'w2';
    sc.scrollTop = 400;
    keep(() => ({ drew: true }));
    expect(sc.scrollTop).toBe(0);
  });

  it('a draw that did not draw writes nothing, settles nothing and leaves nothing for the next', () => {
    const sc = scroller(1000);
    const keep = homeScrollKeeper(sc, () => 'w1');
    keep(() => ({ drew: true }));
    sc.scrollTop = 600;
    sc.writes.length = 0;
    let settled = false;
    keep(() => ({ drew: false, settle: () => { settled = true; } }));
    expect(sc.writes).toEqual([]);
    expect(settled).toBe(false);
    // The person scrolls on; the next draw keeps where they are now, not where the held draw read.
    sc.scrollTop = 250;
    keep(() => ({ drew: true }));
    expect(sc.scrollTop).toBe(250);
  });

  it('a draw that throws leaves the keeper whole', () => {
    const sc = scroller(1000);
    const keep = homeScrollKeeper(sc, () => 'w1');
    keep(() => ({ drew: true }));
    sc.scrollTop = 420;
    expect(() => keep(() => { throw new Error('boom'); })).toThrow('boom');
    sc.scrollTop = 380;
    keep(() => { sc.end = 100; sc.scrollTop = 0; sc.end = 1000; return { drew: true }; });
    expect(sc.scrollTop).toBe(380);
  });

  it('a draw started inside another leaves the scroll to the outer one, which read it before Home emptied', () => {
    const sc = scroller(1000);
    let world = 'w1';
    const keep = homeScrollKeeper(sc, () => world);
    keep(() => ({ drew: true }));
    sc.scrollTop = 560;
    sc.writes.length = 0;
    const seen: number[] = [];
    keep(() => {
      sc.end = 150; sc.scrollTop = sc.scrollTop; // emptied part way: clamped to 150
      keep(() => ({ drew: true, settle: () => seen.push(sc.scrollTop) }));
      sc.end = 1000;
      return { drew: true, settle: () => seen.push(sc.scrollTop) };
    });
    // The inner draw wrote no scroll (it read the clamped 150): the only writes are the clamp's and the outer's.
    expect(sc.writes).toEqual([150, 560]);
    expect(sc.scrollTop).toBe(560);
    expect(seen).toEqual([150, 560]);
    void world;
  });

  it('a world switched inside a draw never carries the old position onto the new world', () => {
    const sc = scroller(1000);
    let world = 'w1';
    const keep = homeScrollKeeper(sc, () => world);
    keep(() => ({ drew: true }));
    sc.scrollTop = 500;
    keep(() => { world = 'w2'; return { drew: true }; });
    expect(sc.scrollTop).toBe(0);
  });
});
