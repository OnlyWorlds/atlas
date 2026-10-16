/**
 * #198's gate (S418) ran these three and saw each go wrong; they stand as
 * guards now:
 * - G1: world A's refused round, landing after the switch to B, made a key
 *   for B and swapped B's working key. A stopped engine's refusal is now
 *   dropped, and the world is the engine's, never "whatever is open now".
 * - G2: a switch to B during A's world.json write attached A's engine over B.
 * - G3: a world linked with another account's key read as "deleted there, or
 *   you were removed" on a revoked key.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const A_KEY = 'ow_w_' + 'a'.repeat(32);
const B_KEY = 'ow_w_' + 'b'.repeat(32);

const h = vi.hoisted(() => ({
  gate: null as null | Promise<void>,
  release: () => {},
  rows: [] as Array<Record<string, unknown>>,
  mintCalls: [] as string[],
  store: null as unknown,
  aCalls: 0,
}));

vi.mock('../../src/sync/ow-v2-client-adapter', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/sync/ow-v2-client-adapter')>();
  const { FakeOwApiClient } = await import('../fixtures/fake-ow-client');
  class Gated extends FakeOwApiClient {
    private isA: boolean;
    constructor(opts: { apiKey: string }) {
      super();
      this.isA = opts.apiKey === 'ow_w_' + 'a'.repeat(32);
      if (this.isA) this.__inject_auth_failure(true, 'key_revoked');
    }
    private async wait(): Promise<void> { if (this.isA) { h.aCalls++; await h.gate; } }
    async getWorldMeta() { await this.wait(); return super.getWorldMeta(); }
    async createElement(t: never, b: never) { await this.wait(); return super.createElement(t, b); }
    async updateElement(t: never, i: never, b: never) { await this.wait(); return super.updateElement(t, i, b); }
    async listElements(t: never) { await this.wait(); return super.listElements(t); }
  }
  return { ...m, OwV2ClientAdapter: Gated };
});
vi.mock('../../src/sync/account-client', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/sync/account-client')>();
  class FakeAccount {
    async listWorlds() { return h.rows; }
    async mintWorldKey(worldId: string) {
      h.mintCalls.push(worldId);
      return { id: 'k-' + worldId, last4: 'mmmm', scope: 'WRITE', key: 'ow_w_' + 'm'.repeat(32) };
    }
    async revokeWorldKey() {}
  }
  return { ...m, AccountClient: FakeAccount };
});
vi.mock('../../src/core/active-store', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/core/active-store')>();
  return { ...m, getActiveStore: () => h.store };
});
vi.mock('../../src/ui/pin-prompt-modal', () => ({
  PinPromptModal: class { async prompt() { return '4242'; } },
}));

import { attachSyncEngine, detachSyncEngine, getCurrentSyncWorldId } from '../../src/sync/sync-attach';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { putKeyInPlace, recoverRefusedKey, resetKeyRecoveryForTests } from '../../src/sync/world-key';

function entry(id: string, worldId: string, key: string): WorldRegistryEntry {
  return {
    id, name: id, state: 'api-linked',
    api: { world_id: worldId, api_key: key },
    folder: { handle_key: 'vault-' + id, folder_name: id },
    created_at: '2026-01-01T00:00:00Z',
  };
}

const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setTimeout(r, 5)); };

beforeEach(() => {
  detachSyncEngine();
  resetKeyRecoveryForTests();
  h.mintCalls.length = 0;
  h.aCalls = 0;
  h.gate = new Promise<void>(r => { h.release = r; });
});

describe('G1: a stale refusal never crosses worlds', () => {
  it('A\'s refused round, landing after the switch to B, leaves B\'s working key alone', async () => {
    const storeA = new MockFolderStore();
    await storeA.open(null);
    await storeA.createElement('character', { name: 'pending in A' });
    const storeB = new MockFolderStore();
    await storeB.open(null);
    h.rows = [
      { id: 'srv-B', name: 'B', role: 'owner', public_read: false, keys: [] },
      { id: 'srv-A', name: 'A', role: 'owner', public_read: false, keys: [] },
    ];
    const a = entry('local-A', 'srv-A', A_KEY);
    const b = entry('local-B', 'srv-B', B_KEY);
    patchSlice('registry', { ...defaultRegistry(), pin: '1234', account_token: 'ow_a_tok', worlds: [a, b] });

    patchSlice('active', { worldId: a.id, meta: { id: 'srv-A', name: 'A' }, opened: true });
    h.store = storeA;
    attachSyncEngine(a, storeA as never);
    await flush();
    expect(h.aCalls).toBeGreaterThan(0); // A's flush round waits on the network

    patchSlice('active', { worldId: b.id, meta: { id: 'srv-B', name: 'B' }, opened: true });
    h.store = storeB;
    attachSyncEngine(b, storeB as never);

    h.release(); // A's round comes back 401 key_revoked
    await flush();

    expect(h.mintCalls).toEqual([]);
    expect(getState().registry.worlds.find(w => w.id === 'local-B')!.api!.api_key).toBe(B_KEY);
    expect(getState().registry.worlds.find(w => w.id === 'local-A')!.api!.api_key).toBe(A_KEY);
    expect(getCurrentSyncWorldId()).toBe('local-B');
  });
});

describe('G2: a swap attaches only to the world still open', () => {
  it('a switch to B during A\'s world.json write keeps B\'s engine', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    class SlowMeta extends MockFolderStore {
      override async writeWorldMeta(p: never, o?: never) { await gate; return super.writeWorldMeta(p, o); }
    }
    const storeA = new SlowMeta();
    await storeA.open(null);
    const storeB = new MockFolderStore();
    await storeB.open(null);
    const a = entry('local-A', 'srv-A', A_KEY);
    const b = entry('local-B', 'srv-B', B_KEY);
    patchSlice('registry', { ...defaultRegistry(), pin: '1234', sync_pause_all: true, worlds: [a, b] });
    patchSlice('active', { worldId: a.id, meta: { id: 'srv-A', name: 'A' }, opened: true });
    h.store = storeA;

    const swap = putKeyInPlace(a, 'ow_w_' + 'n'.repeat(32), false);
    patchSlice('active', { worldId: b.id, meta: { id: 'srv-B', name: 'B' }, opened: true });
    h.store = storeB;
    attachSyncEngine(b, storeB as never);
    release();
    await swap;

    expect(getState().active?.worldId).toBe('local-B');
    expect(getCurrentSyncWorldId()).toBe('local-B');
    // A still has its new key for the next time it opens.
    expect(getState().registry.worlds.find(w => w.id === 'local-A')!.api!.api_key).toBe('ow_w_' + 'n'.repeat(32));
  });
});

describe('G3: "gone" only when keel no longer knows the key', () => {
  it('a revoked key on a world this account does not hold says the revoke, not a deletion', async () => {
    const a = entry('local-A', 'srv-A', A_KEY);
    h.rows = [{ id: 'srv-other', name: 'Other', role: 'owner', public_read: false, keys: [] }];
    patchSlice('registry', { ...defaultRegistry(), pin: '1234', sync_pause_all: true, account_token: 'ow_a_tok', worlds: [a] });
    expect(await recoverRefusedKey(a, 'key_revoked')).toBeNull(); // the caller says keyRefusalLine('key_revoked')
    expect(h.mintCalls).toEqual([]);
  });

  it('an unknown key on a world gone from the account says so', async () => {
    const a = entry('local-A', 'srv-A', A_KEY);
    h.rows = [];
    patchSlice('registry', { ...defaultRegistry(), pin: '1234', sync_pause_all: true, account_token: 'ow_a_tok', worlds: [a] });
    const said = await recoverRefusedKey(a, 'key_unknown');
    expect(said?.ok).toBe(false);
    expect(said?.line).toMatch(/deleted there, or you were removed from it/);
  });
});
