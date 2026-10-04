/**
 * Failures nothing caught (S369): said once, quietly bounded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const shown: unknown[] = [];
vi.mock('../../src/ui/problem-fixes', () => ({
  showProblem: (err: unknown) => { shown.push(err); return {}; },
}));

import { reportUnexpected, __resetUnexpectedErrors } from '../../src/ui/unexpected-errors';
import { markProblemShown } from '../../src/core/problems';

beforeEach(() => { __resetUnexpectedErrors(); shown.length = 0; });

describe('reportUnexpected', () => {
  it('says a new failure once, never the same one twice', () => {
    expect(reportUnexpected(new Error('boom'))).toBe(true);
    expect(reportUnexpected(new Error('boom'))).toBe(false);
    expect(shown).toHaveLength(1);
  });

  it('stays quiet for a cancel, a stale code file, nothing, and one a site already showed', () => {
    expect(reportUnexpected(new DOMException('x', 'AbortError'))).toBe(false);
    expect(reportUnexpected(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(false);
    expect(reportUnexpected(undefined)).toBe(false);
    const err = new Error('handled');
    markProblemShown(err);
    expect(reportUnexpected(err)).toBe(false);
    expect(shown).toHaveLength(0);
  });

  it('says at most three per session', () => {
    for (let i = 0; i < 6; i++) reportUnexpected(new Error(`boom ${i}`));
    expect(shown).toHaveLength(3);
  });
});
