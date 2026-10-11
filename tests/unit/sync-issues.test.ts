/**
 * The Sync issues list (S369): what is still not syncing, per world.
 * A push or sync round replaces it; a pull or a round that stopped early adds.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { noteRoundIssues, issuesFor, clearSyncIssues, __resetSyncIssues } from '../../src/sync/sync-issues';
import { syncIssueLine } from '../../src/middle/settings-world';
import type { PerElementFailure } from '../../src/core/types';

const fail = (id: string, extra: Partial<PerElementFailure> = {}): PerElementFailure => ({
  element_id: id, type: 'character', operation: 'update', message: 'boom', ...extra,
});
const round = (failures: PerElementFailure[], flags: { auth_blocked?: boolean; transient_blocked?: boolean } = {}) =>
  ({ failures, auth_blocked: flags.auth_blocked ?? false, transient_blocked: flags.transient_blocked ?? false });

beforeEach(() => __resetSyncIssues());

describe('noteRoundIssues', () => {
  it('a push round replaces the list: an element that did not fail again synced', () => {
    noteRoundIssues('w', 'push', round([fail('a'), fail('b')]));
    expect(issuesFor('w').map(i => i.element_id).sort()).toEqual(['a', 'b']);
    noteRoundIssues('w', 'push', round([fail('b')]));
    expect(issuesFor('w').map(i => i.element_id)).toEqual(['b']);
    noteRoundIssues('w', 'sync', round([]));
    expect(issuesFor('w')).toEqual([]);
  });

  it('a pull round and a round that stopped early only add', () => {
    noteRoundIssues('w', 'push', round([fail('a')]));
    noteRoundIssues('w', 'pull', round([]));
    noteRoundIssues('w', 'push', round([], { transient_blocked: true }));
    noteRoundIssues('w', 'push', round([fail('c')], { auth_blocked: true }));
    expect(issuesFor('w').map(i => i.element_id).sort()).toEqual(['a', 'c']);
  });

  it('keeps when an element first failed and counts the rounds', () => {
    noteRoundIssues('w', 'push', round([fail('a')]), '2026-10-04T10:00:00Z');
    noteRoundIssues('w', 'push', round([fail('a')]), '2026-10-04T10:05:00Z');
    const [a] = issuesFor('w');
    expect(a.since).toBe('2026-10-04T10:00:00Z');
    expect(a.rounds).toBe(2);
  });

  it('is per world, sorted most actionable first, and clears', () => {
    noteRoundIssues('w', 'push', round([
      fail('busy', { error_name: 'InvalidStateError' }),
      fail('other'),
      fail('foreign', { operation: 'create', message: 'this id already exists in another world' }),
    ]));
    noteRoundIssues('v', 'push', round([fail('x')]));
    expect(issuesFor('w').map(i => i.kind)).toEqual(['foreign_id', 'other', 'file_busy']);
    expect(issuesFor('v')).toHaveLength(1);
    clearSyncIssues('w');
    expect(issuesFor('w')).toEqual([]);
    expect(issuesFor('v')).toHaveLength(1);
  });

  it('says whether the list moved', () => {
    expect(noteRoundIssues('w', 'push', round([]))).toBe(false);
    expect(noteRoundIssues('w', 'push', round([fail('a')]))).toBe(true);
    expect(noteRoundIssues('w', 'push', round([]))).toBe(true);
  });
});

describe('syncIssueLine', () => {
  const issueOf = (f: PerElementFailure) => {
    __resetSyncIssues();
    noteRoundIssues('w', 'push', round([f]));
    return issuesFor('w')[0];
  };

  it('never repeats server or browser text', () => {
    const planted = 'Aldric Vane is not a valid location';
    for (const f of [
      fail('a', { message: planted }),
      fail('a', { message: planted, status: 422, code: 'invalid', param: 'location', source: 'server' }),
      fail('a', { message: planted, status: 422, param: 'x_lair', source: 'server' }),
      fail('a', { message: planted, status: 503, source: 'server' }),
      fail('a', { message: planted, source: 'disk', error_name: 'NotReadableError' }),
      fail('a', { message: planted, error_name: 'InvalidStateError' }),
    ]) {
      const line = syncIssueLine(issueOf(f));
      expect(line).not.toMatch(/aldric|lair/i);
      expect(line).not.toContain('—');
    }
  });

  it('names a schema field, never a custom one', () => {
    expect(syncIssueLine(issueOf(fail('a', { status: 422, param: 'birth_location', source: 'server' })))).toContain('its birth location field');
    expect(syncIssueLine(issueOf(fail('a', { status: 422, param: 'x_lair', source: 'server' })))).not.toContain('field');
  });

  it('explains the waits Atlas itself writes', () => {
    expect(syncIssueLine(issueOf(fail('a', { message: 'waits for an element OnlyWorlds refused in the same upload' }))))
      .toContain('waits for that one');
  });
});
