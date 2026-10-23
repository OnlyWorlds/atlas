/**
 * The cloud-compute pilot's planted red (#597, TC h71): this spec fails on purpose, so a run
 * on this branch must come back red and name it. Never merged.
 */
import { test, expect } from '@playwright/test';

test('pilot-red: a planted failure the run must name (#597)', async () => {
  expect(1, 'the planted failure').toBe(2);
});
