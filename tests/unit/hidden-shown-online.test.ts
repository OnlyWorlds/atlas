/**
 * keel's word on the hidden mark (conv. 170): the pieces
 * the engine guards lean on. `hiddenWordOf` reads an answer, `stampedBody`
 * keeps the word only while the file holds the mark, the line says "Hidden here
 * only" on the word, an import drops it (another world's word), and a conflict
 * never lists it as a field.
 */
import { describe, it, expect } from 'vitest';
import {
  HIDDEN_FOLDER_LINE, HIDDEN_HERE_ONLY_LINE, HIDDEN_MARK_LINE, HIDDEN_SHOWN_ONLINE, hiddenMarkLine, hiddenWordOf,
} from '../../src/core/hidden-mark';
import { stampedBody } from '../../src/store/sync-stamp';
import { normalizeRecord } from '../../src/import/normalize';
import { diffFieldNames } from '../../src/sync/sync-engine';
import { ATLAS_LOCAL_ONLY_FIELDS } from '../../src/core/constants';
import type { Element } from '../../src/core/types';

const base = { id: 'w', type: 'character', name: 'Wren', local_updated_at: '2026-10-24T10:00:00.000Z', server_updated_at: '2026-10-24T09:00:00.000Z' };
const el = (extra: Record<string, unknown>) => ({ ...base, ...extra }) as unknown as Element;
const STAMP = '2026-10-24T11:00:00.000Z';

describe('hiddenWordOf', () => {
  it('an answer without the mark shows it; with it, keel hides it; no answer, no word', () => {
    expect(hiddenWordOf({ id: 'w' })).toEqual({ [HIDDEN_SHOWN_ONLINE]: true });
    expect(hiddenWordOf({ id: 'w', hidden: true })).toEqual({ [HIDDEN_SHOWN_ONLINE]: false });
    expect(hiddenWordOf(undefined)).toBeUndefined();
    expect(hiddenWordOf(null)).toBeUndefined();
  });
});

describe('stampedBody keeps the word only while the file holds the mark', () => {
  it('the mark here and keel showing it: kept', () => {
    const out = stampedBody(el({ hidden: true }), STAMP, base.local_updated_at, hiddenWordOf({ id: 'w' })) as unknown as Record<string, unknown>;
    expect(out[HIDDEN_SHOWN_ONLINE]).toBe(true);
  });
  it('keel hiding it: gone', () => {
    const out = stampedBody(el({ hidden: true, [HIDDEN_SHOWN_ONLINE]: true }), STAMP, base.local_updated_at, hiddenWordOf({ id: 'w', hidden: true }));
    expect(out).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  });
  it('no mark here: gone, whatever keel said', () => {
    const out = stampedBody(el({ hidden: null, [HIDDEN_SHOWN_ONLINE]: true }), STAMP, base.local_updated_at, hiddenWordOf({ id: 'w' }));
    expect(out).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  });
  it('a first stamp with no answer body (a /bulk create) never keeps a word a cleared baseline left', () => {
    const unsynced = el({ hidden: true, [HIDDEN_SHOWN_ONLINE]: true, server_updated_at: undefined });
    expect(stampedBody(unsynced, STAMP, base.local_updated_at)).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
    // An adopted copy that says keel shows it still counts on a first stamp.
    const adopted = stampedBody(el({ hidden: true, server_updated_at: undefined }), STAMP, base.local_updated_at, hiddenWordOf({ id: 'w' })) as unknown as Record<string, unknown>;
    expect(adopted[HIDDEN_SHOWN_ONLINE]).toBe(true);
  });
  it('an answer with no body leaves the word as it was', () => {
    const out = stampedBody(el({ hidden: true, [HIDDEN_SHOWN_ONLINE]: true }), STAMP, base.local_updated_at) as unknown as Record<string, unknown>;
    expect(out[HIDDEN_SHOWN_ONLINE]).toBe(true);
    expect(stampedBody(el({ hidden: true }), STAMP, base.local_updated_at)).not.toHaveProperty(HIDDEN_SHOWN_ONLINE);
  });
});

describe('the line', () => {
  it('Hidden here only on the word, Hidden on OnlyWorlds without it, the folder line off the server', () => {
    expect(hiddenMarkLine(el({ hidden: true, [HIDDEN_SHOWN_ONLINE]: true }), 'api-linked')).toBe(HIDDEN_HERE_ONLY_LINE);
    expect(hiddenMarkLine(el({ hidden: true }), 'api-linked')).toBe(HIDDEN_MARK_LINE);
    expect(hiddenMarkLine(el({ hidden: true, [HIDDEN_SHOWN_ONLINE]: true }), 'folder')).toBe(HIDDEN_FOLDER_LINE);
    expect(hiddenMarkLine(el({ [HIDDEN_SHOWN_ONLINE]: true }), 'api-linked')).toBeNull();
  });
  it('says no em-dash and no promise keel is not keeping', () => {
    expect(HIDDEN_HERE_ONLY_LINE).not.toMatch(/—/);
    expect(HIDDEN_HERE_ONLY_LINE).toMatch(/still shows it/);
  });
});

describe('the word is metadata', () => {
  it('local-only, so the adapter strips it from every write', () => {
    expect(ATLAS_LOCAL_ONLY_FIELDS).toContain(HIDDEN_SHOWN_ONLINE);
  });
  it('an import drops it, keeping the mark', () => {
    const { record } = normalizeRecord({ name: 'Wren', hidden: true, [HIDDEN_SHOWN_ONLINE]: true }, 'character');
    expect(record[HIDDEN_SHOWN_ONLINE]).toBeUndefined();
    expect(record.hidden).toBe(true);
  });
  it('a conflict never lists it', () => {
    expect(diffFieldNames(el({ hidden: true, [HIDDEN_SHOWN_ONLINE]: true }), { ...base, hidden: true })).toEqual([]);
  });
});
