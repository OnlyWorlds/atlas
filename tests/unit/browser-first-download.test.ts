/**
 * A browser world's first download into memory, opened there at once and
 * landed behind (`setup/browser-first-download.ts`, #865): the landed tree is
 * the one the old path (the download straight into the world's own directory)
 * leaves, and a cancel undoes the door up to its `open`. Seeded from the
 * 1.98.1 contract gate's probe: name and id-tail collisions, a case twin, a
 * stub, a map and a pin.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { memoryDirectory } from '../../src/store/memory-dir';
import { initialDownloadAll, seedLinkedWorldMeta, DownloadCancelledError, type DownloadStop, type InitialDownloadProgress } from '../../src/sync/initial-download';
import { downloadIntoMemory, landAndOpen } from '../../src/setup/browser-first-download';
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

describe('downloadIntoMemory, then landAndOpen', () => {
  it('the store opens at once on what it downloaded, and what lands is the tree the old path leaves', async () => {
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
    const down = await downloadIntoMemory(meta, adapter, { onProgress: p => progress.push(p) });
    const sn = new FsFolderStore();
    const landing = await landAndOpen({ dir: 'fd-1', handle: landed }, down.dir, sn);
    const listNew = (await sn.listElements()).sort((x, y) => (x.id < y.id ? -1 : 1)); // key order may differ: a cold read against the writer's cache (gate N6)
    await landing.landed;
    await sn.close();

    expect(down.result).toEqual(ro);
    expect(listNew).toEqual(listOld);
    const [a, b] = [await tree(old), await tree(landed)];
    const diffs = [...new Set([...a.keys(), ...b.keys()])].filter(k => a.get(k) !== b.get(k));
    expect(diffs).toEqual([]);
    // The door says `open` once, last: no cancel after it (gate G9).
    expect(progress[progress.length - 1].phase).toBe('open');
    expect(progress.filter(p => p.phase === 'open')).toHaveLength(1);
  });

  it('a cancel during the download throws DownloadCancelledError', async () => {
    let stop: DownloadStop = null;
    const run = downloadIntoMemory(meta, adapter, {
      onProgress: p => { if (p.phase === 'write' && p.done >= 2) stop = 'cancel'; },
      shouldStop: () => stop,
    });
    await expect(run).rejects.toBeInstanceOf(DownloadCancelledError);
  });

  it('a cancel asked after the last element still undoes the door, and says no `open` (gate G9)', async () => {
    let stop: DownloadStop = null;
    const phases: string[] = [];
    const run = downloadIntoMemory(meta, adapter, {
      onProgress: p => { phases.push(p.phase); if (p.phase === 'write' && p.done === p.total) stop = 'cancel'; },
      // Polled during the download too: it answers cancel only once the last element is down.
      shouldStop: () => stop,
    });
    await expect(run).rejects.toBeInstanceOf(DownloadCancelledError);
    expect(phases).not.toContain('open');
  });

  it('a finish asked at the end keeps the whole world, nothing stopped early', async () => {
    let stop: DownloadStop = null;
    const { result } = await downloadIntoMemory(meta, adapter, {
      onProgress: p => { if (p.phase === 'write' && p.done === p.total) stop = 'finish'; },
      shouldStop: () => stop,
    });
    expect(result.stoppedEarly).toBeUndefined();
    expect(result.totalDownloaded).toBe(9);
  });
});
