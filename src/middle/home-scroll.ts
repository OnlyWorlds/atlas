/**
 * Home keeps its scroll on every redraw (1.122.1). Home (`.atlas-world-home`) is its own scroller, and a
 * draw empties it and builds it again in steps: a layout read part way (the rows' hold, a focus's scroll,
 * the grid's mount) clamps the scroll to the part built so far, so a sync tick, a make, a line's × or a
 * tab's press pulled the page toward the top. The keeper reads the scroll before the draw and puts it back
 * once the whole draw is built, before the draw's focus settles; the browser clamps it to the new end.
 *
 * Pure of the DOM: the scroller is anything with a `scrollTop`, so the rule is unit-tested as it is.
 */

/** One draw as the keeper sees it: whether it drew (a draw held back or unchanged did not), and its settle. */
export interface HomeDraw {
  drew: boolean;
  /** The focus a press asked for, and the one kept across the draw: run after the scroll is put back,
   *  so its own `nearest` scroll moves the page only when that control would be out of view. */
  settle?: () => void;
}

/** Where the scroll goes after a draw: kept on the same world, the top on another world or a first open. */
export function scrollAfterDraw(saved: number, drawnBefore: string | null, drawnNow: string | null): number {
  return drawnBefore !== null && drawnBefore === drawnNow ? saved : 0;
}

/**
 * One keeper per Home mount. Each call reads `scrollTop`, runs the draw, and, when it drew, writes the
 * position back (or 0 for another world), then runs its settle. A draw that did not draw writes nothing
 * and leaves nothing saved for a later one. A draw started inside another (a redraw asked mid-draw) leaves
 * the scroll to the outer one, which reads it before anything was emptied.
 */
export function homeScrollKeeper(scroller: { scrollTop: number }, worldNow: () => string | null): (draw: () => HomeDraw) => void {
  let drawn: string | null = null;
  let depth = 0;
  return (draw) => {
    const outer = depth === 0;
    const saved = scroller.scrollTop;
    const from = drawn;
    depth++;
    let d: HomeDraw;
    try { d = draw(); } finally { depth--; }
    if (!d.drew) return;
    const now = worldNow();
    drawn = now;
    if (outer) scroller.scrollTop = scrollAfterDraw(saved, from, now);
    d.settle?.();
  };
}
