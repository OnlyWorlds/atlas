/**
 * The strand's mark over the wire (the contract's Proof, "Sync"; the code gate's C8): `x_strand` rides
 * the World's `x_` meta step (conv. 167). A mark the Story box writes here goes up in the `x_` PATCH; a
 * mark pulled from onlyworlds.com reaches world.json and the open world's mirror, which Home, the
 * writing room's bar and its frame read. And the server's side, as the conflict review asks for it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let client: FakeOwApiClient;
vi.mock('../../src/sync/ow-v2-client-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/ow-v2-client-adapter')>()),
  OwV2ClientAdapter: vi.fn(function () { return client; }), // a function, so `new` can construct it
}));

import { attachSyncEngine, detachSyncEngine } from '../../src/sync/sync-attach';
import { getState, patchSlice } from '../../src/core/state';
import { setActiveStore } from '../../src/core/active-store';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { __resetLiveFolderForTests } from '../../src/core/live-folder';
import { toastManager } from '../../src/ui/toast-manager';
import { writeStrandSlot } from '../../src/ui/strand-write';
import { strandView } from '../../src/core/strand';

const N = '0192a000-0000-7000-8000-000000000a01';
const E = '0192a000-0000-7000-8000-000000000b01';

const base: WorldRegistryEntry = {
  id: 'w1', name: 'The Ferry', state: 'api-linked',
  api: { world_id: 'srv-1', api_key: 'k1' },
  folder: { handle_key: 'vault-1', folder_name: 'ferry' },
  created_at: '2026-01-01T00:00:00Z',
  shared_with_others: false,
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const entryNow = () => getState().registry.worlds.find(w => w.id === 'w1')!;

let folder: MockFolderStore;

function patchBodies(): Array<Record<string, unknown>> {
  return client.calls
    .filter((c): c is { method: 'patchWorldMeta'; body: Record<string, unknown> } => (c as { method: string }).method === 'patchWorldMeta')
    .map(c => c.body);
}

beforeEach(async () => {
  detachSyncEngine();
  __resetLiveFolderForTests();
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
  vi.spyOn(toastManager, 'show').mockImplementation(() => {});
  patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [base] }, '1234'));
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'The Ferry' }, opened: true } as never);
  setActiveStore(folder as never);
});
afterEach(() => {
  detachSyncEngine();
  setActiveStore(null);
  vi.restoreAllMocks();
  patchSlice('active', null);
  patchSlice('data', { elements: [] } as never);
});

describe('the strand over the wire', () => {
  it('a mark the Story box writes here goes up in the x_ PATCH, and keel then holds it', async () => {
    await folder.createElementVerbatim('narrative', { id: N, type: 'narrative', name: 'The Long Road' } as unknown as Element);
    patchSlice('data', { elements: await folder.listElements(), loading: false } as never);
    const engine = attachSyncEngine(entryNow(), folder)!;
    await settle();
    await engine.syncNow();
    expect(await writeStrandSlot('narrative', { worldId: 'w1', narrative: null, event: null, location: null }, N)).toBe('wrote');
    await engine.syncNow();
    const sent = patchBodies().filter(b => 'x_strand' in b);
    expect(sent).toEqual([{ x_strand: { narrative: N, event: null, location: null } }]);
    expect((await client.getWorldMeta() as unknown as Record<string, unknown>).x_strand).toEqual({ narrative: N, event: null, location: null });
  });

  it('a mark pulled from onlyworlds.com reaches world.json and the open world\'s mirror, and reads as the strand', async () => {
    await client.createElement('narrative', { id: N, name: 'The Long Road', events: [E] });
    await client.createElement('event', { id: E, name: 'The Fire' });
    const engine = attachSyncEngine(entryNow(), folder)!;
    await settle();
    await engine.syncNow();
    client.__server_mutate_world_meta({ x_strand: { narrative: N, event: E, location: null } } as never);
    await engine.syncNow();
    await settle();
    await settle();
    const onDisk = (await folder.readWorldMeta() as unknown as Record<string, unknown>).x_strand;
    expect(onDisk).toEqual({ narrative: N, event: E, location: null });
    await vi.waitFor(() => expect((getState().active!.meta as unknown as Record<string, unknown>).x_strand).toEqual(onDisk));
    const read = strandView(getState().active!.meta, await folder.listElements());
    expect(read.narrative?.id).toBe(N);
    expect(read.event?.id).toBe(E);
    expect(patchBodies().filter(b => 'x_strand' in b)).toEqual([]);
  });

  it('the conflict review reads the server\'s side: the mark keel holds, and nothing for a world never given one', async () => {
    const engine = attachSyncEngine(entryNow(), folder)!;
    await settle();
    expect(await engine.serverExtValue('x_strand')).toBeUndefined();
    client.__server_mutate_world_meta({ x_strand: { narrative: N, event: null, location: null } } as never);
    expect(await engine.serverExtValue('x_strand')).toEqual({ narrative: N, event: null, location: null });
  });
});
