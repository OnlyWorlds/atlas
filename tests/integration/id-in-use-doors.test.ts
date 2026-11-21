/**
 * An id a membership holds (keel's "already in use", conv. 108 and 192 R5), at every door a person meets
 * it: Settings' new-id row as `foreignIdsFor` answers it, the round's toast and Make online's toast (their
 * New ids fix), the sentence in a folder and in this browser, and the worklist taking the newer evidence.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { foreignIdsFor } from '../../src/sync/rekey-run';
import { foreignRowLine } from '../../src/middle/settings-world';
import { failureFixIds } from '../../src/sync/sync-attach';
import { newIdsFix } from '../../src/ui/make-online-modal';
import { classifyFailure, describeFailures } from '../../src/sync/sync-failure-copy';
import { mergeForeignIds } from '../../src/sync/foreign-ids';
import { ID_IN_USE_LINE } from '../../src/sync/sync-engine';
import type { PerElementFailure, WorldRegistryEntry } from '../../src/core/types';

const API_WORLD = 'w-api';
const entry = { id: 'local-1', name: 'Here', state: 'api-linked', api: { world_id: API_WORLD, api_key: 'ow_w_k', world_name: 'Here' }, folder: { handle_key: 'k', folder_name: 'here' }, created_at: '2026-01-01T00:00:00Z' } as unknown as WorldRegistryEntry;
const inUse = (id = 'x'): PerElementFailure => ({ element_id: id, type: 'character', operation: 'create', status: 409, code: 'id_conflict', source: 'server', message: ID_IN_USE_LINE });
const anotherWorld = (id = 'y'): PerElementFailure => ({ element_id: id, type: 'character', operation: 'create', status: 409, code: 'id_conflict', source: 'server', message: 'this id already exists in another world' });

describe('Settings\' new-id row, as foreignIdsFor answers it', () => {
  it('says an id a membership holds is in use, never another world\'s, and counts both kinds', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    const x = await store.createElement('character', { name: 'Used' });
    const y = await store.createElement('character', { name: 'Elsewhere' });
    await store.updateSyncState(() => ({ foreign: { api_world_id: API_WORLD, ids: [{ id: x.id, type: 'character', first_seen: 't', in_use: true }] } }));
    expect(foreignRowLine(await foreignIdsFor(store as never, entry))).toBe('1 element could not upload: its id is already in use on OnlyWorlds.');
    await store.updateSyncState(() => ({ foreign: { api_world_id: API_WORLD, ids: [
      { id: x.id, type: 'character', first_seen: 't', in_use: true },
      { id: y.id, type: 'character', first_seen: 't' },
    ] } }));
    expect(foreignRowLine(await foreignIdsFor(store as never, entry))).toBe('2 elements could not upload: their ids are already taken on OnlyWorlds, 1 in use and 1 by another world.');
  });
});

describe('the toasts\' fix for an id in use', () => {
  it('the round\'s toast offers new ids, never only the list of what is not syncing', () => {
    expect(failureFixIds([inUse()])).toEqual(['new-ids']);
    expect(failureFixIds([anotherWorld()])).toEqual(['new-ids']);
    expect(failureFixIds([{ ...inUse(), code: undefined, message: 'boom' }])).toEqual(['sync-issues']);
  });

  it('Make online\'s toast offers new ids', () => {
    expect(newIdsFix([inUse()], 'w').map(a => a.label)).toEqual(['Give new ids']);
    expect(newIdsFix([{ ...inUse(), code: undefined, message: 'boom' }], 'w')).toEqual([]);
  });
});

describe('the in-use sentence and its kind', () => {
  it('says where the element stays: on the disk for a folder, in this browser for a browser world', () => {
    expect(describeFailures([inUse()], 'folder')).toBe('1 element could not upload because its id is already in use on OnlyWorlds. It stays safe on your disk, and Settings, under This world, can give it a new id.');
    expect(describeFailures([inUse('a'), inUse('b')], 'browser')).toBe('2 elements could not upload because their ids are already in use on OnlyWorlds. They stay safe in this browser, and Settings, under This world, can give them new ids.');
  });

  it('is keel\'s id_conflict only: a bare 409 with the same words (an idempotency refusal) is not it', () => {
    expect(classifyFailure(inUse())).toBe('id_in_use');
    expect(classifyFailure({ ...inUse(), code: 'idempotency_error' })).not.toBe('id_in_use');
  });
});

describe('the worklist takes the newer evidence', () => {
  const unsynced = new Set(['x']);
  it('an id first another world\'s, then a membership\'s, is in use; and back again, it is not; when it was first seen stays', () => {
    const r1 = mergeForeignIds(undefined, API_WORLD, [{ id: 'x', type: 'character' }], unsynced, 't1', new Set(['x']));
    expect(r1.ids).toEqual([{ id: 'x', type: 'character', first_seen: 't1' }]);
    const r2 = mergeForeignIds(r1, API_WORLD, [{ id: 'x', type: 'character', in_use: true }], unsynced, 't2', new Set(['x']));
    expect(r2.ids).toEqual([{ id: 'x', type: 'character', first_seen: 't1', in_use: true }]);
    const r3 = mergeForeignIds(r2, API_WORLD, [{ id: 'x', type: 'character' }], unsynced, 't3', new Set(['x']));
    expect(r3.ids).toEqual([{ id: 'x', type: 'character', first_seen: 't1' }]);
  });

  it('a round that did not send it keeps the carried flag; a send that was not refused again takes it off the list', () => {
    const held = { api_world_id: API_WORLD, ids: [{ id: 'x', type: 'character' as const, first_seen: 't1', in_use: true as const }] };
    expect(mergeForeignIds(held, API_WORLD, [], unsynced, 't2').ids).toEqual(held.ids);
    expect(mergeForeignIds(held, API_WORLD, [], unsynced, 't2', new Set(['x'])).ids).toEqual([]);
  });
});
