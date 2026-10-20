/**
 * B12 Q2 at the attach (conv. 151, I4, I5): the key's role is recorded on the
 * registry entry, a change from a known role is said once, first sight says
 * nothing, and an edit that stays here is said once per element.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let client: FakeOwApiClient;
vi.mock('../../src/sync/ow-v2-client-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/ow-v2-client-adapter')>()),
  OwV2ClientAdapter: vi.fn(() => client),
}));

import { attachSyncEngine, detachSyncEngine, keptCountFor } from '../../src/sync/sync-attach';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setPin } from '../../src/registry/registry';
import { __resetLiveFolderForTests } from '../../src/core/live-folder';
import { toastManager } from '../../src/ui/toast-manager';

const A = '00000000-0000-4000-8000-0000000a0001';
const B = '00000000-0000-4000-8000-0000000a0002';

const base: WorldRegistryEntry = {
  id: 'w1', name: 'The Ferry', state: 'api-linked',
  api: { world_id: 'srv-1', api_key: 'k1' },
  folder: { handle_key: 'vault-1', folder_name: 'ferry' },
  created_at: '2026-01-01T00:00:00Z',
  // A world alone: the roster's answer stays out of this file's way.
  shared_with_others: false,
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const entryNow = () => getState().registry.worlds.find(w => w.id === 'w1')!;

let folder: MockFolderStore;
let shown: string[];

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
  shown = [];
  vi.spyOn(toastManager, 'show').mockImplementation((m: string) => { shown.push(m); });
  patchSlice('registry', setPin({ ...defaultRegistry(), worlds: [base] }, '1234'));
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'The Ferry' }, opened: true } as never);
});
afterEach(() => { detachSyncEngine(); vi.restoreAllMocks(); patchSlice('active', null); });

/** keel lowers the key: the old cursor 409s, the walk names only `seen`. */
function lowered(seen: Set<string>): void {
  const real = client.pullChanges!.bind(client);
  let refused = false;
  client.pullChanges = async (since, limit) => {
    if (since && !refused) { refused = true; throw Object.assign(new Error('API Error 409'), { status: 409, code: 'resync_required', param: null }); }
    const page = await real(since, limit);
    return { ...page, changes: page.changes.filter(op => seen.has(op.id)) };
  };
}

describe('the role, said once (I4)', () => {
  it('first sight is recorded silently; a lowering is said once; the same role again says nothing', async () => {
    await client.createElement('character', { id: A, name: 'Cy' });
    await client.createElement('character', { id: B, name: 'Ana' });
    client.keyRole = 'co_builder';
    const engine = attachSyncEngine(entryNow(), folder)!;
    await settle();
    await engine.pullNow();
    await settle();
    expect(entryNow().api?.member_role).toBe('co_builder');
    expect(shown.filter(s => /You are now/.test(s))).toEqual([]);

    client.keyRole = 'guest';
    lowered(new Set([A]));
    await engine.pullNow();
    await settle();
    expect(entryNow().api?.member_role).toBe('guest');
    const said = shown.filter(s => /You are now a guest in The Ferry/.test(s));
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/Your copy keeps everything you had/);
    expect((await folder.listElements()).map(e => e.id).sort()).toEqual([A, B]);
    expect(keptCountFor('w1')).toBe(1);

    lowered(new Set([A]));
    await engine.pullNow();
    await settle();
    expect(shown.filter(s => /You are now/.test(s))).toHaveLength(1);
  });

  it('an edit that stays here is said once per element, not per round', async () => {
    await client.createElement('character', { id: A, name: 'Cy' });
    await client.createElement('character', { id: B, name: 'Ana' });
    client.keyRole = 'guest';
    const engine = attachSyncEngine(entryNow(), folder)!;
    await settle();
    await engine.pullNow();
    await settle();
    client.outOfView.add(B);
    await folder.updateElement(B, { description: 'mine' });
    await engine.pushOnce();
    await settle();
    await engine.pushOnce();
    await settle();
    const said = shown.filter(s => /stays here: OnlyWorlds no longer shows it to you in The Ferry/.test(s));
    expect(said).toHaveLength(1);
    expect(shown.filter(s => /deleted/i.test(s))).toEqual([]);
  });

  it('a lowering a push finds first moves the role and the kept count at once, and the next pull says it no more (S440)', async () => {
    // Ids of its own: what was said lives for the session, across this file's tests.
    const E = '00000000-0000-4000-8000-0000000a0005';
    await client.createElement('character', { id: A, name: 'Cy' });
    await client.createElement('character', { id: E, name: 'Ana' });
    client.keyRole = 'co_builder';
    const engine = attachSyncEngine(entryNow(), folder)!;
    await settle();
    await engine.pullNow();
    await settle();
    expect(entryNow().api?.member_role).toBe('co_builder');

    // Lowered while open; the member's edit reaches keel before any pull does.
    client.keyRole = 'guest';
    client.outOfView.add(E);
    await folder.updateElement(E, { description: 'mine' });
    await engine.pushOnce();
    await settle();
    expect(entryNow().api?.member_role).toBe('guest');
    expect(keptCountFor('w1')).toBe(1);
    expect(shown.filter(s => /You are now a guest in The Ferry/.test(s))).toHaveLength(1);
    // The role line says the edit stays here; its own line would say it twice.
    expect(shown.filter(s => /stays here: OnlyWorlds no longer shows it/.test(s))).toEqual([]);
    await engine.pushOnce();
    await settle();
    expect(shown.filter(s => /stays here: OnlyWorlds no longer shows it/.test(s))).toEqual([]);

    // The resync keeps nothing new here (E was kept by the push): the role line was the news.
    lowered(new Set([A]));
    await engine.pullNow();
    await settle();
    expect(shown.filter(s => /You are now/.test(s))).toHaveLength(1);

    // That resync used the promise up: a later hide is news of its own.
    lowered(new Set());
    await engine.pullNow();
    await settle();
    expect(keptCountFor('w1')).toBe(2);
    expect(shown.filter(s => /1 element of The Ferry is no longer shown to you online/.test(s))).toHaveLength(1);
  });

  it('the resync after a push said the role keeps its count quiet once; later kept news is said (S440)', async () => {
    const C = '00000000-0000-4000-8000-0000000a0003';
    const D = '00000000-0000-4000-8000-0000000a0004';
    for (const [id, name] of [[A, 'Cy'], [B, 'Ana'], [C, 'Bo'], [D, 'The Ferry']]) await client.createElement('character', { id, name });
    client.keyRole = 'co_builder';
    const engine = attachSyncEngine(entryNow(), folder)!;
    await settle();
    await engine.pullNow();
    await settle();

    client.keyRole = 'guest';
    client.outOfView.add(B);
    await folder.updateElement(B, { description: 'mine' });
    await engine.pushOnce();
    await settle();
    const noLongerShown = () => shown.filter(s => /no longer shown to you online/.test(s));

    lowered(new Set([A, D]));        // C left with the lowering: the role line promised it
    await engine.pullNow();
    await settle();
    expect(keptCountFor('w1')).toBe(2);
    expect(noLongerShown()).toEqual([]);

    lowered(new Set([A]));           // later, D leaves the view: news of its own
    await engine.pullNow();
    await settle();
    expect(keptCountFor('w1')).toBe(3);
    expect(noLongerShown()).toHaveLength(1);
    expect(shown.filter(s => /You are now/.test(s))).toHaveLength(1);
  });
});
