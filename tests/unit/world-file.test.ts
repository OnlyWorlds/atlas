/**
 * The world file (1.17 bout 5, contract §5, §9 invariants 13 and 14; S370
 * gate lens A A1, A11, lens B B12): one `.zip` holding one world as the
 * portable copy (no `api`, no sync-state, no tombstones, no transient file),
 * and a reader that refuses before anything is written: zip-slip, absolute
 * paths, a declared-size bomb, no world, two worlds, the tour's sandbox.
 */
import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { collectWorldFiles, zipWorld, readWorldZip, worldFileName } from '../../src/store/world-file';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const as = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const WID = '0192a000-aaaa-7bbb-8ccc-000000000001';

function linkedWorld(): FakeDirHandle {
  const d = new FakeDirHandle('w');
  d.put('world.json', j({ id: WID, name: 'Hollow Reach', api: { world_id: 'srv', api_key: 'ow_w_secret' }, time_current: 12 }));
  d.put('.atlas/sync-state.json', j({ paused: false }));
  d.put('.atlas/tombstones.json', '[]');
  d.put('.atlas/charts.json', '[]');
  d.put('.atlas/styles.json', '{}');
  d.put('.atlas/world-prefs.json', j({ notes: 'keep me' }));
  d.put('.atlas/lock', '{}');
  d.put('.atlas/move.json', '{}');
  d.put('elements/character/ana--00000001.json', j({ id: '1', name: 'Ana' }));
  d.put('elements/character/ana--00000001.json.crswap', 'half');
  d.put('media/map.png', 'PNGBYTES');
  return d;
}

describe('the portable copy', () => {
  it('leaves out the link and its key, the sync files and every transient file; keeps the rest byte for byte', async () => {
    const files = await collectWorldFiles(as(linkedWorld()));
    const paths = files.map(f => f.path);
    expect(paths).toEqual([
      '.atlas/charts.json', '.atlas/styles.json', '.atlas/world-prefs.json',
      'elements/character/ana--00000001.json', 'media/map.png', 'world.json',
    ]);
    const meta = JSON.parse(text(files.find(f => f.path === 'world.json')!.data));
    expect(meta).toEqual({ id: WID, name: 'Hollow Reach', time_current: 12 });
    expect(text(files.find(f => f.path === 'media/map.png')!.data)).toBe('PNGBYTES');
    expect(JSON.stringify(files.map(f => text(f.data)))).not.toContain('ow_w_secret');
  });

  it('a world.json that will not parse is never zipped raw: the download refuses (gate F9)', async () => {
    const d = linkedWorld();
    d.put('world.json', '{ "id": "x", "api": { "api_key": "ow_w_secret" } broken');
    await expect(collectWorldFiles(as(d))).rejects.toThrow(/world\.json/);
  });

  it('a world.json that is not one object is refused too (the S446 gate\'s G10)', async () => {
    for (const body of ['null', '[]', '[{"api":{"api_key":"ow_w_secret"}}]', '"a world"']) {
      const d = new FakeDirHandle('w');
      d.put('world.json', body);
      await expect(collectWorldFiles(as(d))).rejects.toThrow(/world\.json will not open/);
    }
  });

  it('names the file and its one top-level folder after the world', () => {
    expect(worldFileName('Hollow Reach', WID, new Date('2026-10-05T10:00:00Z'))).toEqual({
      file: 'hollow-reach-2026-10-05.zip', dir: 'hollow-reach-0192a000',
    });
  });
});

describe('round trip', () => {
  it('a world zipped and read back is the portable copy, under one folder', async () => {
    const files = await collectWorldFiles(as(linkedWorld()));
    const zip = zipWorld(files, 'hollow-reach-0192a000');
    const back = readWorldZip(zip);
    expect(back.worldId).toBe(WID);
    expect(back.worldName).toBe('Hollow Reach');
    expect(back.files.map(f => f.path)).toEqual(files.map(f => f.path));
    for (const f of files) expect(text(back.files.find(b => b.path === f.path)!.data)).toBe(text(f.data));
  });

  it('a world.json at the root, without a folder, reads the same', () => {
    const zip = zipSync({ 'world.json': strToU8(j({ id: WID, name: 'Bare' })), 'elements/character/a.json': strToU8('{}') });
    expect(readWorldZip(zip).files.map(f => f.path)).toEqual(['elements/character/a.json', 'world.json']);
  });

  it('drops transient files a hand-made zip carries', () => {
    const zip = zipSync({ 'w/world.json': strToU8(j({ id: WID, name: 'W' })), 'w/.atlas/lock': strToU8('{}'), 'w/.atlas/move-incoming.json': strToU8('{}'), 'w/__MACOSX/._world.json': strToU8('x'), 'w/.DS_Store': strToU8('x') });
    expect(readWorldZip(zip).files.map(f => f.path)).toEqual(['world.json']);
  });
});

describe('the reader refuses before anything is written', () => {
  const world = { 'w/world.json': strToU8(j({ id: WID, name: 'W' })) };
  const refuses = (entries: Record<string, Uint8Array>, re: RegExp) =>
    expect(() => readWorldZip(zipSync(entries))).toThrow(re);

  it('a path that climbs out, is absolute, names a drive, or has an empty part', () => {
    for (const bad of ['w/../evil.json', '../evil.json', '/etc/evil.json', 'C:/evil.json', 'w//evil.json', 'w\\..\\evil.json']) {
      refuses({ ...world, [bad]: strToU8('x') }, /not a world Atlas can open|cannot be opened safely/);
    }
  });

  it('a file whose contents claim to be bigger than any world', () => {
    expect(() => readWorldZip(zipSync({ ...world, 'w/media/big.bin': new Uint8Array(64) }), { maxBytes: 32 })).toThrow(/too big/);
    expect(() => readWorldZip(zipSync({ ...world, 'w/a': strToU8('1'), 'w/b': strToU8('2') }), { maxEntries: 2 })).toThrow(/too many files/);
  });

  it('no world.json, an unreadable one, one without an id', () => {
    refuses({ 'w/elements/a.json': strToU8('{}') }, /not a world: it has no world\.json/);
    refuses({ 'w/world.json': strToU8('{nope') }, /not a world: it has no world\.json/);
    refuses({ 'w/world.json': strToU8(j({ name: 'no id' })) }, /not a world: it has no world\.json/);
  });

  it('two worlds in one file, or loose files beside the world\'s folder', () => {
    refuses({ ...world, 'v/world.json': strToU8(j({ id: 'other', name: 'V' })) }, /more than one world/);
    refuses({ ...world, 'stray.txt': strToU8('x') }, /more than one world/);
  });

  it('a world.json at the root with another world nested inside (gate F10)', () => {
    refuses({ 'world.json': strToU8(j({ id: WID, name: 'W' })), 'other/world.json': strToU8(j({ id: 'o', name: 'O' })) }, /more than one world/);
  });

  it('a world in its one folder with another world nested inside, or a world.json under .atlas (S376 gate B10)', () => {
    refuses({ ...world, 'w/inner/world.json': strToU8(j({ id: 'o', name: 'O' })) }, /more than one world/);
    refuses({ ...world, 'w/.atlas/world.json': strToU8(j({ id: 'o', name: 'O' })) }, /more than one world/);
  });

  it('a path under .atlas whose first part is a transient file\'s name (S376 gate B10)', () => {
    refuses({ ...world, 'w/.atlas/making/x': strToU8('x') }, /not a world Atlas can open|cannot be opened safely/);
    refuses({ ...world, 'w/.atlas/lock/x': strToU8('x') }, /not a world Atlas can open|cannot be opened safely/);
  });

  it('the tour\'s sandbox', () => {
    refuses({ 'w/world.json': strToU8(j({ id: WID, name: 'Hyperion', demo: true })) }, /not a world Atlas can open/);
  });

  it('something that is not a zip at all', () => {
    expect(() => readWorldZip(strToU8('just some text'))).toThrow(/not a world Atlas can open/);
  });
});
