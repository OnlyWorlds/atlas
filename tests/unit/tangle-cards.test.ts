/**
 * The battle card's outcome line reads Tangle's `verdict` (x_tangle_battle):
 * a winner awarded at the time limit broke no army, and an army that left in
 * order withdrew, so neither reads as an ordinary victory.
 */
import { describe, it, expect } from 'vitest';
import { battleOutcomeLine } from '../../src/middle/tangle-cards';

const battle = (o: Record<string, unknown>) => ({
  sides: [{ name: 'Athens', fallen: 120 }, { name: 'Sparta', fallen: 90 }],
  units: [{ name: 'Left', side: 'Athens', type: 'hoplite', started: 400, remaining: 380, outcome: 'held' }],
  ...o,
});

describe('battleOutcomeLine', () => {
  it('an ordinary victory and a draw read as before', () => {
    expect(battleOutcomeLine(battle({ winner: 'Athens' }))).toBe('Athens held the field');
    expect(battleOutcomeLine(battle({ winner: null }))).toBe('The armies parted without decision');
  });

  it('a winner awarded at the time limit says no army broke', () => {
    expect(battleOutcomeLine(battle({ winner: 'Athens', verdict: 'held-the-field' })))
      .toBe('Athens held the field when time ran out, with no army broken');
  });

  it('a withdrawal names the side that left in order', () => {
    expect(battleOutcomeLine(battle({ winner: 'Sparta', verdict: 'withdrew' })))
      .toBe('Sparta held the field after Athens withdrew in order');
  });

  it('an unknown verdict word is read as none', () => {
    expect(battleOutcomeLine(battle({ winner: 'Athens', verdict: 'routed' }))).toBe('Athens held the field');
  });
});
