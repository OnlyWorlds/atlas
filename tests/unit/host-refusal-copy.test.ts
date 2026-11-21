/**
 * The words for the web host's refusal of a write (R6): the kind is keyed on
 * the failure's status and an absent keel code, never its text. Two tiers:
 * the host's "Blocked" page (`host_blocked`) names its usual cause and what
 * to do; any other refusal by the host says only that the host refused the
 * change before it reached OnlyWorlds and that nothing was lost. Never the
 * key, the PIN, Settings or signing in.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { classifyFailure, describeFailures, failureToastOnce, __resetFailureToasts } from '../../src/sync/sync-failure-copy';
import { syncIssueLine } from '../../src/middle/settings-world';
import type { PerElementFailure } from '../../src/core/types';

const PAGE = 'API Error 403: <!DOCTYPE html><html><head><title>Blocked</title></head></html>';
/** The host's Blocked page. */
const blockedF = (id: string, extra: Partial<PerElementFailure> = {}): PerElementFailure =>
  ({ element_id: id, type: 'character', operation: 'update', message: PAGE, status: 403, source: 'server', host_blocked: true, ...extra });
/** Another refusal by the host: a 403 with no keel code, not the Blocked page. */
const otherF = (id: string, extra: Partial<PerElementFailure> = {}): PerElementFailure =>
  ({ element_id: id, type: 'character', operation: 'update', message: 'API Error 403: <html></html>', status: 403, source: 'server', ...extra });

/** What the words must never send a person to for this kind. */
const NEVER = /\bkey\b|\bPIN\b|Settings|sign in|sign-in|signing in/i;
const CAUSE = 'A command written between code marks, such as `python -m`, is the usual cause: write it without the marks, or in a code block that names its language, and it goes up.';

beforeEach(() => __resetFailureToasts());

describe('classifyFailure: host_refused by status and absent code', () => {
  it('a 403 with no keel code is the host\'s, either tier; keel\'s coded 403s, a 401 and a 429 are not', () => {
    expect(classifyFailure(blockedF('a'))).toBe('host_refused');
    expect(classifyFailure(otherF('a'))).toBe('host_refused');
    // The page's text is not what decides: the same record with a code is keel's.
    expect(classifyFailure(blockedF('a', { code: 'permission_error' }))).toBe('other');
    expect(classifyFailure(otherF('a', { code: 'unknown' }))).toBe('other');
    expect(classifyFailure(otherF('a', { code: 'not_author' }))).toBe('not_yours');
    expect(classifyFailure(otherF('a', { code: 'keeper_only' }))).toBe('keeper_only');
    expect(classifyFailure(otherF('a', { status: 401 }))).toBe('other');
    expect(classifyFailure(otherF('a', { status: 429 }))).toBe('other');
    // No status at all (a disk failure, an old record) is never the host's.
    expect(classifyFailure({ element_id: 'a', type: 'character', operation: 'update', message: PAGE })).toBe('other');
  });
});

describe('the toast: the Blocked page names its cause', () => {
  it('one change: the host, before OnlyWorlds, the usual cause, what to do, nothing lost', () => {
    const text = describeFailures([blockedF('a')]);
    expect(text).toBe(`1 change was refused by the web host in front of OnlyWorlds before it reached OnlyWorlds. ${CAUSE} Nothing was lost: the change stays on your disk.`);
    expect(text).not.toMatch(NEVER);
    expect(text).not.toContain('—');
    expect(text).not.toContain('DOCTYPE');
  });

  it('counts elements, not records, and says the browser\'s place word', () => {
    const text = describeFailures([blockedF('a'), blockedF('a', { operation: 'create' }), blockedF('b')], 'browser');
    expect(text).toContain('2 changes were refused by the web host in front of OnlyWorlds before they reached OnlyWorlds.');
    expect(text).toContain('Nothing was lost: the changes stay in this browser.');
  });

  it('the world\'s details are named as such, not as an element', () => {
    const text = describeFailures([blockedF('world', { type: 'world', element_id: 'world' })]);
    expect(text).toBe(`A change to this world's details was refused by the web host in front of OnlyWorlds before it reached OnlyWorlds. ${CAUSE} Nothing was lost: the change stays on your disk.`);
    expect(text).not.toMatch(NEVER);
  });

  it('the toast says it once per set', () => {
    expect(failureToastOnce([blockedF('a')])).toContain('web host');
    expect(failureToastOnce([blockedF('a')])).toBeNull();
  });
});

describe('the toast: any other refusal by the host guesses no cause', () => {
  it('says the host refused it before OnlyWorlds and nothing was lost, and no more', () => {
    expect(describeFailures([otherF('a')])).toBe('1 change was refused by the web host in front of OnlyWorlds before it reached OnlyWorlds. Nothing was lost: the change stays on your disk.');
    expect(describeFailures([otherF('world', { type: 'world', element_id: 'world' })], 'browser'))
      .toBe('A change to this world\'s details was refused by the web host in front of OnlyWorlds before it reached OnlyWorlds. Nothing was lost: the change stays in this browser.');
    expect(describeFailures([otherF('a')])).not.toMatch(/code mark|python|usual cause/);
  });

  it('both tiers in one round are each said with their own words', () => {
    const text = describeFailures([blockedF('a'), otherF('b'), otherF('c')]);
    expect(text).toContain(`1 change was refused by the web host in front of OnlyWorlds before it reached OnlyWorlds. ${CAUSE}`);
    expect(text).toContain('2 changes were refused by the web host in front of OnlyWorlds before they reached OnlyWorlds. Nothing was lost: the changes stay on your disk.');
    expect(text.match(/usual cause/g)).toHaveLength(1);
    expect(text).not.toMatch(NEVER);
  });
});

describe('the Not syncing row', () => {
  it('says the same facts, per tier, in both places, for an element and the world', () => {
    for (const where of ['folder', 'browser'] as const) {
      for (const type of ['character', 'world'] as const) {
        const place = where === 'folder' ? 'in the folder' : 'in this browser';
        const blocked = syncIssueLine({ kind: 'host_refused', type, failure: blockedF('a', { type }) } as never, where);
        expect(blocked).toBe(`The web host in front of OnlyWorlds refused the change before it reached OnlyWorlds. ${CAUSE} Nothing was lost: your change stays ${place}.`);
        const other = syncIssueLine({ kind: 'host_refused', type, failure: otherF('a', { type }) } as never, where);
        expect(other).toBe(`The web host in front of OnlyWorlds refused the change before it reached OnlyWorlds. Nothing was lost: your change stays ${place}.`);
        for (const line of [blocked, other]) {
          expect(line).not.toMatch(NEVER);
          expect(line).not.toContain('—');
        }
      }
    }
  });
});
