/**
 * keel's 403 `review_by_another` (the review profile, live 2026-11-11): below co-builder, a review mark that carries
 * a `by` is stored only as the element already holds it or with the writer's own membership id. A folder's
 * pack-written mark names a Character, so a contributor's create of that element is refused. The refusal is about
 * the element, never a dead key: it is said as its own kind, and the round goes on. Each case has its control.
 */
import { describe, it, expect } from 'vitest';
import { isAuthError } from '../../src/sync/sync-engine';
import { classifyFailure, describeFailures } from '../../src/sync/sync-failure-copy';
import { syncIssueLine } from '../../src/middle/settings-world';

const refusal = Object.assign(new Error('review by another'), { status: 403, code: 'review_by_another' });

describe("keel's review_by_another", () => {
  it('is not a dead key', () => {
    expect(isAuthError(refusal)).toBe(false);
    expect(isAuthError(Object.assign(new Error('x'), { status: 403, code: 'permission_error' }))).toBe(true); // the control
  });
  it('is said as its own kind, by element, in the toast and the issues list', () => {
    const f = { status: 403, code: 'review_by_another', element_id: 'c1', type: 'character', operation: 'create', message: 'x' } as never;
    expect(classifyFailure(f)).toBe('review_mark');
    expect(classifyFailure({ ...(f as object), code: 'permission_error' } as never)).toBe('other'); // the control
    const toast = describeFailures([f, { ...(f as object) } as never], 'browser');
    expect(toast).toMatch(/^1 element could not sync because it carries a review mark made by someone else/);
    expect(toast).toContain('only the world\'s owner or a co-builder can send such a mark');
    expect(toast).toContain('in this browser');
    expect(toast).not.toMatch(/PIN/);
    const line = syncIssueLine({ kind: 'review_mark', type: 'character', failure: f } as never, 'folder');
    expect(line).toContain('only the owner or a co-builder can send such a mark');
    expect(line).toContain('in the folder');
  });
});
