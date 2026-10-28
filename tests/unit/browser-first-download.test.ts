/**
 * A browser world's first download into memory, then landed once
 * (`setup/browser-first-download.ts`): the landed tree is the one the old
 * path (the download straight into the world's own directory) leaves, and a
 * cancel in the landing leaves no world.json. Seeded from the contract
 * gate's probe: name and id-tail collisions, a case twin, a stub, a map and a pin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { memoryDirectory } from '../../src/store/memory-dir';
import { initialDownloadAll, seedLinkedWorldMeta, DownloadCancelledError, type DownloadStop, type InitialDownloadProgress } from '../../src/sync/initial-download';
import { downloadIntoMake } from '../../src/setup/browser-first-download';
import type { OwApiClient } from '../../src/sync/sync-engine';

const T = '2026-10-01T00:00:00.000Z';
const recs: Record<string, Record<string, unknown>[]> = {
  character: [
    { id: '0192a000-0000-7000-8000-000000000001', name: 'Alice', updated_at: T, description: 'one' },
    { id: '0192a000-0000-7000-8000-000000000002', name: 'Alice', updated_at: T, description: 'two' },
    { id: '0192a000-0000-7000-8000-000000000003', name: '!!!', updated_at: T },
    { id: '0192a000-0000-7000-8000-aaaa00000009', name: 'Twin', updated_at: T },
    { id: '0192a000-0000-7000-8000-bbbb00000009', name: 'TWIN', updated_at: T },
    { id: '0192a000-0000-7000-8000-000000000004', name: 'Stubbed', updated_at: T, known_of: true, description: null },
  ],
  location: [{ id: '0192a000-0000-7000-8000-000000000005', name: 'Keep', updated_at: T }],
  map: [{ id: '0192a000-0000-7000-8000-000000000006', name: 'Atlas', updated_at: T, width: 100, height: 100 }],
  pin: [{ id: '0192a000-0000-7000-8000-000000000007', name: 'P', updated_at: T, map_id: '0192a000-0000-7000-8000-000000000006', element_id: '0192a000-0000-7000-8000-000000000005', x: 1, y: 2 }],
};
const adapter = {
  listElements: async (t: string) => (recs[t] ?? []).map(r => ({ ...r })),
  getWorldMeta: async () => ({ id: 'w', name: 'W', time_current: 5, x_names: { version: 1 }, updated_at: T, origin: { source: null, producer: null } }),
} as unknown as OwApiClient;
const meta = { id: 'w', name: 'W', producer: { name: 'atlas' }, api: { world_id: 'w', api_key: 'k', read_only: true } } as never;

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };
async function tree(dir: FileSystemDirectoryHandle): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const walk = async (d: FileSystemDirectoryHandle, p: string): Promise<void> => {
    for await (const [n, h] of (d as unknown as Entries).entries()) {
      const path = p ? `${p}/${n}` : n;
      if (h.kind === 'directory') { out.set(`${path}/`, ''); await walk(h as FileSystemDirectoryHandle, path); }
      else out.set(path, await (await (h as FileSystemFileHandle).getFile()).text());
    }
  };
  await walk(dir, '');
  return out;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T00:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); });

describe('downloadIntoMake', () => {
  it('lands the tree the old path leaves, and the store opens on it to the same world', async () => {
    const old = memoryDirectory('old');
    const so = new FsFolderStore();
    await so.open(old);
    await so.writeWorldMeta(meta);
    const ro = await initialDownloadAll(so, adapter, undefined, undefined, { stopOnQuota: true });
    await seedLinkedWorldMeta(so, adapter);
    const listOld = (await so.listElements()).sort((x, y) => (x.id < y.id ? -1 : 1));
    await so.close();

    const landed = memoryDirectory('landed');
    const progress: InitialDownloadProgress[] = [];
    const rn = await downloadIntoMake({ handle: landed }, meta, adapter, { onProgress: p => progress.push(p) });
    const sn = new FsFolderStore();
    await sn.open(landed);
    const listNew = (await sn.listElements()).sort((x, y) => (x.id < y.id ? -1 : 1)); // key order may differ: a cold read against the writer's cache (gate N6)
    await sn.close();

    expect(rn).toEqual(ro);
    expect(listNew).toEqual(listOld);
    const [a, b] = [await tree(old), await tree(landed)];
    const diffs = [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));
    expect(diffs).toEqual([]);
    const land = progress.filter(p => p.phase === 'land');
    expect(land.length).toBeGreaterThan(1);
    expect(land[land.length - 1].done).toBe(land[land.length - 1].total);
  });

  it('a cancel in the landing throws DownloadCancelledError and writes no world.json', async () => {
    const landed = memoryDirectory('cancelled');
    let stop: DownloadStop = null;
    const run = downloadIntoMake({ handle: landed }, meta, adapter, {
      onProgress: p => { if (p.phase === 'land' && p.done >= 2) stop = 'cancel'; },
      shouldStop: () => stop,
    });
    await expect(run).rejects.toBeInstanceOf(DownloadCancelledError);
    expect((await tree(landed)).has('world.json')).toBe(false);
  });

  it('a finish asked in the landing lands the whole world, nothing stopped early', async () => {
    const landed = memoryDirectory('finished');
    let stop: DownloadStop = null;
    const r = await downloadIntoMake({ handle: landed }, meta, adapter, {
      onProgress: p => { if (p.phase === 'land') stop = 'finish'; },
      shouldStop: () => stop,
    });
    expect(r.stoppedEarly).toBeUndefined();
    expect(r.totalDownloaded).toBe(9);
    expect((await tree(landed)).has('world.json')).toBe(true);
  });
});
