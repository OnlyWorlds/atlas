/**
 * The first download (`setup/browser-first-download.ts`) for suites that play
 * the store with `MockFolderStore`, which keeps no files: the download runs
 * the real loop into a mock store, and `landAndOpen` hands that store's state
 * to the door's own mock store, opened on the make's handle as in production.
 * The landing itself (files behind an open world, a stop, a failure, the
 * turn to disk) is the unit suites' (`tests/unit/land-behind.test.ts`,
 * `tests/unit/browser-first-download.test.ts`); here it has already landed.
 */
import { initialDownloadAll, seedLinkedWorldMeta, type InitialDownloadResult } from '../../src/sync/initial-download';
import type { FirstDownloadOpts } from '../../src/setup/browser-first-download';
import type { BrowserMake } from '../../src/core/browser-home';
import type { WorldMeta } from '../../src/core/types';
import type { OwApiClient } from '../../src/sync/sync-engine';
import type { Landing } from '../../src/store/land-behind';
import { MockFolderStore } from './mock-folder-store';

export async function downloadIntoMemory(
  meta: Partial<WorldMeta>,
  adapter: OwApiClient,
  opts: FirstDownloadOpts = {},
): Promise<{ dir: FileSystemDirectoryHandle; result: InitialDownloadResult }> {
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
  opts.onProgress?.({ done: 0, total: 0, phase: 'open' });
  return { dir: { scratch } as unknown as FileSystemDirectoryHandle, result };
}

export async function landAndOpen(make: Pick<BrowserMake, 'dir' | 'handle'>, mem: FileSystemDirectoryHandle, store: { open(h: unknown): Promise<void> }): Promise<Landing> {
  MockFolderStore.landed.set(make.handle, (mem as unknown as { scratch: MockFolderStore }).scratch);
  await store.open(make.handle);
  return {
    root: make.handle, landed: Promise.resolve(), stop() {}, progress: { done: 1, total: 1 },
    onProgress: () => () => {}, pendingEdits: 0, state: 'landed', dir: make.dir, error: null,
  };
}

export async function abandonLanding(): Promise<void> {}
