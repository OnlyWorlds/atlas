import { describe, it, expect, beforeEach } from 'vitest';
import {
  getWordGoal,
  setWordGoal,
  clearWordGoal,
  goalProgress,
} from '../../src/middle/writing-workspace-word-goal';

describe('writing-workspace-word-goal storage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('returns null when no goal is stored', () => {
    expect(getWordGoal('w1', 'n1')).toBeNull();
  });

  it('round-trips a goal value', () => {
    setWordGoal('w1', 'n1', 500);
    expect(getWordGoal('w1', 'n1')).toBe(500);
  });

  it('scopes goals per (worldId, narrativeId)', () => {
    setWordGoal('w1', 'n1', 500);
    setWordGoal('w1', 'n2', 1000);
    setWordGoal('w2', 'n1', 250);
    expect(getWordGoal('w1', 'n1')).toBe(500);
    expect(getWordGoal('w1', 'n2')).toBe(1000);
    expect(getWordGoal('w2', 'n1')).toBe(250);
  });

  it('clears a stored goal', () => {
    setWordGoal('w1', 'n1', 500);
    clearWordGoal('w1', 'n1');
    expect(getWordGoal('w1', 'n1')).toBeNull();
  });

  it('setting non-positive value clears the goal', () => {
    setWordGoal('w1', 'n1', 500);
    setWordGoal('w1', 'n1', 0);
    expect(getWordGoal('w1', 'n1')).toBeNull();
    setWordGoal('w1', 'n1', 500);
    setWordGoal('w1', 'n1', -100);
    expect(getWordGoal('w1', 'n1')).toBeNull();
  });

  it('floors fractional inputs', () => {
    setWordGoal('w1', 'n1', 500.7);
    expect(getWordGoal('w1', 'n1')).toBe(500);
  });

  it('returns null on missing world or narrative id', () => {
    setWordGoal('', '', 500);
    expect(getWordGoal('', '')).toBeNull();
  });
});

describe('writing-workspace-word-goal progress', () => {
  it('returns 0 when no goal is set', () => {
    expect(goalProgress(100, null)).toBe(0);
  });

  it('returns 0 when word count is 0', () => {
    expect(goalProgress(0, 500)).toBe(0);
  });

  it('returns fractional progress under the goal', () => {
    expect(goalProgress(250, 500)).toBe(0.5);
  });

  it('clamps to 1 when over the goal', () => {
    expect(goalProgress(750, 500)).toBe(1);
  });

  it('returns 0 for a non-positive goal', () => {
    expect(goalProgress(100, 0)).toBe(0);
    expect(goalProgress(100, -50)).toBe(0);
  });
});
