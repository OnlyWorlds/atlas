/**
 * The first download (`setup/browser-first-download.ts`) for suites that play
 * the store with `MockFolderStore`, which keeps no files: the download runs
 * the real loop into a mock store, and that store's state is what "landed",
 * adopted by the next mock store opened on the same handle (the door's own,
 * opened after the landing as in production). The landing itself (files,
 * `writeAll`, a stop between files) is the unit suite's
 * (`tests/unit/browser-first-download.test.ts`).
 */
import { initialDownloadAll, seedLinkedWorldMeta, type InitialDownloadResult } from '../../src/sync/initial-download';
import type { FirstDownloadOpts } from '../../src/setup/browser-first-download';
import type { BrowserMake } from '../../src/core/browser-home';
import type { WorldMeta } from '../../src/core/types';
import type { OwApiClient } from '../../src/sync/sync-engine';
import { MockFolderStore } from './mock-folder-store';

export async function downloadIntoMake(
  make: Pick<BrowserMake, 'handle'>,
  meta: Partial<WorldMeta>,
  adapter: OwApiClient,
  opts: FirstDownloadOpts = {},
): Promise<InitialDownloadResult> {
  const scratch = new MockFolderStore();
  await scratch.open(null);
  await scratch.writeWorldMeta(meta);
  const result = await initialDownloadAll(scratch, adapter, opts.onProgress, opts.shouldStop, { stopOnQuota: true });
  await seedLinkedWorldMeta(scratch, adapter);
  await scratch.close();
  if (opts.shouldStop?.() === 'cancel') {
    const { DownloadCancelledError } = await import('../../src/sync/initial-download');
    throw new DownloadCancelledError();
  }
  MockFolderStore.landed.set(make.handle, scratch);
  opts.onProgress?.({ done: 1, total: 1, phase: 'land' });
  return result;
}
