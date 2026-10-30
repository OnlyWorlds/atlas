/**
 * The key's own membership (contract H6): a round that reads `/me` keeps
 * `membership` on the registry entry beside `member_role`, so `mayChange` can
 * tell a contributor's own element after a pull (its `created_by` is that
 * membership). A new key forgets it with the role.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let client: FakeOwApiClient;
vi.mock('../../src/sync/ow-v2-client-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/ow-v2-client-adapter')>()),
  OwV2ClientAdapter: vi.fn(function () { return client; }),
}));

import { attachSyncEngine, detachSyncEngine } from '../../src/sync/sync-attach';
import { putKeyInPlace } from '../../src/sync/world-key';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { __resetLiveFolderForTests } from '../../src/core/live-folder';
import { toastManager } from '../../src/ui/toast-manager';
import { mayChange } from '../../src/core/may-change';

const A = '00000000-0000-4000-8000-0000000b0001';
const ME = 'mem-0001';

const base = (api: Partial<NonNullable<WorldRegistryEntry['api']>> = {}): WorldRegistryEntry => ({
  id: 'w1', name: 'The Ferry', state: 'api-linked',
  api: { world_id: 'srv-1', api_key: 'k1', ...api },
  folder: { handle_key: 'vault-1', folder_name: 'ferry' },
  created_at: '2026-01-01T00:00:00Z',
  shared_with_others: false,
});
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const entryNow = () => getState().registry.worlds.find(w => w.id === 'w1')!;

let folder: MockFolderStore;
let shown: string[];

async function setup(api: Partial<NonNullable<WorldRegistryEntry['api']>> = {}): Promise<void> {
  detachSyncEngine();
  __resetLiveFolderForTests();
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  client.__enable_changes();
  shown = [];
  vi.spyOn(toastManager, 'show').mockImplementation((m: string) => { shown.push(m); });
  patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [base(api)] }, '1234'));
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'The Ferry' }, opened: true } as never);
}

async function oneRound(): Promise<void> {
  const engine = attachSyncEngine(entryNow(), folder)!;
  await settle();
  await engine.pullNow();
  await settle();
}

beforeEach(() => setup());
afterEach(() => { detachSyncEngine(); vi.restoreAllMocks(); patchSlice('active', null); });

describe('the membership, kept beside the role', () => {
  it('a contributor\'s round keeps its membership, and its own element pulled back stays changeable', async () => {
    await client.createElement('character', { id: A, name: 'Cy' });
    client.keyRole = 'contributor';
    client.keyMembership = ME;
    await oneRound();
    expect(entryNow().api?.member_role).toBe('contributor');
    expect(entryNow().api?.membership).toBe(ME);
    // The fake's create drops `created_by` (it is server-authored): the body as keel serves it after a pull.
    const cy = { ...(await folder.getElement(A))!, created_by: ME } as never;
    expect(mayChange(entryNow(), cy)).toBe(true);
    expect(mayChange(entryNow(), { ...(cy as object), created_by: 'mem-other' } as never)).toBe(false);
    expect(mayChange(entryNow(), { ...(cy as object), created_by: null } as never)).toBe(false);
  });

  it('the owner\'s membership is kept as null', async () => {
    client.keyRole = 'owner';
    client.keyMembership = null;
    await oneRound();
    expect(entryNow().api?.member_role).toBe('owner');
    expect(entryNow().api?.membership).toBeNull();
  });

  it('a membership arriving with an unchanged role is kept, and says nothing', async () => {
    await setup({ member_role: 'contributor' });
    client.keyRole = 'contributor';
    client.keyMembership = ME;
    await oneRound();
    expect(entryNow().api?.membership).toBe(ME);
    expect(shown.filter(s => /You are now/.test(s))).toEqual([]);
  });

  it('a /me that does not serve it leaves it absent', async () => {
    client.keyRole = 'contributor';
    await oneRound();
    expect(entryNow().api?.member_role).toBe('contributor');
    expect(entryNow().api && 'membership' in entryNow().api!).toBe(false);
  });

  it('a new key forgets it with the role', async () => {
    patchSlice('active', null);
    patchSlice('registry', { ...getState().registry, worlds: [base({ member_role: 'contributor', membership: ME })] });
    await putKeyInPlace(entryNow(), 'ow_w_' + 'b'.repeat(32), false);
    expect(entryNow().api?.member_role).toBeUndefined();
    expect(entryNow().api && 'membership' in entryNow().api!).toBe(false);
  });
});
