/**
 * conv. 192 at the attach: a round's rows for a copy with no record of what
 * OnlyWorlds held are never a local-wins overwrite. Under local-wins the
 * pull's row sets off no convergence push (R5) and the push's is never said
 * as "Your version replaced the online one"; the line says the row waits.
 * A `/bulk` slot that replaced an element is said (S5).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { attachSyncEngine, detachSyncEngine, getCurrentSyncEngine, getCurrentSyncWorldId, __test_emitConflictToasts, heldCopyLine, bulkReplacedLine } from '../../src/sync/sync-attach';
import { toastManager } from '../../src/ui/toast-manager';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { WorldRegistryEntry, SyncResult, Conflict } from '../../src/core/types';

const entry: WorldRegistryEntry = {
  id: 'w1', name: 'A', state: 'api-linked',
  api: { world_id: 'srv-w1', api_key: 'key-w1' },
  folder: { handle_key: 'vault-w1', folder_name: 'A' },
  created_at: '2026-01-01T00:00:00Z',
};
const row = (noBaseline: boolean): Conflict => ({
  element_id: 'c1', type: 'character', detected_at: 't', local_updated_at: 'l', server_updated_at: 's', fields: ['description'],
  ...(noBaseline ? { no_baseline: true as const } : {}),
});
const result = (conflicts: Conflict[], extra: Partial<SyncResult> = {}): SyncResult => ({
  pushed: { creates: 0, updates: 0, deletes: 0 }, pulled: { creates: 0, updates: 0, deletes: 0 }, conflicts, failures: [], ...extra,
});
const localWins = () => ({ worldId: getCurrentSyncWorldId(), current: true, policy: 'local-wins' as const });

let said: string[];
beforeEach(async () => {
  vi.useFakeTimers();
  detachSyncEngine();
  patchSlice('registry', setPin(defaultRegistry(), '1234'));
  const folder = new MockFolderStore();
  await folder.open(null);
  attachSyncEngine(entry, folder);
  said = [];
  for (const k of ['show', 'info', 'success', 'error'] as const) {
    vi.spyOn(toastManager, k).mockImplementation(((text: string) => { said.push(text); }) as never);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  detachSyncEngine();
});

describe('a row with no record under local-wins', () => {
  it('a pull\'s row sets off no convergence push, and the line says it waits', async () => {
    const push = vi.spyOn(getCurrentSyncEngine()!, 'pushOnce').mockResolvedValue(result([]));
    __test_emitConflictToasts('pull', result([row(true)]), localWins());
    vi.advanceTimersByTime(0);
    await Promise.resolve();
    expect(push).not.toHaveBeenCalled();
    expect(said).toEqual([heldCopyLine(1)]);
  });

  it('a push\'s row is never said as replaced; a plain conflict still is', () => {
    __test_emitConflictToasts('push', result([row(true)]), localWins());
    expect(said).toEqual([heldCopyLine(1)]);
    said = [];
    __test_emitConflictToasts('push', result([row(false)]), localWins());
    expect(said).toEqual(['Your version replaced the online one for 1 element']);
  });

  it('S5: a /bulk slot that replaced an element is said', () => {
    __test_emitConflictToasts('push', result([], { bulk_replaced_ids: ['c1'] }), localWins());
    expect(said).toEqual([bulkReplacedLine(1)]);
  });
});
