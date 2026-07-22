/**
 * Guard against a rot class that has already shipped twice: `tour.spec.ts`
 * drives the tour by hand-maintained NUMERIC index at 20+ call sites
 * (`nextStep(page, 7)`), and the e2e file's own header comment carries a
 * parallel index→id map in prose ("7 pin · 8 swamps · 9 objects…") that nothing
 * checks against `TOUR_STEPS` in `src/tour/tour-data.ts`. If a step is
 * renamed, merged, or reordered there, every numbered e2e call site silently
 * points at the wrong step — the spec still passes, it just asserts the wrong
 * thing.
 *
 * This file can't change tour.spec.ts (out of scope here), so it pins the
 * index→id mapping the e2e file's numbering DEPENDS ON as an exported
 * constant, transcribed from that header comment (tour.spec.ts:9-12) and the
 * numbered `nextStep`/inline step assertions through the file. If a re-order
 * ever drifts the two apart, this test (not a silent e2e false-pass) is what
 * catches it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOUR_STEPS } from '../../src/tour/tour-data';

/**
 * 1-based step index (matches tour.spec.ts's `data-tour-step` / `nextStep`
 * argument) → the step id tour.spec.ts's comments and assertions name at that
 * index. Transcribed from tour.spec.ts's header comment (lines 9-12) plus the
 * inline `// N — <id-ish comment>` markers on each `nextStep` call.
 */
export const E2E_STEP_INDEX_TO_ID: Record<number, string> = {
  1: 'the-sentence',
  2: 'the-world',
  3: 'the-consul',
  4: 'the-hegemony',
  5: 'the-planet',
  6: 'the-map',
  7: 'the-pin',
  8: 'the-swamps',
  9: 'objects',
  10: 'linking',
  11: 'the-writing',
  12: 'the-events',
  13: 'the-chart',
  14: 'deep-time',
  15: 'the-rest',
  16: 'yours-to-keep',
  17: 'finale',
};

describe('TOUR_STEPS structural invariants (the numbering tour.spec.ts trusts)', () => {
  it('every step id is unique', () => {
    const ids = TOUR_STEPS.map(s => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every step id is a non-empty string', () => {
    for (const step of TOUR_STEPS) {
      expect(typeof step.id).toBe('string');
      expect(step.id.trim().length).toBeGreaterThan(0);
    }
  });

  it('the step count matches what tour.spec.ts assumes (17 steps, 1-based)', () => {
    expect(TOUR_STEPS.length).toBe(17);
    expect(Object.keys(E2E_STEP_INDEX_TO_ID).length).toBe(TOUR_STEPS.length);
  });

  it('each numbered e2e step points at the id the spec actually names there', () => {
    for (const [indexStr, expectedId] of Object.entries(E2E_STEP_INDEX_TO_ID)) {
      const index = Number(indexStr);
      const step = TOUR_STEPS[index - 1]; // e2e is 1-based, TOUR_STEPS is 0-based
      expect(step, `no TOUR_STEPS entry at 1-based index ${index}`).toBeDefined();
      expect(step.id, `TOUR_STEPS[${index - 1}] drifted from what tour.spec.ts expects at step ${index}`)
        .toBe(expectedId);
    }
  });
});

/**
 * The half above compares TOUR_STEPS against a map TRANSCRIBED INTO THIS FILE,
 * which cannot see a change made on the OTHER side of the coupling. A test that
 * never opens the file it claims to protect cannot protect it (S305), so this
 * block reads `tour.spec.ts` off disk and checks the numbers it actually
 * drives against the real step table.
 *
 * Numbers, not prose, on purpose: a regex cannot reliably tell a step id in a
 * comment from one in a string literal (S302), but `nextStep(page, 12)` is
 * unambiguous. The failure this catches is the one that has shipped twice —
 * steps MERGED away (S306c cut 18 to 17) leaving call sites pointing past the
 * end, or at a neighbour that silently means something else.
 */
describe('tour.spec.ts numbering, read from the actual file', () => {
  const specPath = resolve(__dirname, '../e2e/tour.spec.ts');
  const spec = readFileSync(specPath, 'utf8');

  /** Every `nextStep(page, N)` argument the spec drives. */
  const drivenSteps = [...spec.matchAll(/nextStep\(\s*page\s*,\s*(\d+)\s*\)/g)]
    .map(m => Number(m[1]));

  it('actually found the driven step numbers (the regex still matches the call shape)', () => {
    // Guards the guard: if nextStep's signature changes, this block would
    // silently pass over an empty list and assert nothing at all.
    expect(drivenSteps.length).toBeGreaterThan(5);
  });

  it('never drives a step number past the end of TOUR_STEPS', () => {
    for (const n of drivenSteps) {
      expect(n, `tour.spec.ts drives step ${n}, but TOUR_STEPS has ${TOUR_STEPS.length}`)
        .toBeLessThanOrEqual(TOUR_STEPS.length);
      expect(n).toBeGreaterThanOrEqual(1);
    }
  });

  it('walks the tour all the way to the final step', () => {
    // If a step is appended and the spec is not extended, the walk stops short
    // and the new step ships with no e2e coverage at all.
    expect(Math.max(...drivenSteps)).toBe(TOUR_STEPS.length);
  });
});
