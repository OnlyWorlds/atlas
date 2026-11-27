/**
 * The folder format's depth bound (serial 148): a world file whose objects
 * or arrays open past level 200 is not read, counted in the text as each
 * opens, before any parse. Element files join the files left out (law 176);
 * a world.json past it is a world.json that cannot be read.
 */
import { describe, it, expect } from 'vitest';
import { tooDeep, FILE_MAX_DEPTH } from '../../src/store/json-depth';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { memoryDirectoryWith } from '../../src/store/memory-dir';
import { openWorldFolder } from '../../src/setup/atlas-root-flow';
import { NOT_A_WORLD, readWorldZip, TOO_DEEP_WORLD, WORLD_NOT_JSON } from '../../src/store/world-file';
import { zipSync } from 'fflate';

const enc = (s: string) => new TextEncoder().encode(s);
/** An element whose x_ value nests to `depth` levels in all, the top object counted 1. */
const deepElement = (id: string, depth: number, open = '[', close = ']') =>
  `{"id":"${id}","type":"character","name":"Deep","x_deep":${open.repeat(depth - 1)}${close.repeat(depth - 1)}}`;

describe('tooDeep counts in the text', () => {
  it('reads 200 and leaves out 201, for arrays, objects and both', () => {
    expect(FILE_MAX_DEPTH).toBe(200);
    expect(tooDeep(deepElement('a', 200))).toBe(false);
    expect(tooDeep(deepElement('a', 201))).toBe(true);
    const obj = (d: number) => '{"id":"a","x":' + '{"k":'.repeat(d - 1) + '1' + '}'.repeat(d - 1) + '}';
    expect(tooDeep(obj(200))).toBe(false);
    expect(tooDeep(obj(201))).toBe(true);
  });
  it('counts no bracket inside a string, an escaped quote or an escaped backslash included', () => {
    expect(tooDeep(`{"name":"${'['.repeat(500)}"}`)).toBe(false);
    expect(tooDeep(`{"name":"a\\"${'{'.repeat(500)}"}`)).toBe(false);
    expect(tooDeep(`{"name":"\\\\","x":${'['.repeat(200)}${']'.repeat(200)}}`)).toBe(true);
  });
  it('counts before any parse: a deep text that is not JSON, and a key written twice, are too deep', () => {
    expect(tooDeep('{"x":' + '['.repeat(300))).toBe(true);
    expect(tooDeep(`{"x":${'['.repeat(201)}${']'.repeat(201)},"x":1}`)).toBe(true);
  });
  it('is linear: 1,000,000 levels answer at once and overflow nothing', () => {
    const t0 = performance.now();
    expect(tooDeep('['.repeat(1_000_000))).toBe(true);
    expect(tooDeep('"' + '['.repeat(1_000_000) + '"')).toBe(false);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

const WORLD = enc(JSON.stringify({ id: '0192b000-0000-7000-8000-000000000148', name: 'Depth' }));
const KIRA = enc(JSON.stringify({ id: '0192b000-0000-7000-8000-000000000001', type: 'character', name: 'Kira' }));
const DEEP_ID = '0192b000-0000-7000-8000-000000000002';

describe('a world folder holding a file past the bound', () => {
  for (const [depth, read] of [[200, true], [201, false], [100_000, false]] as const) {
    it(`an element file ${depth} deep is ${read ? 'read' : 'left out and named, the rest of the world open'}`, async () => {
      const dir = await memoryDirectoryWith([
        { path: 'world.json', data: WORLD },
        { path: 'elements/character/kira--00000001.json', data: KIRA },
        { path: 'elements/character/deep--00000002.json', data: enc(deepElement(DEEP_ID, depth)) },
      ]);
      const store = new FsFolderStore({ disableHeartbeat: true });
      await store.open(dir);
      const names = (await store.listElements()).map(e => e.name).sort();
      expect(names).toEqual(read ? ['Deep', 'Kira'] : ['Kira']);
      expect(store.unreadableFiles()).toEqual(read ? [] : ['character/deep--00000002.json']);
      await store.close();
    });
  }

  it('a world.json past the bound is refused for its depth; one that is not JSON for what it is, never "no world.json"', async () => {
    const deepWorld = `{"id":"0192b000-0000-7000-8000-000000000148","name":"Depth","x_deep":${'['.repeat(200)}${']'.repeat(200)}}`;
    const tooDeepDir = await memoryDirectoryWith([{ path: 'world.json', data: enc(deepWorld) }]);
    await expect(openWorldFolder(tooDeepDir)).rejects.toThrow('The world.json in that folder is nested more than 200 levels deep');
    const brokenDir = await memoryDirectoryWith([{ path: 'world.json', data: enc('{"id": ') }]);
    await expect(openWorldFolder(brokenDir)).rejects.toThrow('The world.json in that folder cannot be read as JSON');
  });
});

describe('a world file whose world.json nests past the bound', () => {
  /** A world file whose world.json nests to `depth` levels in all, the top object counted 1. */
  const worldFileAt = (depth: number) => zipSync({
    'deep-0192b000/world.json': enc(`{"id":"0192b000-0000-7000-8000-000000000148","name":"Depth","x_deep":${'['.repeat(depth - 1)}${']'.repeat(depth - 1)}}`),
    'deep-0192b000/elements/character/ana--00000001.json': enc('{"id":"1","name":"Ana"}'),
  });

  it(`is read at ${FILE_MAX_DEPTH}, and refused past it before anything lands, at any depth`, () => {
    expect(readWorldZip(worldFileAt(FILE_MAX_DEPTH)).worldName).toBe('Depth');
    for (const depth of [FILE_MAX_DEPTH + 1, 100_000]) {
      expect(() => readWorldZip(worldFileAt(depth))).toThrow(TOO_DEEP_WORLD);
    }
  });

  it('a world.json that is there and is no JSON, is said for what it is, never "no world.json"', () => {
    const fileWith = (worldJson: string) => zipSync({
      'w-0192b000/world.json': enc(worldJson),
      'w-0192b000/elements/character/ana--00000001.json': enc('{"id":"1","name":"Ana"}'),
    });
    expect(() => readWorldZip(fileWith('{"id": '))).toThrow(WORLD_NOT_JSON);
    expect(() => readWorldZip(zipSync({ 'w-0192b000/elements/character/ana--00000001.json': enc('{"id":"1"}') }))).toThrow(NOT_A_WORLD);
  });
});
