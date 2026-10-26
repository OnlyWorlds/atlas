/**
 * Initial download helper — used by the Link-Existing-API flow.
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
import { PlainError } from '../core/plain-error';
import {
  META_SYNC_FIELD_NAMES,
  canonicalExtValue,
  isMetaEmpty,
  isWorldExtensionKey,
  pickExtensionBaseline,
  pickSyncedMeta,
} from './world-meta-sync';

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
  /**
   * Set when the user stopped early and kept what had arrived. The
   * folder is a valid, partial world; the first pull (a cold /changes replay
   * from the epoch) brings the rest.
   */
  stoppedEarly?: { total: number };
}

/**
 * The user's answer mid-download: `finish` keeps what has arrived and
 * registers the world; `cancel` abandons the link (the caller removes the
 * folder it created). Polled between elements and between type listings.
 */
export type DownloadStop = 'finish' | 'cancel' | null;

/** Thrown when the user cancels the download; nothing downloaded is kept. */
export class DownloadCancelledError extends PlainError {
  constructor() {
    super('Link cancelled');
    this.name = 'DownloadCancelledError';
  }
}

/**
 * A linked world's settings, brought down with its elements.
 * Before this, a world linked from onlyworlds.com took its settings (the now,
 * the units, its own words) only at its first sync round, which a world that
 * pulls only when asked might not run for a while: so it opened with the
 * standard's words and no now. This is the meta step's seed round on a fresh
 * folder: every setting the server holds, its x_ keys and its origin written
 * as served, and both baselines taken, so the next round has nothing to send.
 * A failed read leaves the seed to that first round, as before.
 */
export async function seedLinkedWorldMeta(folder: FolderStore, adapter: OwApiClient): Promise<void> {
  let meta;
  try {
    meta = await adapter.getWorldMeta();
  } catch (err) {
    console.warn('[atlas:link] world settings not read at download; the first sync round brings them', err);
    return;
  }
  // A disk failure here never costs the download: the first
  // round seeds again over whatever landed, equal values included.
  try {
    const rec = meta as unknown as Record<string, unknown>;
    const synced = pickSyncedMeta(rec);
    const fill: Record<string, unknown> = {};
    for (const f of META_SYNC_FIELD_NAMES) if (!isMetaEmpty(f, synced[f])) fill[f] = synced[f];
    for (const [k, v] of Object.entries(rec)) if (isWorldExtensionKey(k) && canonicalExtValue(v) !== null) fill[k] = v;
    if (rec.origin && typeof rec.origin === 'object' && !Array.isArray(rec.origin)) fill.origin = rec.origin;
    await folder.writeWorldMeta(fill, { fromSync: true });
    await folder.updateSyncState(() => ({
      meta_baseline: synced,
      meta_ext_baseline: pickExtensionBaseline(rec),
      meta_server_updated_at: meta.updated_at || null,
    }));
  } catch (err) {
    console.warn('[atlas:link] world settings not written at download; the first sync round brings them', err);
  }
}

export async function initialDownloadAll(
  folder: FolderStore,
  adapter: OwApiClient,
  onProgress?: (p: InitialDownloadProgress) => void,
  shouldStop: () => DownloadStop = () => null,
  /**
   * Into browser storage a full origin is fatal (contract §2.2):
   * rethrow the first `QuotaExceededError` instead of recording it and
   * writing on over 0-byte files.
   */
  opts: { stopOnQuota?: boolean } = {},
): Promise<InitialDownloadResult> {
  // ---- List phase: gather all records per type so we know the total ----
  // Type walks run concurrently in a bounded pool (2026-07-19):
  // the 22 per-type list walks are independent requests, and most types are
  // tiny or empty — serializing them made list-phase wall-time the SUM of 22
  // round-trips. Pool of 6 keeps server load polite; results land keyed by
  // type so ordering is unaffected. Any single failure still aborts the
  // whole download (caller surfaces + user retries), matching the old
  // behavior.
  const recordsByType = new Map<ElementType, Array<{ id: string; updated_at: string } & Record<string, unknown>>>();
  let total = 0;
  const LIST_CONCURRENCY = 6;
  let nextType = 0;
  const listWorker = async () => {
    while (nextType < ALL_ELEMENT_TYPES.length) {
      // A stop during listing ends the listing; `finish` still writes every
      // type already listed below.
      if (shouldStop()) return;
      const type = ALL_ELEMENT_TYPES[nextType++];
      onProgress?.({ done: 0, total: 0, currentType: type, phase: 'list' });
      const records = await adapter.listElements(type);
      recordsByType.set(type, records);
      total += records.length;
    }
  };
  await Promise.all(Array.from({ length: LIST_CONCURRENCY }, listWorker));
  if (shouldStop() === 'cancel') throw new DownloadCancelledError();
  // Restore the canonical type order for the write phase (Map iteration
  // order follows insertion, which is now completion order).
  const orderedTypes = ALL_ELEMENT_TYPES.filter(t => recordsByType.has(t));

  // ---- Write phase: per-element resilience ----
  let done = 0;
  const failures: PerElementFailure[] = [];

  let stoppedEarly = nextType < ALL_ELEMENT_TYPES.length;
  outer: for (const type of orderedTypes) {
    const records = recordsByType.get(type)!;
    for (const record of records) {
      const stop = shouldStop();
      if (stop === 'cancel') throw new DownloadCancelledError();
      if (stop === 'finish') { stoppedEarly = true; break outer; }
      try {
        // `applyServerRecord` stamps both local + server timestamps to the
        // server's `updated_at` so the engine considers this element "synced"
        // immediately (no spurious re-push on first syncNow).
        const { updated_at: _ignored, ...body } = record;
        await folder.applyServerRecord(type, body, record.updated_at);
      } catch (err) {
        if (opts.stopOnQuota && (err as { name?: unknown } | null)?.name === 'QuotaExceededError') throw err;
        failures.push({
          element_id: record.id,
          type,
          operation: 'create',
          message: err instanceof Error ? err.message : String(err), // raw-error-ok: the failure record; Details print its fields, never this
          // The name lets a browser-storage link treat a full origin as fatal.
          ...(typeof (err as { name?: unknown })?.name === 'string' ? { error_name: (err as { name: string }).name } : {}),
        });
      } finally {
        done++;
        onProgress?.({ done, total, currentType: type, phase: 'write' });
      }
    }
  }

  return {
    totalDownloaded: done - failures.length,
    failures,
    ...(stoppedEarly ? { stoppedEarly: { total } } : {}),
  };
}
