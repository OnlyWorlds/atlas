/**
 * Which pane each tour step points at (S366, `src/tour/tour-pane.ts`), as a
 * table over the REAL steps, so a new step or a changed route has to agree
 * with this file on purpose.
 */
import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '../../src/tour/tour-data';
import { tourPaneFor } from '../../src/tour/tour-pane';

const byId = (id: string) => {
  const s = TOUR_STEPS.find(t => t.id === id);
  if (!s) throw new Error(`no tour step ${id}`);
  return s;
};

describe('tourPaneFor', () => {
  it('the create beats point at the sidebar until their gesture is done', () => {
    expect(tourPaneFor(byId('the-world'), false, true)).toBe('sidebar');
    expect(tourPaneFor(byId('the-world'), true, true)).toBe(null);
    expect(tourPaneFor(byId('the-consul'), false, true)).toBe('sidebar');
    expect(tourPaneFor(byId('the-consul'), true, true)).not.toBe('sidebar');
  });

  it('the pin beat starts in the middle (the +pin) and turns to the map once placed', () => {
    const pinStep = TOUR_STEPS.find(s => s.handsOn === 'place-pin')!;
    expect(tourPaneFor(pinStep, false, true)).toBe(null);
    expect(tourPaneFor(pinStep, true, true)).toBe('right');
  });

  it('a map route points at the right pane, an elements route at the sidebar', () => {
    expect(tourPaneFor(byId('the-swamps'), false, true)).toBe('right');
    expect(tourPaneFor(byId('the-rest'), false, true)).toBe('sidebar');
  });

  it('a creates run points at the sidebar until every create is done', () => {
    const run = TOUR_STEPS.find(s => s.creates && s.creates.length > 0)!;
    expect(tourPaneFor(run, false, false)).toBe('sidebar');
    expect(tourPaneFor(run, false, true)).not.toBe('sidebar');
  });

  it('every step has an answer (no step throws)', () => {
    for (const s of TOUR_STEPS) {
      expect(['sidebar', 'right', null]).toContain(tourPaneFor(s, false, false));
      expect(['sidebar', 'right', null]).toContain(tourPaneFor(s, true, true));
    }
  });
});
