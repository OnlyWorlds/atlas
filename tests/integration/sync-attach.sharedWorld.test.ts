/**
 * A shared world reviews before it overwrites (Titus's choice (a),
 * 2026-10-20).
 *
 * In a world keel's roster says others can write to, the engine runs
 * pause-and-review and pulls when the world opens, whatever Settings names;
 * a world alone keeps the default. The roster is heard BEFORE the
 * flush-on-attach, the round most likely to meet a collaborator's newer
 * words. The person's own switch turns the rule off per world.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { OwMember } from '@onlyworlds/sdk';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let client: FakeOwApiClient;
vi.mock('../../src/sync/ow-v2-client-adapter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/ow-v2-client-adapter')>()),
  OwV2ClientAdapter: vi.fn(() => client),
}));
const roster = vi.fn(async (..._args: unknown[]): Promise<OwMember[] | null> => null);
vi.mock('../../src/sync/world-roster', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/world-roster')>()),
  rosterFor: (...args: unknown[]) => roster(...args),
}));

import {
  attachSyncEngine,
  detachSyncEngine,
  getCurrentSyncEngine,
  reapplySyncPolicy,
  __test_emitConflictToasts,
} from '../../src/sync/sync-attach';
import { SyncEngine } from '../../src/sync/sync-engine';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { attachApi, detachApi, setPin } from '../../src/registry/registry';
import { __resetLiveFolderForTests } from '../../src/core/live-folder';
import { rosterIsShared, sharedWorldLine, worldSyncPolicy } from '../../src/sync/shared-world';

const OWNER: OwMember = { id: null, kind: 'owner', role: 'owner', character: null, status: 'active' };
const CO_BUILDER: OwMember = { id: 'm1', kind: 'person', role: 'co_builder', character: null, status: 'active' };
const PLAYER: OwMember = { id: 'm2', kind: 'player', role: 'player' as never, character: 'c9', status: 'active' };
const GONE: OwMember = { id: 'm3', kind: 'person', role: 'contributor', character: null, status: 'removed' };
const AGENT: OwMember = { id: 'm4', kind: 'agent', role: 'contributor', character: null, status: 'active', name: 'Kael' };

const base: WorldRegistryEntry = {
  id: 'w1', name: 'Shared World', state: 'api-linked',
  api: { world_id: 'srv-1', api_key: 'k1' },
  folder: { handle_key: 'vault-1', folder_name: 'shared-world' },
  created_at: '2026-01-01T00:00:00Z',
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const noop = { pushed: { creates: 0, updates: 0, deletes: 0 }, pulled: { creates: 0, updates: 0, deletes: 0 }, conflicts: [], failures: [] };
const entryNow = () => getState().registry.worlds.find(w => w.id === 'w1')!;

function useRegistry(entry: WorldRegistryEntry, over: Partial<WorldsRegistry> = {}): void {
  patchSlice('registry', setPin({ ...defaultRegistry(), ...over, worlds: [entry] }, '1234'));
}

let folder: MockFolderStore;
let clock: MonotonicClock;

beforeEach(async () => {
  detachSyncEngine();
  __resetLiveFolderForTests();
  roster.mockReset();
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'Shared World' }, opened: true } as never);
});
afterEach(() => { detachSyncEngine(); vi.restoreAllMocks(); patchSlice('active', null); });

/** An element both sides changed since the last sync: Ana's description, here and online. */
async function seedBothChanged(): Promise<void> {
  await client.createElement('character', { id: 'c1', name: 'Ana', description: 'orig', type: 'character' });
  await new SyncEngine({ folder, client }).syncNow();
  await client.updateElement('character', 'c1', { name: 'Ana', type: 'character', description: 'the co-builder wrote this' });
  await folder.updateElement('c1', { description: 'the owner wrote this' });
}

describe('who shares a world (keel roster)', () => {
  it('an active person or agent beside the owner is shared; the owner, a player and a removed member are not', () => {
    expect(rosterIsShared([OWNER])).toBe(false);
    expect(rosterIsShared([OWNER, PLAYER])).toBe(false);
    expect(rosterIsShared([OWNER, GONE])).toBe(false);
    expect(rosterIsShared([OWNER, CO_BUILDER])).toBe(true);
    expect(rosterIsShared([OWNER, AGENT])).toBe(true);
  });
});

describe('the flush-on-attach in a shared world', () => {
  it('holds an edit the server also changed: the co-builder\'s words stay online, the owner\'s stay here, one conflict to review', async () => {
    await seedBothChanged();
    useRegistry(base); // the default: Local wins
    roster.mockResolvedValue([OWNER, CO_BUILDER]);
    const update = vi.spyOn(client, 'updateElement');
    attachSyncEngine(base, folder);
    await vi.waitFor(async () => expect((await folder.readSyncState()).conflicts).toHaveLength(1));
    expect(update).not.toHaveBeenCalled();
    expect((await client.getElement('character', 'c1'))!.description).toBe('the co-builder wrote this');
    expect((await folder.getElement('c1'))!.description).toBe('the owner wrote this');
    expect(entryNow().shared_with_others).toBe(true);
    expect(getCurrentSyncEngine()!.getPolicy()).toBe('pause-and-review');
  });

  it('control: the same world alone pushes as today (Local wins)', async () => {
    await seedBothChanged();
    useRegistry(base);
    roster.mockResolvedValue([OWNER, PLAYER]);
    attachSyncEngine(base, folder);
    await vi.waitFor(async () => expect((await client.getElement('character', 'c1'))!.description).toBe('the owner wrote this'));
    expect(entryNow().shared_with_others).toBe(false);
    expect(getCurrentSyncEngine()!.getPolicy()).toBe('local-wins');
  });

  it('the roster is heard before the flush: a late answer holds the push, and the push runs under its answer', async () => {
    useRegistry(base);
    let answer!: (rows: OwMember[]) => void;
    roster.mockReturnValue(new Promise<OwMember[]>(r => { answer = r; }));
    await folder.createElement('character', { name: 'waiting' });
    const policyAtPush: string[] = [];
    const push = vi.spyOn(SyncEngine.prototype, 'pushOnce').mockImplementation(function (this: SyncEngine) {
      policyAtPush.push(this.getPolicy());
      return Promise.resolve(noop as never);
    });
    attachSyncEngine(base, folder);
    // While the roster is unheard, nothing would overwrite.
    expect(getCurrentSyncEngine()!.getPolicy()).toBe('pause-and-review');
    await settle();
    expect(push).not.toHaveBeenCalled();
    answer([OWNER, CO_BUILDER]);
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(policyAtPush).toEqual(['pause-and-review']);
  });

  it('a shared world pulls when it opens, after the flush; a world alone does not (pull on activate is off)', async () => {
    useRegistry(base);
    roster.mockResolvedValue([OWNER, CO_BUILDER]);
    await folder.createElement('character', { name: 'waiting' });
    const order: string[] = [];
    vi.spyOn(SyncEngine.prototype, 'pushOnce').mockImplementation(() => { order.push('push'); return Promise.resolve(noop as never); });
    vi.spyOn(SyncEngine.prototype, 'pullNow').mockImplementation(() => { order.push('pull'); return Promise.resolve(noop as never); });
    attachSyncEngine(base, folder);
    await vi.waitFor(() => expect(order).toEqual(['push', 'pull']));

    detachSyncEngine();
    order.length = 0;
    roster.mockResolvedValue([OWNER]);
    useRegistry({ ...base, shared_with_others: undefined });
    attachSyncEngine(base, folder);
    await vi.waitFor(() => expect(order).toEqual(['push']));
    await settle();
    expect(order).toEqual(['push']);
  });

  it('no answer from keel: the world stays under the review, whatever was learned before, and asks again on the next round', async () => {
    roster.mockResolvedValue(null);
    for (const learned of [true, false, undefined]) {
      detachSyncEngine();
      useRegistry({ ...base, shared_with_others: learned });
      attachSyncEngine(entryNow(), folder);
      await settle();
      expect(getCurrentSyncEngine()!.getPolicy(), `learned ${learned}`).toBe('pause-and-review');
    }
    // keel answers on a later round: alone, so the default.
    roster.mockResolvedValue([OWNER]);
    const engine = getCurrentSyncEngine()!;
    (engine as unknown as { onSyncResult: (p: string, r: unknown) => void }).onSyncResult('push', noop);
    await vi.waitFor(() => expect(engine.getPolicy()).toBe('local-wins'));
  });

  it('a world opened paused asks nothing, and its resume pushes under the review: the co-builder\'s words stay', async () => {
    await seedBothChanged();
    useRegistry({ ...base, sync_paused: true, shared_with_others: false });
    roster.mockResolvedValue([OWNER, CO_BUILDER]);
    attachSyncEngine(entryNow(), folder);
    await settle();
    expect(roster).not.toHaveBeenCalled();
    const engine = getCurrentSyncEngine()!;
    expect(engine.getPolicy()).toBe('pause-and-review');
    const update = vi.spyOn(client, 'updateElement');
    engine.resume();
    await vi.waitFor(async () => expect((await folder.readSyncState()).conflicts).toHaveLength(1));
    expect(update).not.toHaveBeenCalled();
    expect((await client.getElement('character', 'c1'))!.description).toBe('the co-builder wrote this');
    await vi.waitFor(() => expect(entryNow().shared_with_others).toBe(true));
  });

  it('an element held while keel was unheard stays held when keel says the world is alone, until the person chooses', async () => {
    useRegistry(base);
    let answer!: (rows: OwMember[]) => void;
    roster.mockReturnValue(new Promise<OwMember[]>(r => { answer = r; }));
    attachSyncEngine(base, folder);
    const engine = getCurrentSyncEngine()!;
    const conflict = { element_id: 'c1', type: 'character', detected_at: 'x', local_updated_at: 'a', server_updated_at: 'b', fields: [] };
    await folder.writeSyncState({ conflicts: [conflict] } as never);
    answer([OWNER]);
    await settle();
    expect(engine.getPolicy()).toBe('pause-and-review');
    expect((await folder.readSyncState()).conflicts).toHaveLength(1);
    // Chosen, and a round after: the default.
    await folder.writeSyncState({ conflicts: [] } as never);
    roster.mockResolvedValue([OWNER]);
    (engine as unknown as { onSyncResult: (p: string, r: unknown) => void }).onSyncResult('push', noop);
    await vi.waitFor(() => expect(engine.getPolicy()).toBe('local-wins'));
  });

  it('the person turned the rule off for this world: it follows the default', async () => {
    roster.mockResolvedValue([OWNER, CO_BUILDER]);
    useRegistry({ ...base, shared_keep_policy: true });
    const pull = vi.spyOn(SyncEngine.prototype, 'pullNow').mockResolvedValue(noop as never);
    attachSyncEngine(entryNow(), folder);
    await settle();
    expect(entryNow().shared_with_others).toBe(true);
    expect(getCurrentSyncEngine()!.getPolicy()).toBe('local-wins');
    expect(pull).not.toHaveBeenCalled();
  });

  it('someone joins while the world is open: the next round runs under pause-and-review', async () => {
    roster.mockResolvedValue([OWNER]);
    useRegistry(base);
    attachSyncEngine(base, folder);
    await settle();
    const engine = getCurrentSyncEngine()!;
    const onSyncResult = (engine as unknown as { onSyncResult: (p: string, r: unknown) => void }).onSyncResult;
    expect(engine.getPolicy()).toBe('local-wins');
    roster.mockResolvedValue([OWNER, CO_BUILDER]);
    onSyncResult('push', noop);
    await vi.waitFor(() => expect(engine.getPolicy()).toBe('pause-and-review'));
    expect(entryNow().shared_with_others).toBe(true);
  });
});

describe('nothing else turns a shared world back to Local wins', () => {
  it('Settings, Storage set to Local wins leaves a shared world reviewing: no conflicts cleared, nothing pushed', async () => {
    roster.mockResolvedValue([OWNER, CO_BUILDER]);
    useRegistry(base, { sync_default_policy: 'pause-and-review' });
    attachSyncEngine(base, folder);
    await settle();
    const engine = getCurrentSyncEngine()!;
    const conflict = { element_id: 'c1', type: 'character', detected_at: 'x', local_updated_at: 'a', server_updated_at: 'b', fields: [] };
    await folder.writeSyncState({ conflicts: [conflict] } as never);
    const push = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noop as never);
    patchSlice('registry', { ...getState().registry, sync_default_policy: 'local-wins' });
    reapplySyncPolicy();
    await settle();
    expect(engine.getPolicy()).toBe('pause-and-review');
    expect((await folder.readSyncState()).conflicts).toHaveLength(1);
    expect(push).not.toHaveBeenCalled();
  });

  it('control: a world alone leaving Pause and review clears its conflicts and pushes them (SYNC_NOTES M4)', async () => {
    roster.mockResolvedValue([OWNER]);
    useRegistry(base, { sync_default_policy: 'pause-and-review' });
    attachSyncEngine(base, folder);
    await settle();
    const engine = getCurrentSyncEngine()!;
    expect(engine.getPolicy()).toBe('pause-and-review');
    const conflict = { element_id: 'c1', type: 'character', detected_at: 'x', local_updated_at: 'a', server_updated_at: 'b', fields: [] };
    await folder.writeSyncState({ conflicts: [conflict] } as never);
    const push = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noop as never);
    patchSlice('registry', { ...getState().registry, sync_default_policy: 'local-wins' });
    reapplySyncPolicy();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(engine.getPolicy()).toBe('local-wins');
    expect((await folder.readSyncState()).conflicts).toHaveLength(0);
  });

  it('a pull conflict in a shared world is left to the review, never pushed over (the default is Local wins)', async () => {
    roster.mockResolvedValue([OWNER, CO_BUILDER]);
    useRegistry(base);
    attachSyncEngine(base, folder);
    await settle();
    const engine = getCurrentSyncEngine()!;
    const push = vi.spyOn(engine, 'pushOnce').mockResolvedValue(noop as never);
    const conflict = { element_id: 'c1', type: 'character', detected_at: 'x', local_updated_at: 'a', server_updated_at: 'b', fields: [] };
    __test_emitConflictToasts('pull', { ...noop, conflicts: [conflict] } as never);
    await new Promise(r => setTimeout(r, 5));
    expect(push).not.toHaveBeenCalled();
  });
});

describe('what a roster said belongs to its link', () => {
  it('unlinking or linking again forgets it, and the person\'s switch with it', () => {
    const reg = { ...defaultRegistry(), worlds: [{ ...base, shared_with_others: true, shared_keep_policy: true }] };
    const unlinked = detachApi(reg, 'w1').worlds[0];
    expect(unlinked.shared_with_others).toBeUndefined();
    expect(unlinked.shared_keep_policy).toBeUndefined();
    const relinked = attachApi(reg, 'w1', { worldId: 'srv-2', apiKey: 'k2' }).worlds[0];
    expect(relinked.shared_with_others).toBeUndefined();
    expect(relinked.shared_keep_policy).toBeUndefined();
  });
});

describe('Settings says it', () => {
  it('a shared world names its rule; turned off under Local wins, it says a collaborator\'s words are overwritten; a world alone shows nothing', () => {
    const reg = defaultRegistry();
    expect(sharedWorldLine({ ...base, shared_with_others: true }, reg)).toMatch(/holds it for you to choose/);
    expect(sharedWorldLine({ ...base, shared_with_others: true, shared_keep_policy: true }, reg)).toMatch(/a collaborator's words included/);
    expect(sharedWorldLine({ ...base, shared_with_others: false }, reg)).toBeNull();
    expect(sharedWorldLine(base, reg)).toBeNull();
    expect(worldSyncPolicy({ ...base, shared_with_others: true }, { ...reg, sync_default_policy: 'local-wins' })).toBe('pause-and-review');
  });
});
