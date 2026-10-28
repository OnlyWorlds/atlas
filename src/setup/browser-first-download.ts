/**
 * A browser world's first download, the demo's way (#126, 1.25.1): the world
 * comes down into a directory in memory through the same store and the same
 * download, then every file it wrote lands in the make's directory once,
 * `world.json` last (`writeAll`).
 *
 * Written straight into browser storage, each element cost a lookup, an
 * atomic write and a read-back, one at a time: 13 to 17 s for Moppetopia's
 * 310 in Chromium and 80 s in Firefox, where each file of browser storage
 * costs tens of milliseconds whatever the API. In memory the download takes
 * as long as keel's reads; the landing is one write per file, eight at once.
 *
 * The landed tree is the one the old path left (the files are copied
 * verbatim, `.atlas/` sync state and `world.json`'s link included: this is the
 * world itself, not a portable copy), so the store opened on it afterwards
 * reads the same world. A cancel in either phase throws
 * `DownloadCancelledError` and the door removes the make; a finish asked
 * during the landing changes nothing, since everything has downloaded.
 */
import type { BrowserMake } from '../core/browser-home';
import type { WorldMeta } from '../core/types';
import type { OwApiClient } from '../sync/sync-engine';
import {
  initialDownloadAll, seedLinkedWorldMeta,
  type DownloadStop, type InitialDownloadProgress, type InitialDownloadResult,
} from '../sync/initial-download';
import { FsFolderStore } from '../store/folder-store-fs';
import { memoryDirectory } from '../store/memory-dir';
import { walkWorld } from '../store/world-tree';
import { writeAll } from './world-file-open';

export interface FirstDownloadOpts {
  onProgress?: (p: InitialDownloadProgress) => void;
  shouldStop?: () => DownloadStop;
}

/** Download the world into memory, then land its files in `make.handle`. The caller opens its store on it after. */
export async function downloadIntoMake(
  make: Pick<BrowserMake, 'handle'>,
  meta: Partial<WorldMeta>,
  adapter: OwApiClient,
  opts: FirstDownloadOpts = {},
): Promise<InitialDownloadResult> {
  const dir = memoryDirectory('first-download');
  const scratch = new FsFolderStore();
  let result: InitialDownloadResult;
  try {
    await scratch.open(dir);
    await scratch.writeWorldMeta(meta);
    result = await initialDownloadAll(scratch, adapter, opts.onProgress, opts.shouldStop, { stopOnQuota: true });
    await seedLinkedWorldMeta(scratch, adapter); // its settings and own words come down with it
  } finally {
    // Its heartbeat would otherwise hold the whole scratch alive.
    await scratch.close().catch(() => {});
  }
  const files = await Promise.all((await walkWorld(dir)).map(async f => ({
    path: f.path,
    data: new Uint8Array(await (await f.handle.getFile()).arrayBuffer()),
  })));
  const worldJson = files.find(f => f.path === 'world.json')?.data;
  if (!worldJson) throw new Error('first download: the world in memory has no world.json');
  await writeAll(
    make.handle, files, worldJson,
    (done, total) => opts.onProgress?.({ done, total, phase: 'land' }),
    () => opts.shouldStop?.() === 'cancel',
  );
  return result;
}
