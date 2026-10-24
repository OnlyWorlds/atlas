/**
 * The world file (1.17 bout 5, contract §5, §9 invariants 13 and 14; S370
 * gate lens A A1, A11, lens B B12): one `.zip` holding one world as the
 * portable copy (no `api`, no sync-state, no tombstones, no transient file),
 * and a reader that refuses before anything is written: zip-slip, absolute
 * paths, a declared-size bomb, no world, two worlds, the tour's sandbox.
 */
import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { collectWorldFiles, zipWorld, readWorldZip, worldFileName, leftOutRecords, RecordsListUnreadable } from '../../src/store/world-file';

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

  it('leaves out a repository and env files, keeps an env template (S449)', async () => {
    const d = linkedWorld();
    d.put('.git/config', '[core]');
    d.put('.git/objects/ab/cdef', 'old key in history');
    d.put('.env', 'OW_SEAT_KEY=ow_s_secret');
    d.put('.env.local', 'OW_SEAT_KEY=ow_s_secret');
    d.put('tools/.ENV', 'X=1');
    d.put('.env.example', 'OW_SEAT_KEY=');
    d.put('.agents/skills/world/SKILL.md', '# the world skill');
    const paths = (await collectWorldFiles(as(d))).map(f => f.path);
    expect(paths.filter(p => p.includes('.git') || /(^|\/)\.env/i.test(p))).toEqual(['.env.example']);
    expect(paths).toContain('.agents/skills/world/SKILL.md');
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

  it('the same world gives the same bytes, whatever order its files are found in, and at any hour (#527 criterion d, §4.7)', async () => {
    const files = await collectWorldFiles(as(linkedWorld()));
    const first = zipWorld(files, 'hollow-reach-0192a000');
    const again = zipWorld(await collectWorldFiles(as(linkedWorld())), 'hollow-reach-0192a000');
    const reversed = zipWorld([...files].reverse(), 'hollow-reach-0192a000');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2031-03-04T05:06:07Z')); // a later day: no entry may carry the time it was written
    let later: Uint8Array;
    try { later = zipWorld(files, 'hollow-reach-0192a000'); } finally { vi.useRealTimers(); }
    for (const z of [again, reversed, later]) expect(Buffer.from(z).equals(Buffer.from(first))).toBe(true);
    // The instrument can move: one byte of one element changes the file.
    const touched = files.map(f => f.path.startsWith('elements/') ? { ...f, data: strToU8('{"id":"1","name":"Anb"}') } : f);
    expect(Buffer.from(zipWorld(touched, 'hollow-reach-0192a000')).equals(Buffer.from(first))).toBe(false);
  });

  it('a file Atlas writes keeps media and its sidecars and .atlas, leads with the marker, and leaves other files behind (§4.7 OW-6, OW-7; SDK 4.49)', () => {
    const e = (path: string, s: string) => ({ path, data: strToU8(s) });
    const zip = zipWorld([
      e('world.json', j({ id: WID, name: 'W' })),
      e('elements/map/m--aaaa.json', '{}'),
      e('media/0192-el/maps/river.png', 'PNG'),
      e('media/0192-el/maps/0193-media.meta.json', '{"id":"0193-media"}'),
      e('.atlas/styles.json', '{}'),
      e('README.md', 'hi'),
      e('notes/plan.md', 'x'),
    ], 'w');
    expect(readWorldZip(zip).files.map(f => f.path)).toEqual([
      '.atlas/styles.json', 'elements/map/m--aaaa.json', 'media/0192-el/maps/0193-media.meta.json', 'media/0192-el/maps/river.png', 'world.json',
    ]);
    // The stored marker is the archive's first entry (a local header's name starts at byte 30).
    expect(new TextDecoder().decode(zip.slice(30, 38))).toBe('mimetype');
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

  it('two worlds in one file; a loose file beside the world\'s folder is left out, not refused (§4.7 OW-4, SDK 4.49)', () => {
    refuses({ ...world, 'v/world.json': strToU8(j({ id: 'other', name: 'V' })) }, /more than one world/);
    const back = readWorldZip(zipSync({ ...world, 'stray.txt': strToU8('x'), '__MACOSX/w/._world.json': strToU8('x') }));
    expect(back.files.some(f => f.path.includes('stray') || f.path.includes('MACOSX'))).toBe(false);
  });

  it('the six refusals §4.7 adds each say why in Atlas\'s words (SDK 4.49)', () => {
    // A marker naming another type, a duplicate path, a name §4.7 forbids: three of the six the reader can be handed by fflate.
    refuses({ mimetype: strToU8('application/zip'), ...world }, /something other than an OnlyWorlds world/);
    refuses({ ...world, 'w/elements/character/A.json': strToU8('{}'), 'w/elements/character/a.json': strToU8('{}') }, /differ only in capitals or accents/);
    refuses({ ...world, 'w/elements/character/con.json': strToU8('{}') }, /names is not allowed in a world/);
  });

  it('two file names fold by Unicode 15.1, never the runtime\'s (§4.7 OW-18, schema-dist serial 57, SDK 4.71)', () => {
    // U+11383 and U+11382 U+113C9 are Tulu-Tigalari: Unicode 16 composes the pair,
    // 15.1 leaves both unassigned, so the spec keeps two names (red on SDK 4.70.0 under Node 22).
    const two = { 'w/media/\u{11383}.png': strToU8('a'), 'w/media/\u{11382}\u{113C9}.png': strToU8('b') };
    expect(readWorldZip(zipSync({ ...world, ...two })).files.filter(f => f.path.startsWith('media/'))).toHaveLength(2);
    const written = unzipSync(zipWorld(Object.entries({ ...world, ...two }).map(([p, data]) => ({ path: p.slice(2), data })), 'w'));
    expect(Object.keys(written).filter(p => p.startsWith('w/media/'))).toHaveLength(2);
    // Where both assign the code points nothing moves: é composed and decomposed stay one name.
    refuses({ ...world, 'w/media/é.png': strToU8('a'), 'w/media/é.png': strToU8('b') }, /differ only in capitals or accents/);
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

// Folder spec §4.5 rule 11, §4.7 OW-8 (v0.3.15; Skeld h58 #10911; SDK 4.63.0):
// a producer's records marked private stay out of a world file unless asked.
// The two files are the standard's own (schema-dist dist.49, Quillon's case):
// the asked side holds `records/fold/` (private) and `records/lab/` whole.
describe('private records (§4.5 rule 11, OW-8)', () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(resolvePath(__dirname, '../fixtures/owworld', name)));
  const entries = (zip: Uint8Array) => {
    const out = new Map<string, string>();
    for (const [n, d] of Object.entries(unzipSync(zip))) if (n !== 'mimetype') out.set(n, Buffer.from(d).toString('hex'));
    return out;
  };
  const asked = () => readWorldZip(fixture('pass-OW-8-private-asked.owworld')).files;
  const e = (path: string, s: string) => ({ path, data: strToU8(s) });
  const entry = (producer: string, extra: Record<string, unknown> = {}) => ({ producer, format: 'x', version: '1', deltas: false, ...extra });

  it('the default leaves fold out whole and says so; RECORDS.json and lab travel byte for byte, as the standard\'s file has them', () => {
    const zip = zipWorld(asked(), 'abbey');
    expect(entries(zip)).toEqual(entries(fixture('pass-OW-8-private-left-out.owworld')));
    expect(leftOutRecords(asked(), zip)).toEqual(['fold']);
  });

  it('asked, every record travels, the private producer\'s dot-file included, and nothing is said to be left out', () => {
    const zip = zipWorld(asked(), 'abbey', { includePrivateRecords: true });
    expect(entries(zip)).toEqual(entries(fixture('pass-OW-8-private-asked.owworld')));
    expect([...entries(zip).keys()]).toContain('abbey/records/fold/.head');
    expect(leftOutRecords(asked(), zip)).toEqual([]);
  });

  it('a producer named Fold in the list is the folder fold (OW-18\'s fold, the SDK\'s match)', () => {
    const files = [
      e('world.json', j({ id: WID, name: 'W' })),
      e('records/RECORDS.json', JSON.stringify([entry('Fold', { private: true })])),
      e('records/fold/spine.jsonl', '{}'),
    ];
    const zip = zipWorld(files, 'w');
    expect(leftOutRecords(files, zip)).toEqual(['fold']);
    expect([...entries(zip).keys()]).toContain('w/records/RECORDS.json');
  });

  it('a records list that will not read leaves nothing out by guess: no file, unless every record is asked for', () => {
    const list = (body: string) => [
      e('world.json', j({ id: WID, name: 'W' })),
      e('records/RECORDS.json', body),
      e('records/fold/spine.jsonl', '{}'),
    ];
    // The shape before v0.3.12 (an object), not JSON, an entry private without a name.
    for (const body of ['{"producers": []}', '{nope', '[{"private": true}]']) {
      expect(() => zipWorld(list(body), 'w')).toThrow(RecordsListUnreadable);
      const all = zipWorld(list(body), 'w', { includePrivateRecords: true });
      expect([...entries(all).keys()]).toContain('w/records/fold/spine.jsonl');
    }
  });

  it('no list, or a private entry with no folder, leaves nothing out and asks nothing', () => {
    const none = [e('world.json', j({ id: WID, name: 'W' })), e('records/lab/ledger.bin', 'L')];
    expect(leftOutRecords(none, zipWorld(none, 'w'))).toEqual([]);
    const noDir = [...none, e('records/RECORDS.json', JSON.stringify([entry('fold', { private: true })]))];
    expect(leftOutRecords(noDir, zipWorld(noDir, 'w'))).toEqual([]);
    // The instrument can move: lab marked private is named.
    const labPrivate = [...none, e('records/RECORDS.json', JSON.stringify([entry('lab', { private: true })]))];
    expect(leftOutRecords(labPrivate, zipWorld(labPrivate, 'w'))).toEqual(['lab']);
  });
});
