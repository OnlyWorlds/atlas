/**
 * Apply an ImportPlan to a FolderStore — the bulk-write half of import (B2).
 *
 * Pure w.r.t. app state: takes a store + plan, returns counts + failures. Models
 * `initialDownloadAll` — sequential, per-element try/catch into a failures list
 * (one bad element never aborts the batch), a progress callback per item.
 *
 * Idempotency guard: a create whose id already exists on disk routes to an
 * update instead (re-running an import, or a kept uuid that already landed,
 * won't duplicate).
 *
 * FK ordering / id-swap is NOT this layer's job — the local folder has no FK
 * constraints, and the SyncEngine owns push ordering (convention #81). Callers
 * refresh state + `requestPushIfLinked()` exactly ONCE after this returns.
 */

import type { FolderStore } from '../store/folder-store';
import type { PerElementFailure } from '../core/types';
import type { ImportPlan, RawRecord } from './types';

export interface ApplyProgress {
  done: number;
  total: number;
  phase: 'create' | 'update';
}

export interface ApplyResult {
  created: number;
  updated: number;
  failures: PerElementFailure[];
}

export interface ApplyOptions {
  onProgress?: (p: ApplyProgress) => void;
}

export async function applyImportPlan(
  store: FolderStore,
  plan: ImportPlan,
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const failures: PerElementFailure[] = [];
  let created = 0;
  let updated = 0;
  const total = plan.creates.length + plan.updates.length;
  let done = 0;

  // Snapshot existing ids once — routes a create-over-existing to update without
  // an O(types) getElement probe per item.
  const existingIds = new Set((await store.listElements()).map(e => e.id));

  for (const c of plan.creates) {
    const id = typeof c.data.id === 'string' ? c.data.id : undefined;
    try {
      if (id && existingIds.has(id)) {
        await store.updateElement(id, stripId(c.data));
        updated++;
      } else {
        await store.createElement(c.type, c.data);
        if (id) existingIds.add(id);
        created++;
      }
    } catch (err) {
      failures.push({ element_id: id ?? '', type: c.type, operation: 'create', message: errMsg(err), ...errName(err) });
    }
    opts.onProgress?.({ done: ++done, total, phase: 'create' });
  }

  for (const u of plan.updates) {
    try {
      await store.updateElement(u.id, u.patch);
      existingIds.add(u.id);
      updated++;
    } catch (err) {
      failures.push({ element_id: u.id, type: u.type, operation: 'update', message: errMsg(err), ...errName(err) });
    }
    opts.onProgress?.({ done: ++done, total, phase: 'update' });
  }

  return { created, updated, failures };
}

function stripId(data: RawRecord): RawRecord {
  const rest: RawRecord = { ...data };
  delete rest.id;
  return rest;
}

/** The error's class name, for the details block (S369): a disk refusal reads the same in every locale. */
function errName(err: unknown): { error_name?: string; source: 'disk' } {
  const name = (err as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== 'Error' ? { error_name: name, source: 'disk' } : { source: 'disk' };
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
