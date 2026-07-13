/**
 * Home tour kernel (S264) — the tutorial-state card computation is a pure
 * function of world contents + the dismissed set. Locks the phase gate (core
 * pair before next wave), the create→CTA flip, and dismissal.
 */

import { describe, it, expect } from 'vitest';
import { computeTourCards, TOUR_WAVE } from '../../src/middle/home-tour';

const counts = (obj: Record<string, number>): Map<string, number> => new Map(Object.entries(obj));
const none = new Set<string>();

describe('computeTourCards', () => {
  it('an empty world offers the core pair, highlighted, undismissible', () => {
    const cards = computeTourCards(counts({}), none);
    expect(cards).toEqual([
      { kind: 'create', id: 'create-character', type: 'character', highlighted: true, dismissible: false },
      { kind: 'create', id: 'create-location', type: 'location', highlighted: true, dismissible: false },
    ]);
  });

  it('one core down → only the missing one shows; the next wave still waits', () => {
    const cards = computeTourCards(counts({ character: 1, event: 3 }), none);
    expect(cards).toEqual([
      { kind: 'create', id: 'create-location', type: 'location', highlighted: true, dismissible: false },
    ]);
  });

  it('both cores present → the full next wave, quiet and dismissible', () => {
    const cards = computeTourCards(counts({ character: 1, location: 1 }), none);
    expect(cards.length).toBe(TOUR_WAVE.length);
    expect(cards.every(c => c.kind === 'create' && !c.highlighted && c.dismissible)).toBe(true);
  });

  it('a created wave type flips its card into the room CTA', () => {
    const cards = computeTourCards(counts({ character: 1, location: 1, event: 2 }), none);
    const event = cards.find(c => c.id.endsWith('-event'));
    expect(event).toMatchObject({ kind: 'cta', id: 'cta-event' });
    expect(cards.filter(c => c.kind === 'create').length).toBe(TOUR_WAVE.length - 1);
  });

  it('dismissals remove exactly their card (create and cta independently)', () => {
    const dismissed = new Set(['create-object', 'cta-event']);
    const cards = computeTourCards(counts({ character: 1, location: 1, event: 2 }), dismissed);
    expect(cards.some(c => c.id === 'create-object')).toBe(false);
    expect(cards.some(c => c.id === 'cta-event')).toBe(false);
    expect(cards.some(c => c.id === 'create-narrative')).toBe(true);
  });

  it('a built-out (or dismissed-out) world shows no tour at all', () => {
    const all: Record<string, number> = { character: 1, location: 1 };
    for (const e of TOUR_WAVE) all[e.type] = 1;
    const dismissed = new Set(TOUR_WAVE.map(e => `cta-${e.type}`));
    expect(computeTourCards(counts(all), dismissed)).toEqual([]);
  });

  it('core cards are never gated by dismissal (they cannot be dismissed)', () => {
    const dismissed = new Set(['create-character', 'create-location']);
    const cards = computeTourCards(counts({}), dismissed);
    expect(cards.length).toBe(2);
  });
});
