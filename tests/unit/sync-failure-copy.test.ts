import { describe, it, expect, beforeEach } from 'vitest';
import { classifyFailure, describeFailures, failureToastOnce, __resetFailureToasts } from '../../src/sync/sync-failure-copy';
import type { PerElementFailure } from '../../src/core/types';
import { syncIssueLine } from '../../src/middle/settings-world';
import { REPLACED_HELD_LINE } from '../../src/sync/sync-engine';

const f = (id: string, message: string): PerElementFailure => ({ element_id: id, type: 'character', operation: 'create', message });
// keel's own texts (elements/service.py _upsert_once, serialize.py) and atlas's read-back text.
const FOREIGN_BULK = 'An element with id x already exists in another world. give this element a new id (a copied world folder needs fresh ids).';
const FOREIGN_POST = 'this id already exists in another world';
// A 409 whose read-back FAILED proves nothing about which world holds the id.
const UNPROVEN_POST = 'id_conflict, and checking it failed: API Error 503: busy';
const TOO_LARGE = 'Extension fields may hold at most 65536 bytes per element (got 70000). Store large data elsewhere and link to it.';

beforeEach(() => __resetFailureToasts());

describe('sync failure copy', () => {
  it('classifies keel and atlas messages', () => {
    expect(classifyFailure(f('a', FOREIGN_BULK))).toBe('foreign_id');
    expect(classifyFailure(f('a', FOREIGN_POST))).toBe('foreign_id');
    expect(classifyFailure(f('a', UNPROVEN_POST))).toBe('other');
    expect(classifyFailure(f('a', 'server reported id_conflict but the element could not be read back'))).toBe('other');
    expect(classifyFailure(f('a', TOO_LARGE))).toBe('too_large');
    expect(classifyFailure(f('a', 'API Error 500: boom'))).toBe('other');
  });

  it('names the cause and never sends the user to "test connection"', () => {
    const text = describeFailures([f('a', FOREIGN_BULK), f('b', FOREIGN_POST), f('c', TOO_LARGE), f('d', 'API Error 500: boom')]);
    expect(text).toContain('2 elements could not upload because their ids already belong to another OnlyWorlds world');
    expect(text).toContain('1 element holds more than 64 KB');
    // The raw cause ("boom") never reaches the sentence; it rides in Details.
    expect(text).toContain('1 change could not sync. Atlas tries again with your next save.');
    expect(text).not.toContain('boom');
    expect(text).not.toMatch(/test connection/i);
    expect(text).not.toContain('—');
  });

  // From the Discord report: Chromium's stock text for a held file reached the toast verbatim.
  const HELD = 'An operation that depends on state cached in an interface object was made but the state had changed since it was read from disk.';
  const busy = (id: string): PerElementFailure => ({ ...f(id, HELD), error_name: 'InvalidStateError' });

  it('names a held file plainly and never shows the browser text', () => {
    expect(classifyFailure(busy('a'))).toBe('file_busy');
    expect(classifyFailure(f('a', HELD))).toBe('file_busy'); // name lost: the text still classifies
    expect(classifyFailure({ ...f('a', 'x'), error_name: 'NoModificationAllowedError' })).toBe('file_busy');
    const text = describeFailures([busy('a')]);
    expect(text).toContain('another program was using its file');
    expect(text).toContain('OneDrive');
    expect(text).not.toContain('interface object');
    expect(text).not.toContain('—');
  });

  it('a held file says what OnlyWorlds has by the step, and "in a moment" only where a retry is armed', () => {
    const at = (local_step: PerElementFailure['local_step'], extra: Partial<PerElementFailure> = {}): PerElementFailure =>
      ({ ...busy(local_step ?? 'plain'), source: 'disk', ...(local_step ? { local_step } : {}), ...extra });
    // One promise in one tense across the toast, Settings and the mark: "tries again".
    expect(describeFailures([at(undefined, { retry_armed: true })])).toContain('Atlas tries again in a moment.');
    expect(describeFailures([at(undefined)])).toContain('Atlas tries again with your next save.');
    expect(describeFailures([at(undefined)])).not.toContain('will try');
    expect(describeFailures([at(undefined)])).not.toContain('in a moment');
    expect(describeFailures([at('note', { retry_armed: true })])).toMatch(/^OnlyWorlds has 1 change, but Atlas could not note it on your disk because another program was using its file/);
    // An edit: no promise to resend, the conflict said instead.
    const edit = describeFailures([at('note_edit', { operation: 'update', retry_armed: true })]);
    expect(edit).toContain('The next sync may list it as a conflict; both copies hold your change.');
    expect(edit).not.toMatch(/tr(y|ies) again/);
    // OnlyWorlds refused the delete and kept the element: never "OnlyWorlds has 1 change".
    const back = describeFailures([at('put_back', { operation: 'delete', retry_armed: true })], 'browser');
    // "kept it when it was deleted here", as Settings says: never read as OnlyWorlds keeping it deleted.
    expect(back).toBe('OnlyWorlds kept 1 element when it was deleted here, but Atlas could not put it back in this browser because another Atlas tab was saving to this world. Atlas tries again in a moment.');
    expect(describeFailures([at('put_back', { operation: 'delete' }), { ...at('put_back', { operation: 'delete' }), element_id: 'second' }], 'browser'))
      .toMatch(/^OnlyWorlds kept 2 elements when they were deleted here, but Atlas could not put them back/);
    for (const step of ['remove', 'restore_links'] as const) {
      const t = describeFailures([at(step)]);
      expect(t).toContain('Settings, under This world, says what happened.');
      expect(t).not.toMatch(/try again/);
    }
  });

  it('keeps an element\'s first held-file failure quiet and says the second', () => {
    expect(failureToastOnce([busy('a')])).toBeNull();
    expect(failureToastOnce([busy('a')])).toContain('another program');
    expect(failureToastOnce([busy('a')])).toBeNull(); // then once per session, as every set
    // A held file beside another failure: the other one is still said at once.
    expect(failureToastOnce([busy('b'), f('c', FOREIGN_BULK)])).toContain('another OnlyWorlds world');
  });

  it('one round seen twice (result handler, then flush or Make online) keeps the first hold quiet (gate A L1)', () => {
    const round = [busy('q'), f('r', 'API Error 500: boom')];
    expect(failureToastOnce(round.filter(x => classifyFailure(x) !== 'other'))).toBeNull();
    expect(failureToastOnce(round)).toContain('1 change could not sync.');
    expect(failureToastOnce(round)).toBeNull();
  });

  it('counts a held world record once however many steps report it', () => {
    const w = (): PerElementFailure => ({ element_id: 'world', type: 'world', operation: 'update', message: HELD, error_name: 'InvalidStateError' });
    expect(describeFailures([busy('a'), w(), w()])).toContain('2 changes could not sync yet');
  });

  it('keel\'s keeper rule (403 keeper_only): every Charter Law and every Object a Law names, said as the element, never the mark or the API path', () => {
    const keeper = (id: string): PerElementFailure => ({ element_id: id, type: 'law', operation: 'update', status: 403, code: 'keeper_only', message: 'Only the world\'s owner and co-builders change this element. Nothing was written. Ask one of them, or propose the change: POST /api/v2/law/x/propose' });
    expect(classifyFailure(keeper('a'))).toBe('keeper_only');
    expect(describeFailures([keeper('a')])).toBe('1 change could not sync because only the owner and co-builders can change that element. Ask one of them. The change stays on your disk.');
    expect(describeFailures([keeper('a'), keeper('b')], 'browser')).toBe('2 changes could not sync because only the owner and co-builders can change those elements. Ask one of them. The changes stay in this browser.');
    const row = syncIssueLine({ kind: 'keeper_only', element_id: 'a', type: 'law', failure: keeper('a') } as never, 'folder');
    expect(row).toBe('Only the owner and co-builders can change it on OnlyWorlds. Ask one of them. Your change stays in the folder.');
    for (const line of [describeFailures([keeper('a')]), row]) {
      expect(line).not.toMatch(/charter|mark|\/api\/|propose/i);
    }
  });

  it('a create keel answered as replaced (a 200 under create-only) says what happened, and that the next save sends it again', () => {
    const replaced = (id: string): PerElementFailure => ({ element_id: id, type: 'character', operation: 'create', status: 200, source: 'server', message: REPLACED_HELD_LINE });
    expect(classifyFailure(replaced('a'))).toBe('replaced_held');
    expect(describeFailures([replaced('a')])).toBe('OnlyWorlds answered as if it had replaced an element it already held, though Atlas asked it only to create. The copy here is unchanged and not marked as sent; your next save sends it again.');
    expect(describeFailures([replaced('a'), replaced('b')])).toBe('OnlyWorlds answered as if it had replaced 2 elements it already held, though Atlas asked it only to create. The copies here are unchanged and not marked as sent; your next save sends them again.');
    const row = syncIssueLine({ kind: 'replaced_held', element_id: 'a', type: 'character', failure: replaced('a') } as never, 'folder');
    expect(row).toBe('OnlyWorlds answered as if it had replaced a copy it already held, though Atlas asked it only to create one. The copy here is unchanged and not marked as sent. Your next save sends it again, and Atlas compares it with the copy OnlyWorlds holds.');
    for (const line of [describeFailures([replaced('a')]), row]) expect(line).not.toMatch(/tries again/);
  });

  it('shows a persistent failure set once per session', () => {
    const set = [f('a', FOREIGN_BULK)];
    expect(failureToastOnce(set)).toBeTruthy();
    expect(failureToastOnce(set)).toBeNull();
    expect(failureToastOnce([f('a', FOREIGN_BULK), f('b', FOREIGN_BULK)])).toBeTruthy();
    expect(failureToastOnce([])).toBeNull();
  });
});
