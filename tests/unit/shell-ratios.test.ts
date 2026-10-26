/**
 * The shell's pane arithmetic.
 *
 * The dividers clamp in FRACTIONS while `.atlas-right` clamps in PIXELS
 * (`min-width: 240px`), and the two disagree on any window narrow enough for
 * the fraction to fall under the pixel floor. Dragging the middle divider
 * right on an ordinary 1280 laptop used to push the shell past the viewport;
 * `overflow: hidden` then clipped the map's right-anchored controls — the pin
 * trash, the zones dropdown — off-screen with no scrollbar and no cue, and
 * the ratio is persisted, so the broken state survived a reload.
 *
 * `middleCapFor` is the one place that reconciles the two units. These tests
 * assert the OUTCOME (the right pane keeps its floor) rather than restating
 * the formula, and they include the exact window width that shipped broken.
 */

import { describe, it, expect } from 'vitest';
import { middleCapFor, RIGHT_PANE_MIN_PX } from '../../src/layout/app-shell';

/** Pixels the right pane would actually get under a given middle fraction. */
function rightPanePx(shellWidth: number, sidebar: number, middle: number): number {
  return shellWidth - shellWidth * sidebar - shellWidth * middle;
}

describe('middleCapFor', () => {
  it('leaves the right pane its pixel floor at the width that shipped broken', () => {
    const width = 1280;
    const sidebar = 0.20;
    const cap = middleCapFor(width, sidebar, 0.70);
    expect(rightPanePx(width, sidebar, cap)).toBeGreaterThanOrEqual(RIGHT_PANE_MIN_PX - 0.5);
    // The old code allowed 0.70 (or 0.88 - sidebar); prove the cap actually bites.
    expect(cap).toBeLessThan(0.70);
  });

  it('holds the floor across the widths a real visitor arrives at', () => {
    for (const width of [2560, 1920, 1440, 1280, 1024, 900, 820]) {
      for (const sidebar of [0.12, 0.20, 0.40]) {
        const cap = middleCapFor(width, sidebar, 0.70);
        const remaining = rightPanePx(width, sidebar, cap);
        // Either the right pane keeps its floor, or the middle has already
        // been squeezed to its own 0.2 minimum and the window is simply too
        // narrow for three panes — which is the shell-breakpoint question,
        // not this function's job.
        const flooredOut = cap <= 0.2 + 1e-9;
        expect(
          remaining >= RIGHT_PANE_MIN_PX - 0.5 || flooredOut,
          `w=${width} sidebar=${sidebar} cap=${cap} remaining=${remaining}`,
        ).toBe(true);
      }
    }
  });

  it('never widens the caller\'s own fraction cap', () => {
    // A very wide window: the pixel floor is not the binding constraint, so
    // the caller's 0.70 stands rather than being relaxed.
    expect(middleCapFor(4000, 0.20, 0.70)).toBe(0.70);
  });

  it('is inert before first layout, when the shell has no width yet', () => {
    expect(middleCapFor(0, 0.20, 0.70)).toBe(0.70);
  });
});
