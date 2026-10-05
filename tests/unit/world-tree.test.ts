/**
 * The world-tree kernel (1.17 bout 4, contract §4.1, §9 invariants 4 and 6;
 * S370 gate lens A A1, A13, lens B B3): the one skip predicate, the copy that
 * writes its token first and world.json last, the verify that needs equal
 * path sets, and the names a folder on a drive cannot hold.
 */
import { describe, expect, it } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import {
  isTransientPath, walkWorld, copyWorldTree, verifyWorldTree, unportableName, MOVE_INCOMING_FILE,
} from '../../src/store/world-tree';

function world(): FakeDirHandle {
  const d = new FakeDirHandle('src');
  d.put('world.json', '{"id":"w-1","name":"Hollow Reach"}');
  d.put('.atlas/sync-state.json', '{"paused":false}');
  d.put('.atlas/charts.json', '[]');
  d.put('.atlas/lock', '{"tab_id":"t"}');
  d.put('.atlas/making', 'x');
  d.put('.atlas/move.json', '{"move_id":"old"}');
  d.put('.atlas/move-incoming.json', '{"move_id":"older"}');
  d.put('.atlas/rekey-journal.json', '{}');
  d.put('elements/character/ana--0192a000.json', '{"id":"0192a000","name":"Ana"}');
  d.put('elements/character/ana--0192a000.json.crswap', 'half');
  d.put('elements/location/old.json.tmp', 'stale');
  d.put('media/map.png', 'PNGBYTES');
  // Sorts after world.json, so "world.json last" is a property of the copy, not of the alphabet.
  d.put('zz-notes.md', 'notes');
  return d;
}
const as = (d: FakeDirHandle) => d as unknown as FileSystemDirectoryHandle;

describe('isTransientPath', () => {
  it('skips the lock, the make marker, every move file, the re-key journal, swap and tmp files', () => {
    for (const p of ['.atlas/lock', '.atlas/making', '.atlas/move.json', '.atlas/move-incoming.json', '.atlas/move-anything.json',
      '.atlas/rekey-journal.json', 'elements/character/a.json.crswap', 'elements/x/y.json.tmp']) {
      expect(isTransientPath(p), p).toBe(true);
    }
  });
  it('keeps everything that is the world', () => {
    for (const p of ['world.json', '.atlas/sync-state.json', '.atlas/tombstones.json', '.atlas/charts.json',
      '.atlas/world-prefs.json', 'elements/character/a.json', 'media/move.json', 'elements/narrative/lock']) {
      expect(isTransientPath(p), p).toBe(false);
    }
  });
});

describe('walkWorld', () => {
  it('lists files only, sorted by path, transient ones left out', async () => {
    const paths = (await walkWorld(as(world()))).map(f => f.path);
    expect(paths).toEqual([
      '.atlas/charts.json', '.atlas/sync-state.json',
      'elements/character/ana--0192a000.json', 'media/map.png', 'world.json', 'zz-notes.md',
    ]);
  });
});

describe('copyWorldTree', () => {
  it('writes the move token first and world.json last, every byte as it was', async () => {
    const src = world();
    const dst = new FakeDirHandle('dst');
    const created: string[] = [];
    const getFileHandle = FakeDirHandle.prototype.getFileHandle;
    const spy = function (this: FakeDirHandle, name: string, opts?: { create?: boolean }) {
      if (opts?.create) created.push(name);
      return getFileHandle.call(this, name, opts);
    };
    FakeDirHandle.prototype.getFileHandle = spy;
    try {
      await copyWorldTree(as(src), as(dst), { moveId: 'm-1' });
    } finally {
      FakeDirHandle.prototype.getFileHandle = getFileHandle;
    }
    expect(created[0]).toBe(MOVE_INCOMING_FILE);
    expect(created[created.length - 1]).toBe('world.json');
    expect(JSON.parse(dst.get(`.atlas/${MOVE_INCOMING_FILE}`)!)).toMatchObject({ move_id: 'm-1' });
    expect(dst.get('world.json')).toBe(src.get('world.json'));
    expect(dst.get('media/map.png')).toBe('PNGBYTES');
    expect(dst.get('elements/character/ana--0192a000.json')).toBe(src.get('elements/character/ana--0192a000.json'));
    // Nothing transient travels: the source's own move files, lock and marker stay behind.
    for (const p of ['.atlas/lock', '.atlas/making', '.atlas/move.json', '.atlas/rekey-journal.json']) expect(dst.get(p), p).toBeNull();
    expect(dst.list().filter(p => p.endsWith('.crswap') || p.endsWith('.tmp'))).toEqual([]);
  });

  it('reports progress per file', async () => {
    const seen: Array<[number, number]> = [];
    await copyWorldTree(as(world()), as(new FakeDirHandle('dst')), { moveId: 'm', onProgress: (d, t) => seen.push([d, t]) });
    expect(seen[seen.length - 1]).toEqual([6, 6]);
  });

  it('refuses names a folder on a drive cannot hold, before the first write', async () => {
    const src = world();
    src.put('elements/character/Ana.json', '{"id":"a"}');
    src.put('elements/character/ana.json', '{"id":"b"}');
    const dst = new FakeDirHandle('dst');
    await expect(copyWorldTree(as(src), as(dst), { moveId: 'm' })).rejects.toThrow(/Ana\.json.*ana\.json|ana\.json.*Ana\.json/);
    expect(dst.list()).toEqual([]);
  });
});

describe('unportableName', () => {
  it('names a case-only pair and a Windows-illegal name, and passes ordinary ones', () => {
    expect(unportableName(['a/B.json', 'a/b.json'])).toMatchObject({ kind: 'case' });
    expect(unportableName(['a/B.json', 'c/b.json'])).toBeNull();
    for (const bad of ['a/what?.json', 'a/x:y.json', 'a/q".json', 'a/<b>.json', 'a/pipe|.json', 'a/star*.json', 'a/dot.', 'a/space ', 'a/ctl\u0001.json']) {
      expect(unportableName([bad]), JSON.stringify(bad)).toMatchObject({ kind: 'illegal' });
    }
    expect(unportableName(['elements/character/ana--0192a000.json', 'media/Map 1.png'])).toBeNull();
  });
});

describe('verifyWorldTree', () => {
  it('passes a faithful copy', async () => {
    const src = world();
    const dst = new FakeDirHandle('dst');
    await copyWorldTree(as(src), as(dst), { moveId: 'm' });
    await expect(verifyWorldTree(as(src), as(dst))).resolves.toEqual({ ok: true });
  });
  it('fails on a missing file, an extra file, a changed JSON byte, or a media size', async () => {
    const cases: Array<(d: FakeDirHandle) => void> = [
      d => d.put('media/extra.png', 'x'),
      d => { (d.children.get('media') as FakeDirHandle).children.delete('map.png'); },
      d => d.put('world.json', '{"id":"w-1","name":"Hollow Reacx"}'),
      d => d.put('media/map.png', 'PNGBYTE'),
    ];
    for (const change of cases) {
      const src = world();
      const dst = new FakeDirHandle('dst');
      await copyWorldTree(as(src), as(dst), { moveId: 'm' });
      change(dst);
      expect((await verifyWorldTree(as(src), as(dst))).ok).toBe(false);
    }
  });
});
