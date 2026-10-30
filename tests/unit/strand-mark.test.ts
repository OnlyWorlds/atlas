/**
 * The strand mark's plumbing (`src/core/strand-mark.ts`) and the store's meta write computed inside the
 * write (`writeWorldMetaWith`), which every strand write goes through so a second tab's or a mirror's
 * older mark is never written back.
 */
import { describe, it, expect } from 'vitest';
import { remapStrandMark } from '../../src/core/strand-mark';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';

const map = new Map([['a', 'A'], ['b', 'B'], ['c', 'C']]);

describe('remapStrandMark', () => {
  it('moves each member named in the map, and only those', () => {
    expect(remapStrandMark({ narrative: 'a', event: 'b', location: 'z' }, map))
      .toEqual({ value: { narrative: 'A', event: 'B', location: 'z' }, changed: true });
  });

  it('keeps a half mark half: null and absent members stay so', () => {
    expect(remapStrandMark({ narrative: 'a', event: null }, map))
      .toEqual({ value: { narrative: 'A', event: null }, changed: true });
  });

  it('leaves every other shape untouched and says so', () => {
    for (const v of ['a', ['a'], null, undefined, 3, { narrative: 7 }, { story: 'a' }]) {
      const r = remapStrandMark(v, map);
      expect(r.changed).toBe(false);
      expect(r.value).toBe(v);
    }
  });

  it('an empty map changes nothing', () => {
    const v = { narrative: 'a' };
    expect(remapStrandMark(v, new Map())).toEqual({ value: v, changed: false });
  });
});

describe('writeWorldMetaWith', () => {
  async function open(): Promise<MockFolderStore> {
    const s = new MockFolderStore();
    await s.open(null);
    await s.writeWorldMeta({ id: 'w', name: 'W' });
    return s;
  }

  it('hands the mutation world.json as it is now and writes its answer', async () => {
    const s = await open();
    await s.writeWorldMeta({ description: 'written meanwhile' });
    const seen: string[] = [];
    const out = await s.writeWorldMetaWith(cur => { seen.push(cur.description ?? ''); return { version: '2' }; });
    expect(seen).toEqual(['written meanwhile']);
    expect(out).toMatchObject({ description: 'written meanwhile', version: '2' });
  });

  it('null writes nothing and answers null', async () => {
    const s = await open();
    const before = await s.readWorldMeta();
    expect(await s.writeWorldMetaWith(() => null)).toBeNull();
    expect(await s.readWorldMeta()).toEqual(before);
  });

  it('is refused on a view-only world', async () => {
    const s = await open();
    s.setViewOnly(true);
    await expect(s.writeWorldMetaWith(() => ({ version: '2' }))).rejects.toThrow(/view-only/);
  });
});

describe('writeWorldMetaWith on the real store', () => {
  async function openFs(): Promise<{ s: FsFolderStore; root: FakeDirHandle }> {
    const root = new FakeDirHandle('w');
    root.put('world.json', JSON.stringify({ id: 'w1', name: 'W', x_strand: { narrative: 'n1' } }, null, 2) + '\n');
    const s = new FsFolderStore({ clock: () => '2026-02-01T00:00:00.000Z', tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
    await s.open(root as unknown as FileSystemDirectoryHandle);
    return { s, root };
  }

  it('reads the file as the write starts, behind a write already queued, and keeps every other key', async () => {
    const { s, root } = await openFs();
    const first = s.writeWorldMeta({ x_strand: { narrative: 'n2' } } as never);
    const seen: unknown[] = [];
    const second = s.writeWorldMetaWith(cur => {
      seen.push((cur as unknown as Record<string, unknown>).x_strand);
      return { x_strand: { narrative: 'n2', event: 'e1', location: null } } as never;
    });
    await Promise.all([first, second]);
    expect(seen).toEqual([{ narrative: 'n2' }]);
    expect(JSON.parse(root.get('world.json')!)).toMatchObject({ id: 'w1', name: 'W', x_strand: { narrative: 'n2', event: 'e1', location: null } });
  });

  it('null leaves the file byte for byte', async () => {
    const { s, root } = await openFs();
    const before = root.get('world.json');
    expect(await s.writeWorldMetaWith(() => null)).toBeNull();
    expect(root.get('world.json')).toBe(before);
  });
});
