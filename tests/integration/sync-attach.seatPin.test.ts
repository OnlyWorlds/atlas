/**
 * The engine for a seat world sends that seat's own secret; every other
 * world sends the account PIN (#104, contract R1). Before #104 the PIN was
 * one global field, so a seat world either sent the account PIN (keel refuses
 * it on a seat) or made the seat secret everyone's PIN.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const seen = vi.hoisted(() => [] as string[]);
vi.mock('../../src/sync/ow-v2-client-adapter', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/sync/ow-v2-client-adapter')>();
  class Recording extends m.OwV2ClientAdapter {
    constructor(opts: ConstructorParameters<typeof m.OwV2ClientAdapter>[0]) {
      super(opts);
      seen.push(opts.apiPin);
    }
  }
  return { ...m, OwV2ClientAdapter: Recording };
});

import { attachSyncEngine, detachSyncEngine, diagnoseSyncUnavailable } from '../../src/sync/sync-attach';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const SECRET = 'ow_s_' + 'd'.repeat(32);

function entry(id: string, api: WorldRegistryEntry['api']): WorldRegistryEntry {
  return {
    id, name: id, state: 'api-linked', api,
    folder: { handle_key: `vault-${id}`, folder_name: id },
    created_at: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  detachSyncEngine();
  seen.length = 0;
  patchSlice('registry', { ...defaultRegistry(), pin: '1234', sync_pause_all: true });
});

describe('the PIN an engine sends', () => {
  it('a seat world: its own secret; an account world: the account PIN', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    expect(attachSyncEngine(entry('seat', { world_id: 's', api_key: 'ow_w_s', seat: { role: 'contributor' }, seat_secret: SECRET }), folder)).not.toBeNull();
    expect(attachSyncEngine(entry('mine', { world_id: 'm', api_key: 'ow_w_m' }), folder)).not.toBeNull();
    expect(seen).toEqual([SECRET, '1234']);
    detachSyncEngine();
  });

  it('a seat world without its secret never falls back to the account PIN', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    const lost = entry('lost', { world_id: 'l', api_key: 'ow_w_l', seat: {} });
    patchSlice('registry', { ...getState().registry, worlds: [lost] });
    patchSlice('active', { worldId: 'lost', meta: { id: 'l', name: 'lost' }, opened: true });
    expect(attachSyncEngine(lost, folder)).toBeNull();
    expect(seen).toEqual([]);
    expect(diagnoseSyncUnavailable()).toEqual({ kind: 'seat-secret-missing', worldId: 'lost' });
    patchSlice('active', null);
  });
});
