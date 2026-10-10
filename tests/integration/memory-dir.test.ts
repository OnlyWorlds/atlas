/**
 * #126 (S387): the demo world's scratch folder lives in memory. The same
 * FsFolderStore writes the same files there, and the world file collected
 * from it reads back whole, so the demo copy is the world it was before the
 * move, minus some three hundred OPFS writes.
 */
import { describe, it, expect } from 'vitest';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { memoryDirectory } from '../../src/store/memory-dir';
import { collectWorldFiles, zipWorld, readWorldZip } from '../../src/store/world-file';

const WORLD_ID = '0695db52-5433-7332-8000-db7fe10da375';

describe('the in-memory directory under the real store', () => {
  it('holds a world the store writes, and the world file made from it reads back whole', async () => {
    const dir = memoryDirectory('scratch');
    const store = new FsFolderStore({ tabId: 'tab-a', disableHeartbeat: true });
    await store.open(dir);
    await store.writeWorldMeta({ id: WORLD_ID, name: 'Moppetopia', description: 'A world of moppets.' });
    const fluff = await store.createElement('character', { name: 'Admiral Fluffington' });
    await store.createElement('location', { name: 'Soggia' });
    await store.updateElement(fluff.id, { description: 'Pink felt.' });
    expect((await store.listElements()).map(e => e.name).sort()).toEqual(['Admiral Fluffington', 'Soggia']);
    await store.close();

    const files = await collectWorldFiles(dir);
    const paths = files.map(f => f.path);
    expect(paths).toContain('world.json');
    expect(paths.some(p => /^elements\/character\/admiral-fluffington--[0-9a-f]{8}\.json$/.test(p))).toBe(true);
    // The portable copy: no lock, no sync state.
    expect(paths.some(p => p.includes('lock') || p.includes('sync-state'))).toBe(false);

    const read = readWorldZip(zipWorld(files, 'moppetopia'));
    expect(read.worldId).toBe(WORLD_ID);
    expect(read.worldName).toBe('Moppetopia');
    const charFile = read.files.find(f => f.path.startsWith('elements/character/'))!;
    const body = JSON.parse(new TextDecoder().decode(charFile.data));
    expect(body).toMatchObject({ id: fluff.id, name: 'Admiral Fluffington', description: 'Pink felt.' });
  });

  it('answers a missing entry and a wrong kind the way the browsers do', async () => {
    const dir = memoryDirectory();
    await dir.getDirectoryHandle('elements', { create: true });
    await expect(dir.getFileHandle('nope.json')).rejects.toMatchObject({ name: 'NotFoundError' });
    await expect(dir.getFileHandle('elements')).rejects.toMatchObject({ name: 'TypeMismatchError' });
    await expect(dir.removeEntry('nope')).rejects.toMatchObject({ name: 'NotFoundError' });
    const sub = await dir.getDirectoryHandle('elements');
    await sub.getFileHandle('a.json', { create: true });
    await expect(dir.removeEntry('elements')).rejects.toMatchObject({ name: 'InvalidModificationError' });
    await dir.removeEntry('elements', { recursive: true });
    await expect(dir.getDirectoryHandle('elements')).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('a writable swaps its file in only at close, and abort leaves the old one', async () => {
    const dir = memoryDirectory();
    const fh = await dir.getFileHandle('a.json', { create: true });
    let w = await fh.createWritable();
    await w.write('{"v":1}');
    expect(await (await fh.getFile()).text()).toBe('');
    await w.close();
    expect(await (await fh.getFile()).text()).toBe('{"v":1}');
    w = await fh.createWritable();
    await w.write('{"v":2}');
    await w.abort();
    expect(await (await fh.getFile()).text()).toBe('{"v":1}');
  });
});
