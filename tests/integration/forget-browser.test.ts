/**
 * Fully forget (Atlas #140): what the confirm screen names, and the order
 * that is the gate. Browser storage goes first; if any of it will not go,
 * nothing else is cleared (the registry still names every world, so nothing
 * is lost track of and the next boot does not re-adopt half a world).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { HANDLE_VAULT_DB } from '../../src/core/constants';
import { FORGET_PARTIAL_LINE, forgetEverything, forgetInventory } from '../../src/setup/forget-browser';
import { isPlainError } from '../../src/core/plain-error';

const entry = (name: string, over: Partial<WorldRegistryEntry>): WorldRegistryEntry => ({
  id: name, name, state: 'local-only', created_at: '2026-01-01T00:00:00.000Z',
  folder: { handle_key: `k-${name}`, folder_name: name }, ...over,
} as WorldRegistryEntry);

const vaultExists = async (): Promise<boolean> =>
  ((await indexedDB.databases()) ?? []).some(d => d.name === HANDLE_VAULT_DB);
const makeVault = (): Promise<void> => new Promise((resolve, reject) => {
  const req = indexedDB.open(HANDLE_VAULT_DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore('handles');
  req.onsuccess = () => { req.result.close(); resolve(); };
  req.onerror = () => reject(req.error);
});

afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('forgetInventory', () => {
  it('names the browser worlds that exist only here apart from the online ones, and counts folder worlds', () => {
    const reg = {
      ...defaultRegistry(),
      worlds: [
        entry('Lonely', { where: 'browser' }),
        entry('Shared', { where: 'browser', state: 'api-linked', api: { world_id: 's', api_key: 'k' } }),
        entry('Gone', { where: 'browser', cleared_at: '2026-01-02T00:00:00.000Z' }),
        entry('Hyperion', { where: 'browser', demo: true }),
        // A 1.16 tour world: no `where`, at the OPFS root; never a folder on the drive.
        entry('Old tour', { demo: true }),
        entry('On disk', {}),
        entry('Seated', { state: 'api-linked', api: { world_id: 'x', api_key: 'k', seat: {} } }),
      ],
    };
    expect(forgetInventory(reg)).toEqual({ browserOnly: ['Lonely'], browserOnline: ['Shared'], folderWorlds: 2, seatWorlds: 1, heldSeats: [] });
  });
});

describe('forgetEverything', () => {
  it('removes browser storage, the vault and both storages, then reloads', async () => {
    const opfs = new FakeDirHandle('opfs');
    opfs.put('browser-worlds/lonely-1234/world.json', '{}');
    opfs.put('stray.txt', 'x');
    await makeVault();
    localStorage.setItem('atlas_worlds_registry', '{"worlds":[]}');
    sessionStorage.setItem('atlas_x', '1');
    let reloaded = 0;

    await forgetEverything({ opfsRoot: async () => opfs as unknown as FileSystemDirectoryHandle, reload: () => { reloaded++; } });

    expect([...opfs.children.keys()]).toEqual([]);
    expect(await vaultExists()).toBe(false);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(reloaded).toBe(1);
  });

  it('the worlds\' home goes last: a stray entry that will not go leaves every world where it was', async () => {
    const opfs = new FakeDirHandle('opfs');
    opfs.put('browser-worlds/lonely-1234/world.json', '{}');
    opfs.put('zz-stray/x.txt', 'x');
    const real = opfs.removeEntry.bind(opfs);
    opfs.removeEntry = async (name: string, o?: { recursive?: boolean }) => {
      if (name === 'zz-stray') throw new DOMException('denied', 'NotAllowedError');
      return real(name, o);
    };
    await expect(forgetEverything({ opfsRoot: async () => opfs as unknown as FileSystemDirectoryHandle, reload: () => {} })).rejects.toThrow();
    expect(opfs.children.has('browser-worlds')).toBe(true);
  });

  it('a directory busy for a moment (a store just closed) is tried again', async () => {
    const opfs = new FakeDirHandle('opfs');
    opfs.put('browser-worlds/lonely-1234/world.json', '{}');
    const real = opfs.removeEntry.bind(opfs);
    let busy = 2;
    opfs.removeEntry = async (name: string, o?: { recursive?: boolean }) => {
      if (busy-- > 0) throw new DOMException('held', 'NoModificationAllowedError');
      return real(name, o);
    };
    let reloaded = 0;
    await forgetEverything({ opfsRoot: async () => opfs as unknown as FileSystemDirectoryHandle, reload: () => { reloaded++; }, wait: async () => {} });
    expect([...opfs.children.keys()]).toEqual([]);
    expect(reloaded).toBe(1);
  });

  it('a removal that fails stops it all: the list of worlds, the vault and the settings stay, and no reload', async () => {
    const opfs = new FakeDirHandle('opfs');
    opfs.put('browser-worlds/lonely-1234/world.json', '{}');
    opfs.removeEntry = async () => { throw new DOMException('held', 'NoModificationAllowedError'); };
    await makeVault();
    localStorage.setItem('atlas_worlds_registry', '{"worlds":[]}');
    let reloaded = 0;

    const err = await forgetEverything({ opfsRoot: async () => opfs as unknown as FileSystemDirectoryHandle, reload: () => { reloaded++; }, wait: async () => {} })
      .then(() => null, e => e);

    expect(isPlainError(err) && err.message).toBe(FORGET_PARTIAL_LINE);
    expect(localStorage.getItem('atlas_worlds_registry')).toBe('{"worlds":[]}');
    expect(await vaultExists()).toBe(true);
    expect(reloaded).toBe(0);
  });
});
