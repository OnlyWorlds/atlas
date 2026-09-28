import { describe, it, expect, beforeEach } from 'vitest';
import { classifyFailure, describeFailures, failureToastOnce, __resetFailureToasts } from '../../src/sync/sync-failure-copy';
import type { PerElementFailure } from '../../src/core/types';

const f = (id: string, message: string): PerElementFailure => ({ element_id: id, type: 'character', operation: 'create', message });
// keel's own texts (elements/service.py _upsert_once, serialize.py) and atlas's read-back text.
const FOREIGN_BULK = 'An element with id x already exists in another world. give this element a new id (a copied world folder needs fresh ids).';
const FOREIGN_POST = 'server reported id_conflict but the element could not be read back';
const TOO_LARGE = 'Extension fields may hold at most 65536 bytes per element (got 70000). Store large data elsewhere and link to it.';

beforeEach(() => __resetFailureToasts());

describe('sync failure copy (S360)', () => {
  it('classifies keel and atlas messages', () => {
    expect(classifyFailure(f('a', FOREIGN_BULK))).toBe('foreign_id');
    expect(classifyFailure(f('a', FOREIGN_POST))).toBe('foreign_id');
    expect(classifyFailure(f('a', TOO_LARGE))).toBe('too_large');
    expect(classifyFailure(f('a', 'API Error 500: boom'))).toBe('other');
  });

  it('names the cause and never sends the user to "test connection"', () => {
    const text = describeFailures([f('a', FOREIGN_BULK), f('b', FOREIGN_POST), f('c', TOO_LARGE), f('d', 'API Error 500: boom')]);
    expect(text).toContain('2 elements could not upload because their ids already belong to another OnlyWorlds world');
    expect(text).toContain('1 element holds more than 64 KB');
    expect(text).toContain('1 change could not sync (boom)');
    expect(text).not.toMatch(/test connection/i);
    expect(text).not.toContain('—');
  });

  it('shows a persistent failure set once per session', () => {
    const set = [f('a', FOREIGN_BULK)];
    expect(failureToastOnce(set)).toBeTruthy();
    expect(failureToastOnce(set)).toBeNull();
    expect(failureToastOnce([f('a', FOREIGN_BULK), f('b', FOREIGN_BULK)])).toBeTruthy();
    expect(failureToastOnce([])).toBeNull();
  });
});
