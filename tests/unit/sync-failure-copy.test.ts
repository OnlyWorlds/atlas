import { describe, it, expect, beforeEach } from 'vitest';
import { classifyFailure, describeFailures, failureToastOnce, __resetFailureToasts } from '../../src/sync/sync-failure-copy';
import type { PerElementFailure } from '../../src/core/types';

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
    expect(text).toContain('1 change could not sync. Atlas will try again with your next save.');
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

  it('shows a persistent failure set once per session', () => {
    const set = [f('a', FOREIGN_BULK)];
    expect(failureToastOnce(set)).toBeTruthy();
    expect(failureToastOnce(set)).toBeNull();
    expect(failureToastOnce([f('a', FOREIGN_BULK), f('b', FOREIGN_BULK)])).toBeTruthy();
    expect(failureToastOnce([])).toBeNull();
  });
});
