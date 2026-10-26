/**
 * The exit summary's room derivation — pure, so the "what have I seen" claim
 * on the way out can be checked without a browser.
 *
 * The screen exists to give someone who leaves early an honest map of the app
 * (Titus), so the invariants that matter are all about it NOT lying:
 * never claim a room was visited before its step, never invent a room the app
 * does not have, and never let the two lists disagree with each other.
 */

import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '../../src/tour/tour-data';
import { TOUR_ROOMS, tourExitSummary } from '../../src/tour/tour-exit-summary';

const idsOf = (rooms: readonly { id: string }[]) => rooms.map(r => r.id);

describe('tourExitSummary', () => {
  it('every room is in exactly one list, at every step', () => {
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const { seen, unseen } = tourExitSummary(i);
      expect(seen.length + unseen.length, `step ${i}`).toBe(TOUR_ROOMS.length);
      const overlap = idsOf(seen).filter(id => idsOf(unseen).includes(id));
      expect(overlap, `step ${i} overlap`).toEqual([]);
    }
  });

  it('claims nothing at the opener: step 0 has no route at all', () => {
    // The opener is the bare sentence on black — no shell, no room.
    const { seen } = tourExitSummary(0);
    expect(seen).toEqual([]);
  });

  it('seen only ever grows as the tour advances', () => {
    // A room cannot become unvisited. If this fails, the derivation is reading
    // the step's route rather than the history up to it.
    let prev = 0;
    for (let i = 0; i < TOUR_STEPS.length; i++) {
      const n = tourExitSummary(i).seen.length;
      expect(n, `step ${i} regressed`).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('does not claim the Charts room before the tour routes there', () => {
    const chartStep = TOUR_STEPS.findIndex(s => s.route?.kind === 'chart');
    expect(chartStep).toBeGreaterThan(0);
    expect(idsOf(tourExitSummary(chartStep - 1).seen)).not.toContain('timeline');
    expect(idsOf(tourExitSummary(chartStep).seen)).toContain('timeline');
  });

  it('does not claim the Writing room before the tour routes there', () => {
    const writingStep = TOUR_STEPS.findIndex(s => s.route?.kind === 'writing');
    expect(writingStep).toBeGreaterThan(0);
    expect(idsOf(tourExitSummary(writingStep - 1).seen)).not.toContain('writing');
    expect(idsOf(tourExitSummary(writingStep).seen)).toContain('writing');
  });

  it('by the finale, the untouched rooms are exactly knowledge, pages and data', () => {
    // This is the offer the screen is built to make. If the tour ever grows a
    // knowledge or pages beat, this fails loudly and the copy gets revisited.
    const { seen, unseen } = tourExitSummary(TOUR_STEPS.length - 1);
    expect(idsOf(seen).sort()).toEqual(['home', 'timeline', 'writing']);
    expect(idsOf(unseen).sort()).toEqual(['import', 'knowledge', 'share']);
  });

  it('clamps out-of-range indices instead of throwing', () => {
    expect(tourExitSummary(-5).seen).toEqual([]);
    expect(() => tourExitSummary(9999)).not.toThrow();
    expect(tourExitSummary(9999).seen.length)
      .toBe(tourExitSummary(TOUR_STEPS.length - 1).seen.length);
  });

  it('every room carries a label, an icon and a blurb', () => {
    for (const room of TOUR_ROOMS) {
      expect(room.label.length, room.id).toBeGreaterThan(0);
      expect(room.icon.length, room.id).toBeGreaterThan(0);
      expect(room.blurb.length, room.id).toBeGreaterThan(0);
    }
  });
});
