/**
 * The home's onboarding kernel (the cards; #127; 1.20 cards kept, done), pure.
 * Locks the core gate (the pair before the grow wave), that a done card stays
 * in place marked done (the layout holds still), and that the block goes only
 * when every card is done.
 */

import { describe, it, expect } from 'vitest';
import { computeHomeCards, CORE_CARDS, GROW_CARDS } from '../../src/middle/home-tour';

const counts = (obj: Record<string, number>): Map<string, number> => new Map(Object.entries(obj));
const view = (c: ReturnType<typeof computeHomeCards>) => c && { phase: c.phase, cards: c.cards.map(x => `${x.def.type}${x.done ? '+' : ''}`) };

describe('computeHomeCards', () => {
  it('an empty world: the core pair, neither done', () => {
    expect(view(computeHomeCards(counts({})))).toEqual({ phase: 'core', cards: ['character', 'location'] });
  });

  it('one core made: it stays in its place, done; the grow wave still waits', () => {
    expect(view(computeHomeCards(counts({ character: 1, event: 3 })))).toEqual({ phase: 'core', cards: ['character+', 'location'] });
  });

  it('both cores: the pair stays, done, and the grow wave follows in order', () => {
    expect(view(computeHomeCards(counts({ character: 1, location: 1 })))).toEqual({
      phase: 'grow',
      cards: ['character+', 'location+', 'event', 'narrative', 'map', 'collective'],
    });
  });

  it('a made grow type stays in its place, done', () => {
    const v = view(computeHomeCards(counts({ character: 1, location: 1, narrative: 2 })))!;
    expect(v.cards).toEqual(['character+', 'location+', 'event', 'narrative+', 'map', 'collective']);
  });

  it('every card done: nothing to show', () => {
    const all: Record<string, number> = {};
    for (const d of [...CORE_CARDS, ...GROW_CARDS]) all[d.type] = 1;
    expect(computeHomeCards(counts(all))).toBeNull();
  });

  it('every grow card opens a room, never Share or Export (1.20)', () => {
    expect(GROW_CARDS.map(d => d.room)).toEqual(['timeline', 'writing', 'map', 'knowledge']);
  });
});
