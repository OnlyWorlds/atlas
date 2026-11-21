/**
 * keel's 429 waits, by world key (`src/sync/rate-wait.ts`): a later end never shortens an earlier one,
 * and the PIN wall, once met, stays named until its own wait ends, whatever 429 came after it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { __resetRateWaitsForTests, clampWaitMs, rateWaitOf, setRateWait, waitWords } from '../../src/sync/rate-wait';

const T0 = 1_000_000;

beforeEach(() => __resetRateWaitsForTests());

describe('a wait on a key', () => {
  it('ends when its Retry-After says, clamped to 1 s .. 15 min, and is forgotten after', () => {
    setRateWait('k', 60_000, false, T0);
    expect(rateWaitOf('k', T0 + 59_999)).toEqual({ until: T0 + 60_000, pin: false });
    expect(rateWaitOf('k', T0 + 60_000)).toBeNull();
    expect(clampWaitMs(10)).toBe(1000);
    expect(clampWaitMs(3_600_000)).toBe(900_000);
    expect(rateWaitOf('other', T0)).toBeNull();
  });

  it('a later 429 that is not the wall keeps the wall named until the wall\'s own wait ends', () => {
    setRateWait('k', 60_000, true, T0);
    setRateWait('k', 120_000, false, T0 + 10_000);
    expect(rateWaitOf('k', T0 + 20_000)).toEqual({ until: T0 + 130_000, pin: true });
    expect(rateWaitOf('k', T0 + 61_000)).toEqual({ until: T0 + 130_000, pin: false });
  });

  it('a shorter 429 never shortens the wait', () => {
    setRateWait('k', 120_000, false, T0);
    setRateWait('k', 5_000, true, T0 + 1_000);
    expect(rateWaitOf('k', T0 + 2_000)).toEqual({ until: T0 + 120_000, pin: true });
    expect(rateWaitOf('k', T0 + 7_000)).toEqual({ until: T0 + 120_000, pin: false });
  });

  it('says seconds under 90, else minutes', () => {
    expect(waitWords(1_000)).toBe('1 second');
    expect(waitWords(45_000)).toBe('45 seconds');
    expect(waitWords(900_000)).toBe('15 minutes');
  });
});
