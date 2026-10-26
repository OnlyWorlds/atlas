/**
 * Agent seats (#104): the per-world PIN and the secret that never
 * reaches the folder. `src/core/seat.ts`; the store half runs the real
 * FsFolderStore on fake-fs and the mock, which must agree.
 */
import { describe, expect, it } from 'vitest';
import { isSeatSecret, seatFromFile, withoutSeatSecret, worldPin } from '../../src/core/seat';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { MockFolderStore } from '../fixtures/mock-folder-store';

const SECRET = 'ow_s_' + 'a'.repeat(32);

function entry(api: WorldRegistryEntry['api']): WorldRegistryEntry {
  return {
    id: 'e1', name: 'W', state: 'api-linked', api,
    folder: { handle_key: 'world-e1', folder_name: 'w' },
    created_at: '2026-01-01T00:00:00.000Z', last_opened_at: '2026-01-01T00:00:00.000Z',
  } as WorldRegistryEntry;
}

describe('isSeatSecret', () => {
  it('knows keel\'s seat secret and nothing else', () => {
    expect(isSeatSecret(SECRET)).toBe(true);
    expect(isSeatSecret('1234')).toBe(false);
    expect(isSeatSecret('ow_w_' + 'a'.repeat(32))).toBe(false);
    expect(isSeatSecret('ow_s_short')).toBe(false);
    expect(isSeatSecret(undefined)).toBe(false);
  });
});

describe('worldPin', () => {
  const reg = { ...defaultRegistry(), pin: '1234' };
  it('an account world sends the account PIN', () => {
    expect(worldPin(entry({ world_id: 'w', api_key: 'ow_w_x' }), reg)).toBe('1234');
  });
  it('a seat world sends its own secret, never the account PIN (R1)', () => {
    expect(worldPin(entry({ world_id: 'w', api_key: 'ow_w_x', seat: { role: 'contributor' }, seat_secret: SECRET }), reg)).toBe(SECRET);
  });
  it('a seat world whose secret is gone has no PIN, even with an account PIN set', () => {
    expect(worldPin(entry({ world_id: 'w', api_key: 'ow_w_x', seat: {} }), reg)).toBeUndefined();
  });
});

describe('seatFromFile (untrusted world.json)', () => {
  it('reads the marker and a plain role, and refuses anything else', () => {
    expect(seatFromFile({ seat: { role: 'contributor' } })).toEqual({ role: 'contributor' });
    expect(seatFromFile({ seat: {} })).toEqual({});
    expect(seatFromFile({ seat: { role: '<img onerror=x>' } })).toEqual({});
    expect(seatFromFile({ seat: 'yes' })).toBeUndefined();
    expect(seatFromFile({})).toBeUndefined();
    expect(seatFromFile(null)).toBeUndefined();
  });
});

describe('the secret never reaches world.json', () => {
  const leaky = { api: { world_id: 'w', api_key: 'ow_w_x', seat: {}, seat_secret: SECRET } };

  it('withoutSeatSecret drops it and keeps the rest', () => {
    const out = withoutSeatSecret(leaky as never) as { api: Record<string, unknown> };
    expect(out.api).toEqual({ world_id: 'w', api_key: 'ow_w_x', seat: {} });
  });

  it('the real store strips it at the write, whatever the caller passed', async () => {
    const root = new FakeDirHandle('w');
    root.put('world.json', JSON.stringify({ id: 'w1', name: 'W' }));
    const store = new FsFolderStore({ tabId: 'tab-a', disableHeartbeat: true });
    await store.open(root as unknown as FileSystemDirectoryHandle);
    await store.writeWorldMeta(leaky as never);
    const onDisk = await (await (root as unknown as FileSystemDirectoryHandle).getFileHandle('world.json')).getFile().then(f => f.text());
    expect(onDisk).not.toContain(SECRET);
    expect(onDisk).not.toContain('seat_secret');
    expect(JSON.parse(onDisk).api.seat).toEqual({});
    await store.close();
  });

  it('the mock store agrees', async () => {
    const store = new MockFolderStore();
    await store.open(null);
    await store.writeWorldMeta(leaky as never);
    expect(JSON.stringify(await store.readWorldMeta())).not.toContain(SECRET);
  });
});
