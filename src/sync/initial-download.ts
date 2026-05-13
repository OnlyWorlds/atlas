/**
 * Initial download helper — used by the Link-Existing-API flow (Bout E).
 *
 * Given a freshly-opened FolderStore and a configured OW client adapter,
 * fetch every element of every type from the server and write them to the
 * folder via `applyServerRecord` (stamps both `local_updated_at` and
 * `server_updated_at` to the server's value, so the engine's first push
 * has nothing to send).
 *
 * Resilient by design:
 *   - Per-list errors (network failure mid-iteration) abort the whole
 *     download with a thrown error. Caller surfaces a clear message; the
 *     user can retry.
 *   - Per-element write errors (filesystem quota, JSON encoding) are
 *     recorded in `failures` and iteration continues. Partial folder state
 *     is acceptable — the brief explicitly tolerates it.
 *
 * Progress callbacks fire after every element so the modal can show a
 * "downloading 47 of 412 elements" indicator.
 */

import type { FolderStore } from '../store/folder-store';
import type { OwApiClient } from './sync-engine';
import type { ElementType, PerElementFailure } from '../core/types';
import { ALL_ELEMENT_TYPES } from '../core/types';

export interface InitialDownloadProgress {
  /** Elements written so far (success OR failure). */
  done: number;
  /** Total elements across all types — known after the listing phase. */
  total: number;
  /** Type currently being processed (set during the write loop). */
  currentType?: ElementType;
  /** Phase of the download: 'list' while gathering counts, 'write' while persisting. */
  phase: 'list' | 'write';
}

export interface InitialDownloadResult {
  totalDownloaded: number;
  failures: PerElementFailure[];
}

export async function initialDownloadAll(
  folder: FolderStore,
  adapter: OwApiClient,
  onProgress?: (p: InitialDownloadProgress) => void
): Promise<InitialDownloadResult> {
  // ---- List phase: gather all records per type so we know the total ----
  const recordsByType = new Map<ElementType, Array<{ id: string; updated_at: string } & Record<string, unknown>>>();
  let total = 0;
  for (const type of ALL_ELEMENT_TYPES) {
    onProgress?.({ done: 0, total: 0, currentType: type, phase: 'list' });
    const records = await adapter.listElements(type);
    recordsByType.set(type, records);
    total += records.length;
  }

  // ---- Write phase: per-element resilience ----
  let done = 0;
  const failures: PerElementFailure[] = [];

  for (const [type, records] of recordsByType) {
    for (const record of records) {
      try {
        // `applyServerRecord` stamps both local + server timestamps to the
        // server's `updated_at` so the engine considers this element "synced"
        // immediately (no spurious re-push on first syncNow).
        const { updated_at: _ignored, ...body } = record;
        await folder.applyServerRecord(type, body, record.updated_at);
      } catch (err) {
        failures.push({
          element_id: record.id,
          type,
          operation: 'create',
          message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        done++;
        onProgress?.({ done, total, currentType: type, phase: 'write' });
      }
    }
  }

  return { totalDownloaded: done - failures.length, failures };
}
