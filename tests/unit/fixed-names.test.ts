/**
 * A world folder that holds world.json, elements/ or spatial/ only in another
 * case is refused with that cause, never read as an empty world (folder spec
 * 4.8). The memory folder tells capitals apart, as a Linux or ChromeOS disk
 * does: there the store used to open `Elements/` as an empty world and make
 * `elements/` beside it.
 */
import { describe, expect, it } from 'vitest';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { memoryDirectoryWith } from '../../src/store/memory-dir';
import { misnamedFixedName, misnamedSentence } from '../../src/store/fixed-names';
import { openWorldFolder } from '../../src/setup/atlas-root-flow';

const enc = (s: string) => new TextEncoder().encode(s);
const WORLD = enc(JSON.stringify({ id: '0192a000-0000-7000-8000-00000000000a', name: 'Sikelia' }));
const KIRA = enc(JSON.stringify({ id: '0192a000-0000-7000-8000-000000000001', name: 'Kira' }));

const e = (name: string, folder = false) => ({ name, folder });

describe('misnamedFixedName', () => {
  it('names a fixed name held only in another case', () => {
    expect(misnamedFixedName([e('world.json'), e('Elements', true)])).toEqual({ found: 'Elements/', wanted: 'elements/' });
    expect(misnamedFixedName([e('World.JSON'), e('elements', true)])).toEqual({ found: 'World.JSON', wanted: 'world.json' });
    expect(misnamedFixedName([e('world.json'), e('SPATIAL', true)])).toEqual({ found: 'SPATIAL/', wanted: 'spatial/' });
  });
  it('folds as the SDK folds: a long s first is spatial/ in another case', () => {
    expect(misnamedFixedName([e('world.json'), e('ſpatial', true)])).toEqual({ found: 'ſpatial/', wanted: 'spatial/' });
  });
  it('a name held as written is never misnamed, whatever sits beside it', () => {
    expect(misnamedFixedName([e('world.json'), e('elements', true), e('Elements', true), e('World.json')])).toBeNull();
    expect(misnamedFixedName([e('world.json'), e('elements', true), e('spatial', true), e('.atlas', true), e('media', true)])).toBeNull();
    expect(misnamedFixedName([])).toBeNull();
  });
  it('a file is not a folder in another case, nor a folder a file', () => {
    expect(misnamedFixedName([e('world.json'), e('Elements')])).toBeNull();
    expect(misnamedFixedName([e('World.json', true), e('elements', true)])).toBeNull();
  });
  it('says the cause and the way out', () => {
    expect(misnamedSentence({ found: 'Elements/', wanted: 'elements/' })).toBe(
      'This world folder holds Elements/ where the folder format names elements/, so Atlas does not open it: rename it elements/ and open it again.');
  });
});

describe('a store on a folder holding Elements/ alone', () => {
  it('refuses with the cause and writes nothing', async () => {
    const dir = await memoryDirectoryWith([
      { path: 'world.json', data: WORLD },
      { path: 'Elements/character/kira--00000001.json', data: KIRA },
    ]);
    const store = new FsFolderStore({ disableHeartbeat: true });
    await expect(store.open(dir)).rejects.toThrow('This world folder holds Elements/ where the folder format names elements/');
    const names: string[] = [];
    for await (const k of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(k);
    expect(names.sort()).toEqual(['Elements', 'world.json']);
  });
  it('opens a folder holding elements/ as written', async () => {
    const dir = await memoryDirectoryWith([
      { path: 'world.json', data: WORLD },
      { path: 'elements/character/kira--00000001.json', data: KIRA },
    ]);
    const store = new FsFolderStore({ disableHeartbeat: true });
    await store.open(dir);
    expect((await store.listElements()).map(x => x.name)).toEqual(['Kira']);
    await store.close();
  });
});

describe('Open a world folder', () => {
  it('refuses World.json alone with its cause, before it reads anything', async () => {
    const dir = await memoryDirectoryWith([{ path: 'World.json', data: WORLD }]);
    await expect(openWorldFolder(dir)).rejects.toThrow('This world folder holds World.json where the folder format names world.json');
  });
});
