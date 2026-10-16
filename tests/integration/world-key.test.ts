/**
 * #198: a linked world takes a new key in place, never Unlink. Unlink drops
 * the deletes not yet sent and the sync history (conv. 24); a key swap keeps
 * the world exactly as it is and attaches a fresh engine on the new key.
 * Signed in, Atlas makes the key itself when keel refuses the old one, once
 * per world and session.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  attachedKeys: [] as string[],
  getWorld: null as null | ((key: string) => Promise<{ id: string; name: string }>),
  rows: [] as Array<Record<string, unknown>>,
  mintCalls: [] as Array<{ worldId: string; scope: string }>,
  mintAnswer: null as null | ((scope: string) => Promise<{ id: string; last4: string; scope: 'READ' | 'WRITE'; key: string }>),
  revoked: [] as string[],
  store: null as unknown,
  pinAnswer: '4242' as string | null,
}));

vi.mock('../../src/sync/ow-v2-client-adapter', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/sync/ow-v2-client-adapter')>();
  class Recording extends m.OwV2ClientAdapter {
    constructor(opts: ConstructorParameters<typeof m.OwV2ClientAdapter>[0]) {
      super(opts);
      h.attachedKeys.push(opts.apiKey);
    }
  }
  return { ...m, OwV2ClientAdapter: Recording };
});
vi.mock('../../src/sync/make-online', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/sync/make-online')>();
  return { ...m, buildV2Adapter: (key: string) => ({ getWorld: () => h.getWorld!(key) }) };
});
vi.mock('../../src/sync/account-client', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/sync/account-client')>();
  class FakeAccount {
    async listWorlds() { return h.rows; }
    async mintWorldKey(worldId: string, _name?: string, scope = 'write') {
      h.mintCalls.push({ worldId, scope });
      return h.mintAnswer!(scope);
    }
    async revokeWorldKey(_worldId: string, keyId: string) { h.revoked.push(keyId); }
  }
  return { ...m, AccountClient: FakeAccount };
});
vi.mock('../../src/core/active-store', async (importOriginal) => {
  const m = await importOriginal<typeof import('../../src/core/active-store')>();
  return { ...m, getActiveStore: () => h.store };
});
vi.mock('../../src/ui/pin-prompt-modal', () => ({
  PinPromptModal: class { async prompt() { return h.pinAnswer; } },
}));

import { detachSyncEngine } from '../../src/sync/sync-attach';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { OwV2Error } from '../../src/sync/ow-v2-client-adapter';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import {
  checkNewKey, putKeyInPlace, makeNewWorldKey, recoverRefusedKey, keyRefusalFor, resetKeyRecoveryForTests,
} from '../../src/sync/world-key';

const WORLD = 'w-server-1';
const OLD = 'ow_w_' + 'a'.repeat(32);
const NEW = 'ow_w_' + 'b'.repeat(32);
const READ = 'ow_r_' + 'c'.repeat(32);

function entry(api: Partial<NonNullable<WorldRegistryEntry['api']>> = {}): WorldRegistryEntry {
  return {
    id: 'local-1', name: 'Kessel', state: 'api-linked',
    api: { world_id: WORLD, api_key: OLD, ...api },
    folder: { handle_key: 'vault-local-1', folder_name: 'kessel' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

function refused(code: string, status = 401, param: string | null = null): OwV2Error {
  return new OwV2Error(status, { code, message: code, param }, '');
}

let store: MockFolderStore;

beforeEach(async () => {
  detachSyncEngine();
  resetKeyRecoveryForTests();
  h.attachedKeys.length = 0;
  h.mintCalls.length = 0;
  h.revoked.length = 0;
  h.rows = [];
  h.pinAnswer = '4242';
  h.getWorld = async () => ({ id: WORLD, name: 'Kessel' });
  h.mintAnswer = async (scope) => scope === 'read'
    ? { id: 'k-read', last4: 'cccc', scope: 'READ', key: READ }
    : { id: 'k-write', last4: 'bbbb', scope: 'WRITE', key: NEW };
  store = new MockFolderStore();
  await store.open(null);
  await store.writeWorldMeta({ api: { world_id: WORLD, api_key: OLD } });
  h.store = store;
  const e = entry();
  patchSlice('registry', { ...defaultRegistry(), pin: '1234', sync_pause_all: true, worlds: [e] });
  patchSlice('active', { worldId: e.id, meta: { id: WORLD, name: 'Kessel' }, opened: true });
});

const current = (): WorldRegistryEntry => getState().registry.worlds.find(w => w.id === 'local-1')!;

describe('a new key in place', () => {
  it('keeps the deletes not yet sent and the edits waiting, which Unlink drops', async () => {
    const a = await store.createElement('character', { name: 'Alice' });
    await store.stampServerUpdatedAt(a.id, 'character', '2026-01-02T00:00:00Z');
    const b = await store.createElement('character', { name: 'Bob' });
    await store.stampServerUpdatedAt(b.id, 'character', '2026-01-02T00:00:00Z');
    await store.deleteElement(b.id);
    await store.updateElement(a.id, { description: 'edited offline' });
    const before = await store.listTombstonesSince(null);
    expect(before.map(t => t.id)).toEqual([b.id]);

    await putKeyInPlace(current(), NEW, false);

    expect(current().api!.api_key).toBe(NEW);
    expect((await store.readWorldMeta()).api?.api_key).toBe(NEW);
    expect((await store.listTombstonesSince(null)).map(t => t.id)).toEqual([b.id]);
    const alice = await store.getElement(a.id);
    expect(alice?.server_updated_at).toBe('2026-01-02T00:00:00Z');
    expect(alice?.description).toBe('edited offline');
    expect(h.attachedKeys).toEqual([NEW]);
  });

  it('a write key opens a read-only world to edit, and a read key closes it', async () => {
    patchSlice('registry', { ...getState().registry, worlds: [entry({ read_only: true })] });
    store.setViewOnly(true);
    await putKeyInPlace(current(), NEW, false);
    expect(current().api!.read_only).toBeUndefined();
    expect((await store.readWorldMeta()).api?.read_only).toBeUndefined();
    await expect(store.createElement('character', { name: 'Now editable' })).resolves.toBeTruthy();

    await putKeyInPlace(current(), READ, true);
    expect(current().api!.read_only).toBe(true);
    expect((await store.readWorldMeta()).api?.read_only).toBe(true);
    await expect(store.createElement('character', { name: 'No' })).rejects.toThrow(/view-only/);
  });

  it('refuses a seat world: its key comes back through its join link', async () => {
    patchSlice('registry', { ...getState().registry, worlds: [entry({ seat: { role: 'contributor' } })] });
    await expect(putKeyInPlace(current(), NEW, false)).rejects.toThrow(/cannot take a new key/);
    await expect(checkNewKey(current(), NEW)).rejects.toThrow(/cannot take a new key/);
  });
});

describe('a pasted key', () => {
  it('must name this world', async () => {
    h.getWorld = async () => ({ id: 'someone-else', name: 'Elsewhere' });
    await expect(checkNewKey(current(), NEW)).rejects.toThrow('That key is for another world, "Elsewhere"');
  });

  it('says what keel said of it', async () => {
    h.getWorld = async () => { throw refused('key_revoked'); };
    await expect(checkNewKey(current(), NEW)).rejects.toThrow(/revoked too/);
    h.getWorld = async () => { throw refused('invalid_credentials'); };
    await expect(checkNewKey(current(), NEW)).rejects.toThrow(/does not know that key/);
    await expect(checkNewKey(current(), '  ')).rejects.toThrow(/Paste the key/);
    await expect(checkNewKey(current(), OLD)).rejects.toThrow(/has now/);
  });

  it('reads an ow_r_ key as read only', async () => {
    await expect(checkNewKey(current(), READ)).resolves.toEqual({ readOnly: true });
    await expect(checkNewKey(current(), NEW)).resolves.toEqual({ readOnly: false });
  });
});

describe('a key Atlas makes, signed in', () => {
  beforeEach(() => {
    patchSlice('registry', { ...getState().registry, account_token: 'ow_a_token' });
  });

  it('a world no longer on the account is named so, and nothing is made', async () => {
    h.rows = [];
    const out = await makeNewWorldKey(current(), { keyDead: true, cause: 'key_unknown' });
    expect(out.kind).toBe('gone');
    // Without keel saying it forgot the key, the world is only not this account's.
    expect((await makeNewWorldKey(current(), { keyDead: true, cause: 'key_revoked' })).kind).toBe('not-on-account');
    expect((await makeNewWorldKey(current(), { keyDead: false })).kind).toBe('not-on-account');
    expect(h.mintCalls).toEqual([]);
    expect(current().api!.api_key).toBe(OLD);
  });

  it('a refused key is replaced in place, once per world and session', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'collaborator', member_role: 'co_builder', public_read: false, keys: [] }];
    const first = await recoverRefusedKey(current(), 'key_unknown');
    expect(first?.ok).toBe(true);
    expect(current().api!.api_key).toBe(NEW);
    expect(h.attachedKeys).toEqual([NEW]);
    expect(keyRefusalFor('local-1')).toBeUndefined();
    // The new key refused too: a cause a key does not cure. The caller says its own line.
    expect(await recoverRefusedKey(current(), 'key_revoked')).toBeNull();
    expect(h.mintCalls).toHaveLength(1);
    expect(keyRefusalFor('local-1')).toBe('key_revoked');
  });

  it('a refused PIN is never answered with a new key', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'owner', public_read: false, keys: [] }];
    expect(await recoverRefusedKey(current(), 'pin')).toBeNull();
    expect(h.mintCalls).toEqual([]);
  });

  it('signed out, nothing is made', async () => {
    patchSlice('registry', { ...getState().registry, account_token: undefined });
    expect(await recoverRefusedKey(current(), 'key_revoked')).toBeNull();
    expect(h.mintCalls).toEqual([]);
  });

  it('a member with no PIN on a dead key gets a read key: better than none', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'collaborator', member_role: 'contributor', public_read: false, keys: [] }];
    h.mintAnswer = async (scope) => {
      if (scope !== 'read') throw new OwV2Error(409, { code: 'pin_required', message: 'pin' }, '');
      return { id: 'k-read', last4: 'cccc', scope: 'READ', key: READ };
    };
    const out = await makeNewWorldKey(current(), { keyDead: true });
    expect(out.kind).toBe('swapped');
    expect(current().api!.api_key).toBe(READ);
    expect(current().api!.read_only).toBe(true);
    expect(h.revoked).toEqual([]);
  });

  it('a read key that would gain nothing is taken back, and the reason said', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'collaborator', member_role: 'contributor', public_read: false, keys: [] }];
    patchSlice('registry', { ...getState().registry, worlds: [entry({ api_key: READ, read_only: true })] });
    h.mintAnswer = async (scope) => {
      if (scope !== 'read') throw new OwV2Error(409, { code: 'pin_required', message: 'pin' }, '');
      return { id: 'k-read-2', last4: 'dddd', scope: 'READ', key: 'ow_r_' + 'd'.repeat(32) };
    };
    const out = await makeNewWorldKey(current(), { keyDead: false });
    expect(out.kind).toBe('kept');
    expect(out.kind === 'kept' && out.line).toMatch(/needs a PIN on your account/);
    expect(h.revoked).toEqual(['k-read-2']);
    expect(current().api!.api_key).toBe(READ);
  });

  it('the member who set a PIN: a write key, and the world opens to edit', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'collaborator', member_role: 'contributor', public_read: false, keys: [] }];
    patchSlice('registry', { ...getState().registry, worlds: [entry({ api_key: READ, read_only: true })] });
    store.setViewOnly(true);
    const out = await makeNewWorldKey(current(), { keyDead: false });
    expect(out.kind).toBe('swapped');
    expect(current().api!.api_key).toBe(NEW);
    expect(current().api!.read_only).toBeUndefined();
    await expect(store.createElement('character', { name: 'Mine' })).resolves.toBeTruthy();
  });

  it('a PIN question cancelled takes the new key back', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'collaborator', member_role: 'co_builder', public_read: false, keys: [] }];
    patchSlice('registry', { ...getState().registry, pin: undefined });
    h.pinAnswer = null;
    const out = await makeNewWorldKey(current(), { keyDead: true });
    expect(out.kind).toBe('cancelled');
    expect(h.revoked).toEqual(['k-write']);
    expect(current().api!.api_key).toBe(OLD);
  });

  it('a world unlinked while the key was made does not take it', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'owner', public_read: false, keys: [] }];
    h.mintAnswer = async () => {
      patchSlice('registry', { ...getState().registry, worlds: [{ ...entry(), state: 'local-only', api: undefined }] });
      return { id: 'k-write', last4: 'bbbb', scope: 'WRITE', key: NEW };
    };
    const out = await makeNewWorldKey(current(), { keyDead: true });
    expect(out.kind).toBe('failed');
    expect(h.revoked).toEqual(['k-write']);
  });

  it('a step failing after the key landed never takes back the key the world now has (gate G6)', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'owner', public_read: false, keys: [] }];
    store.setViewOnly = () => { throw new Error('store gone'); };
    const out = await makeNewWorldKey(current(), { keyDead: true });
    expect(out.kind).toBe('failed');
    expect(current().api!.api_key).toBe(NEW);
    expect(h.revoked).toEqual([]);
  });

  it('a world relinked to another online world meanwhile never takes the first one\'s key', async () => {
    h.rows = [{ id: WORLD, name: 'Kessel', role: 'owner', public_read: false, keys: [] }];
    h.mintAnswer = async () => {
      patchSlice('registry', { ...getState().registry, worlds: [entry({ world_id: 'w-other', api_key: 'ow_w_' + 'e'.repeat(32) })] });
      return { id: 'k-write', last4: 'bbbb', scope: 'WRITE', key: NEW };
    };
    const out = await makeNewWorldKey(current(), { keyDead: true });
    expect(out.kind).toBe('failed');
    expect(h.revoked).toEqual(['k-write']);
    expect(current().api!.api_key).toBe('ow_w_' + 'e'.repeat(32));
  });
});
