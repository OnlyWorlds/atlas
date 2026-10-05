/**
 * Open a world file (1.17 bout 5, contract §5.2, §9 invariants 6, 14; S370
 * gate lens A A8, A9, lens B B6, B16; Skeld h20 #511). The file lands as a
 * browser world through the make protocol (fresh nonced directory, world.json
 * last, a failure removes it, a full origin is fatal); the same world already
 * here is refused; a world the browser cleared is restored under its own
 * entry, and a linked one gets its link back with its first sync reviewed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { FakeDirHandle, FakeFileHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { openWorldFile } from '../../src/setup/world-file-open';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const asDir = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;
const WID = '0192a000-aaaa-7bbb-8ccc-000000000001';
let opfs: FakeDirHandle;
let home: FakeDirHandle;

function worldZip(meta: Record<string, unknown> = { id: WID, name: 'Hollow Reach' }): Uint8Array {
  return zipSync({
    'hollow-reach-0192a000/world.json': strToU8(j(meta)),
    'hollow-reach-0192a000/elements/character/ana--00000001.json': strToU8(j({ id: '1', name: 'Ana' })),
    'hollow-reach-0192a000/media/map.png': strToU8('PNG'),
  });
}
const dirs = () => [...home.children.keys()].sort();
const reg = () => getState().registry;

beforeEach(async () => {
  opfs = new FakeDirHandle('opfs');
  home = await opfs.getDirectoryHandle(BROWSER_HOME, { create: true });
  setOpfsRootForTests(async () => asDir(opfs));
  patchSlice('registry', defaultRegistry());
});
afterEach(() => { setOpfsRootForTests(null); });

describe('openWorldFile', () => {
  it('lands as a browser world in a fresh directory, world.json written last, no marker left', async () => {
    const created: string[] = [];
    const real = FakeDirHandle.prototype.getFileHandle;
    FakeDirHandle.prototype.getFileHandle = function (this: FakeDirHandle, name: string, o?: { create?: boolean }) {
      if (o?.create) created.push(name);
      return real.call(this, name, o);
    };
    let out;
    try { out = await openWorldFile(worldZip()); } finally { FakeDirHandle.prototype.getFileHandle = real; }
    expect(out).toMatchObject({ kind: 'opened' });
    const e = reg().worlds.find(w => w.id === (out as { worldId: string }).worldId)!;
    expect(e).toMatchObject({ name: 'Hollow Reach', where: 'browser', folder: { handle_key: `world-${WID}` } });
    const dir = home.children.get(e.folder.folder_name) as FakeDirHandle;
    expect(dir.list()).toEqual(['elements/character/ana--00000001.json', 'media/map.png', 'world.json']);
    const files = created.filter(n => n !== 'making');
    expect(files[files.length - 1]).toBe('world.json');                     // invariant 6
    expect(e.folder.folder_name).toMatch(/^hollow-reach-0192a000-[0-9a-f]{4}$/); // nonced (gate B6)
  });

  it('refuses the same world already here, writing nothing (invariant 14)', async () => {
    const here: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'local-only', created_at: '2026-10-05T00:00:00.000Z',
      folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [here] });
    expect(await openWorldFile(worldZip())).toEqual({ kind: 'already', worldId: 'w1' });
    expect(dirs()).toEqual([]);
    expect(reg().worlds).toHaveLength(1);
  });

  it('a linked world matched by a suffixed key (a second link) is the same world too (gate A8)', async () => {
    const here: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'api-linked', created_at: '2026-10-05T00:00:00.000Z',
      api: { world_id: WID, api_key: 'k' },
      folder: { handle_key: `world-${WID}-2`, folder_name: 'hollow-reach-0192a000' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [here] });
    expect(await openWorldFile(worldZip())).toMatchObject({ kind: 'already' });
    expect(dirs()).toEqual([]);
  });

  it('restores a world the browser cleared under its own entry; a linked one gets its link back and its first sync reviewed', async () => {
    const cleared: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'api-linked', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z', api: { world_id: 'srv-1', api_key: 'ow_w_key', world_name: 'Hollow Reach' },
      folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000-dead' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [cleared] });
    const out = await openWorldFile(worldZip());
    expect(out).toEqual({ kind: 'restored', worldId: 'w1' });
    const e = reg().worlds[0];
    expect(reg().worlds).toHaveLength(1);
    expect(e.cleared_at).toBeUndefined();
    expect(e.folder.folder_name).not.toBe('hollow-reach-0192a000-dead');       // a fresh name (gate B6)
    expect(e.review_first_sync).toBe(true);                                       // gate A9, Skeld's condition 3
    const meta = JSON.parse((home.children.get(e.folder.folder_name) as FakeDirHandle).get('world.json')!);
    expect(meta).toMatchObject({ id: WID, api: { world_id: 'srv-1', api_key: 'ow_w_key' } });
  });

  it('a full browser storage mid-write leaves no directory and no entry, and says so', async () => {
    const real = FakeFileHandle.prototype.createWritable;
    FakeFileHandle.prototype.createWritable = async function (this: FakeFileHandle, o?: { keepExistingData?: boolean }) {
      if (this.name === 'map.png') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      return real.call(this, o);
    };
    try {
      await expect(openWorldFile(worldZip())).rejects.toThrow(/storage for Atlas is full/);
    } finally {
      FakeFileHandle.prototype.createWritable = real;
    }
    expect(dirs()).toEqual([]);
    expect(reg().worlds).toHaveLength(0);
  });

  it('two opens of the same file at once land one world, never two entries (gate F2)', async () => {
    const [a, b] = await Promise.allSettled([openWorldFile(worldZip()), openWorldFile(worldZip())]);
    expect(reg().worlds).toHaveLength(1);
    expect(dirs()).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual(['fulfilled', 'rejected']);
  });

  it('two restores of the same cleared world at once leave one directory, the one the entry names (gate F2)', async () => {
    const cleared: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'local-only', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z', folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000-dead' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [cleared] });
    await Promise.allSettled([openWorldFile(worldZip()), openWorldFile(worldZip())]);
    expect(dirs()).toEqual([reg().worlds[0].folder.folder_name]);
  });

  it('a hand-zipped world never lands with its own link, key or sync files (gate F5)', async () => {
    const zip = zipSync({
      'w/world.json': strToU8(j({ id: WID, name: 'Hollow Reach', api: { world_id: 'x', api_key: 'ow_w_theirs' } })),
      'w/.atlas/sync-state.json': strToU8('{"conflicts":[]}'),
      'w/.atlas/tombstones.json': strToU8('[]'),
    });
    const out = await openWorldFile(zip);
    const e = reg().worlds.find(w => w.id === (out as { worldId: string }).worldId)!;
    const dir = home.children.get(e.folder.folder_name) as FakeDirHandle;
    expect(dir.list()).toEqual(['world.json']);
    expect(dir.get('world.json')).not.toContain('ow_w_theirs');
    expect(e.state).toBe('local-only');
  });

  it('a restore whose registry save fails leaves no directory behind (gate F6)', async () => {
    const cleared: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'local-only', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z', folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000-dead' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [cleared] });
    const realSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (this: Storage, k: string, v: string) {
      if (k.includes('regist') || v.includes('"worlds"')) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      return realSet.call(this, k, v);
    };
    try {
      await expect(openWorldFile(worldZip())).rejects.toThrow(/could not save/);
    } finally {
      Storage.prototype.setItem = realSet;
    }
    expect(dirs()).toEqual([]);
    expect(reg().worlds[0].cleared_at).toBeTruthy();
  });

  it('a cleared world matched only through a former link is not "already here": the file opens as its own world (gate F7)', async () => {
    const cleared: WorldRegistryEntry = {
      id: 'w1', name: 'Other', state: 'local-only', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z', former_api_world_id: WID,
      folder: { handle_key: 'world-0192ffff-0000-7000-8000-000000000000', folder_name: 'other-0192ffff-dead' },
    } as WorldRegistryEntry;
    patchSlice('registry', { ...defaultRegistry(), worlds: [cleared] });
    const out = await openWorldFile(worldZip());
    expect(out.kind).toBe('opened');
    expect(reg().worlds).toHaveLength(2);
  });

  it('a file that is not a world creates nothing', async () => {
    await expect(openWorldFile(strToU8('not a zip'))).rejects.toThrow(/not a world Atlas can open/);
    expect(dirs()).toEqual([]);
  });

  describe('the where-question (contract §5.2: a NEW world only, asked before anything is written)', () => {
    it('is asked for a new world, and a cancelled answer writes nothing', async () => {
      let asked = 0;
      const out = await openWorldFile(worldZip(), { chooseWhere: async () => { asked++; expect(dirs()).toEqual([]); return null; } });
      expect(out).toEqual({ kind: 'cancelled' });
      expect(asked).toBe(1);
      expect(dirs()).toEqual([]);
      expect(reg().worlds).toHaveLength(0);
    });

    it('either answer lands the world in this browser first (a folder answer is the caller\'s move after it)', async () => {
      const out = await openWorldFile(worldZip(), { chooseWhere: async () => 'folder' });
      expect(out.kind).toBe('opened');
      expect(reg().worlds[0]).toMatchObject({ where: 'browser' });
      expect(dirs()).toHaveLength(1);
    });

    it('is never asked for a world already here, or for a restore', async () => {
      const ask = async (): Promise<'folder'> => { throw new Error('asked'); };
      const here: WorldRegistryEntry = {
        id: 'w1', name: 'Hollow Reach', state: 'local-only', created_at: '2026-10-05T00:00:00.000Z',
        folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000' },
      };
      patchSlice('registry', { ...defaultRegistry(), worlds: [here] });
      expect(await openWorldFile(worldZip(), { chooseWhere: ask })).toEqual({ kind: 'already', worldId: 'w1' });
      patchSlice('registry', { ...defaultRegistry(), worlds: [{ ...here, where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z', folder: { ...here.folder, folder_name: 'hollow-reach-0192a000-dead' } }] });
      expect(await openWorldFile(worldZip(), { chooseWhere: ask })).toEqual({ kind: 'restored', worldId: 'w1' });
    });
  });
});
