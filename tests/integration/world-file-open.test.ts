/**
 * Open a world file (1.17 bout 5, contract §5.2, §9 invariants 6, 14;
 * Skeld 2026-10-04). The file lands as a
 * browser world through the make protocol (fresh nonced directory, world.json
 * last, a failure removes it, a full origin is fatal); the same world already
 * here is refused; a world the browser cleared is restored under its own
 * entry, and a linked one gets its link back with its first sync reviewed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { FakeDirHandle, FakeFileHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { openWorldFile } from '../../src/setup/world-file-open';
import { allLandings } from '../../src/store/land-behind';
import { watchFailedLandings } from '../../src/setup/landing-failed';

// A world file's world opens at once and its files land behind it (#865): what is
// read from disk afterwards is read once every landing of the test has landed.
const landedAll = () => Promise.all(allLandings().map(l => l.landed.catch(() => {})));
const openLanded = async (...a: Parameters<typeof openWorldFile>) => { const o = await openWorldFile(...a); await landedAll(); return o; };

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
    try { out = await openLanded(worldZip()); } finally { FakeDirHandle.prototype.getFileHandle = real; }
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
    expect(await openLanded(worldZip())).toEqual({ kind: 'already', worldId: 'w1' });
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
    expect(await openLanded(worldZip())).toMatchObject({ kind: 'already' });
    expect(dirs()).toEqual([]);
  });

  it('restores a world the browser cleared under its own entry; a linked one gets its link back and its first sync reviewed', async () => {
    const cleared: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'api-linked', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z', api: { world_id: 'srv-1', api_key: 'ow_w_key', world_name: 'Hollow Reach' },
      folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000-dead' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [cleared] });
    const out = await openLanded(worldZip());
    expect(out).toEqual({ kind: 'restored', worldId: 'w1' });
    const e = reg().worlds[0];
    expect(reg().worlds).toHaveLength(1);
    expect(e.cleared_at).toBeUndefined();
    expect(e.folder.folder_name).not.toBe('hollow-reach-0192a000-dead');       // a fresh name (gate B6)
    expect(e.review_first_sync).toBe(true);                                       // gate A9, Skeld's condition 3
    const meta = JSON.parse((home.children.get(e.folder.folder_name) as FakeDirHandle).get('world.json')!);
    expect(meta).toMatchObject({ id: WID, api: { world_id: 'srv-1', api_key: 'ow_w_key' } });
  });

  it('a file\'s provenance lines go when the restore puts this browser\'s link back', async () => {
    const cleared: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'api-linked', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z', api: { world_id: 'srv-1', api_key: 'ow_w_key', world_name: 'Hollow Reach' },
      folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000-dead' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [cleared] });
    const lines = { source: { server: 'https://www.onlyworlds.com', world: 'srv-1', at: '2026-10-20T19:00:00.000Z' }, exported_as: { kind: 'character', role: 'guest', character: { id: 'a', name: 'Ana' } } };
    expect(await openLanded(worldZip({ id: WID, name: 'Hollow Reach', ...lines }))).toEqual({ kind: 'restored', worldId: 'w1' });
    const meta = JSON.parse((home.children.get(reg().worlds[0].folder.folder_name) as FakeDirHandle).get('world.json')!);
    expect(meta.api).toMatchObject({ world_id: 'srv-1' });
    expect('source' in meta || 'exported_as' in meta).toBe(false);
  });

  it('a world file opened as a new world keeps its lines (no link goes back)', async () => {
    const lines = { source: { server: 'https://www.onlyworlds.com', world: 'srv-9', at: '2026-10-20T19:00:00.000Z' }, exported_as: { kind: 'character', role: 'guest', character: { id: 'a', name: 'Ana' } } };
    const out = await openLanded(worldZip({ id: WID, name: 'Hollow Reach', ...lines }));
    expect(out.kind).toBe('opened');
    const e = reg().worlds.find(w => w.id === (out as { worldId: string }).worldId)!;
    const meta = JSON.parse((home.children.get(e.folder.folder_name) as FakeDirHandle).get('world.json')!);
    expect(meta).toMatchObject(lines);
  });

  it('a cleared seat world restores its seat marker, never its secret (conv. 132)', async () => {
    const SECRET = 'ow_s_' + 'S'.repeat(32);
    const cleared: WorldRegistryEntry = {
      id: 'w1', name: 'Hollow Reach', state: 'api-linked', where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z',
      created_at: '2026-10-05T00:00:00.000Z',
      api: { world_id: 'srv-1', api_key: 'ow_w_seat', seat: { role: 'contributor' }, seat_secret: SECRET },
      folder: { handle_key: `world-${WID}`, folder_name: 'hollow-reach-0192a000-dead' },
    };
    patchSlice('registry', { ...defaultRegistry(), worlds: [cleared] });
    expect(await openLanded(worldZip())).toEqual({ kind: 'restored', worldId: 'w1' });
    const raw = (home.children.get(reg().worlds[0].folder.folder_name) as FakeDirHandle).get('world.json')!;
    expect(raw).not.toContain(SECRET);
    expect(JSON.parse(raw)).toMatchObject({ api: { world_id: 'srv-1', api_key: 'ow_w_seat', seat: { role: 'contributor' } } });
    expect(reg().worlds[0].api?.seat_secret).toBe(SECRET);
  });

  it('a full browser storage at the landing\'s first write leaves no directory and no entry, and says so', async () => {
    const real = FakeFileHandle.prototype.createWritable;
    FakeFileHandle.prototype.createWritable = async function (this: FakeFileHandle, o?: { keepExistingData?: boolean }) {
      if (this.name === 'landing') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
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

  it('a full browser storage while its files land behind it: the directory goes and the row is cleared (contract L9\')', async () => {
    const real = FakeFileHandle.prototype.createWritable;
    FakeFileHandle.prototype.createWritable = async function (this: FakeFileHandle, o?: { keepExistingData?: boolean }) {
      if (this.name === 'map.png') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
      return real.call(this, o);
    };
    const unwatch = watchFailedLandings(); // as main.ts does at boot
    let out;
    try {
      out = await openWorldFile(worldZip());
      await landedAll();
    } finally {
      FakeFileHandle.prototype.createWritable = real;
    }
    expect(out).toMatchObject({ kind: 'opened' });
    await vi.waitFor(() => expect(reg().worlds[0]?.cleared_at).toBeTruthy());
    expect(dirs()).toEqual([]);
    unwatch();
  });

  it('two opens of the same file at once land one world, never two entries (gate F2)', async () => {
    const [a, b] = await Promise.allSettled([openWorldFile(worldZip()), openWorldFile(worldZip())]);
    await landedAll();
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
    await landedAll();
    expect(dirs()).toEqual([reg().worlds[0].folder.folder_name]);
  });

  it('a hand-zipped world never lands with its own link, key or sync files (gate F5)', async () => {
    const zip = zipSync({
      'w/world.json': strToU8(j({ id: WID, name: 'Hollow Reach', api: { world_id: 'x', api_key: 'ow_w_theirs' } })),
      'w/.atlas/sync-state.json': strToU8('{"conflicts":[]}'),
      'w/.atlas/tombstones.json': strToU8('[]'),
    });
    const out = await openLanded(zip);
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
    const out = await openLanded(worldZip());
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
      const out = await openLanded(worldZip(), { chooseWhere: async () => { asked++; expect(dirs()).toEqual([]); return null; } });
      expect(out).toEqual({ kind: 'cancelled' });
      expect(asked).toBe(1);
      expect(dirs()).toEqual([]);
      expect(reg().worlds).toHaveLength(0);
    });

    it('either answer lands the world in this browser first (a folder answer is the caller\'s move after it)', async () => {
      const out = await openLanded(worldZip(), { chooseWhere: async () => 'folder' });
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
      expect(await openLanded(worldZip(), { chooseWhere: ask })).toEqual({ kind: 'already', worldId: 'w1' });
      patchSlice('registry', { ...defaultRegistry(), worlds: [{ ...here, where: 'browser', cleared_at: '2026-10-05T09:00:00.000Z', folder: { ...here.folder, folder_name: 'hollow-reach-0192a000-dead' } }] });
      expect(await openLanded(worldZip(), { chooseWhere: ask })).toEqual({ kind: 'restored', worldId: 'w1' });
    });
  });
});
