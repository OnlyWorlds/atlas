/**
 * A browser world's first download (#126, #865): the world comes down into a
 * directory in memory through the same store and the same download, then
 * opens on that memory at once while its files land in the make's directory
 * behind it (`store/land-behind.ts`).
 *
 * Written straight into browser storage, each element cost a lookup, an
 * atomic write and a read-back, one at a time: 13 to 17 s for Moppetopia's
 * 310 in Chromium and 80 s in Firefox. Landed once from memory (1.98.1) it
 * was 4 s in Chromium and still ~40 s in Firefox, whose browser storage costs
 * tens of milliseconds for every file written however they are written, and
 * almost nothing to read back. So the world no longer waits for its files.
 *
 * The landed tree is the one the old path left (the files are copied
 * verbatim, `.atlas/` sync state and `world.json`'s link included). A cancel
 * during the download throws `DownloadCancelledError` and the door removes
 * the make; once the door says `open` nothing cancels. Any failure up to the
 * door's commit is `abandonLanding` and then the door's own cleanup; after
 * it, a failed landing is `onLandingFailed`'s (contract L9').
 */
import type { BrowserMake } from '../core/browser-home';
import type { WorldMeta } from '../core/types';
import type { OwApiClient } from '../sync/sync-engine';
import {
  initialDownloadAll, seedLinkedWorldMeta, DownloadCancelledError,
  type DownloadStop, type InitialDownloadProgress, type InitialDownloadResult,
} from '../sync/initial-download';
import { FsFolderStore } from '../store/folder-store-fs';
import { memoryDirectory } from '../store/memory-dir';
import { forgetLanding, startLanding, type Landing } from '../store/land-behind';

export interface FirstDownloadOpts {
  onProgress?: (p: InitialDownloadProgress) => void;
  shouldStop?: () => DownloadStop;
}

/** Download the world into a directory in memory; nothing touches browser storage. */
export async function downloadIntoMemory(
  meta: Partial<WorldMeta>,
  adapter: OwApiClient,
  opts: FirstDownloadOpts = {},
): Promise<{ dir: FileSystemDirectoryHandle; result: InitialDownloadResult }> {
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
  // The last moment a cancel can undo the door (gate G9): after this it says `open`.
  if (opts.shouldStop?.() === 'cancel') throw new DownloadCancelledError();
  opts.onProgress?.({ done: 0, total: 0, phase: 'open' });
  return { dir, result };
}

/** Start the landing of `mem` into the make's directory and open `store` on it. */
export async function landAndOpen(make: Pick<BrowserMake, 'dir' | 'handle'>, mem: FileSystemDirectoryHandle, store: FsFolderStore): Promise<Landing> {
  const landing = await startLanding(make.dir, mem, make.handle);
  try {
    await store.open(landing.root);
  } catch (err) {
    await abandonLanding(landing);
    throw err;
  }
  return landing;
}

/** Before the door's commit: stop the landing and wait until no write of it runs (contract G6). The door then closes and removes as it always did. */
export async function abandonLanding(landing: Landing | null | undefined): Promise<void> {
  if (!landing) return;
  landing.stop();
  await landing.landed.catch(() => {});
  forgetLanding(landing.dir);
}
