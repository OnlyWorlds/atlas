/**
 * keel's per-element commit counter (`change_seq`), carried beside a record and
 * never in it: never on disk, never in a body (`adaptV2Record` drops the key),
 * read only to send keel's `If-Match` on Keep this copy for a copy with no
 * record of what OnlyWorlds held (conv. 192, M6). A symbol property that is not
 * enumerable, so no spread, `Object.entries` or `JSON.stringify` ever carries it.
 */
export const CHANGE_SEQ = Symbol.for('atlas.change_seq');

/** Attach keel's counter to a record as it was served. Returns the record. */
export function withChangeSeq<T extends object>(record: T, seq: unknown): T {
  if (typeof seq === 'number' && Number.isInteger(seq)) {
    Object.defineProperty(record, CHANGE_SEQ, { value: seq, enumerable: false, configurable: true, writable: true });
  }
  return record;
}

/** keel's counter as served with this record; null when it came without one. */
export function changeSeqOf(record: unknown): number | null {
  if (!record || typeof record !== 'object') return null;
  const v = (record as Record<symbol, unknown>)[CHANGE_SEQ];
  return typeof v === 'number' ? v : null;
}

/**
 * keel's 412 (`precondition_failed`): the element moved past the counter sent,
 * nothing was written, and the live element rides as `current` (adapted, its
 * counter attached). Read structurally so a fake's error qualifies too.
 */
export function preconditionCurrent(err: unknown): ({ id: string; updated_at: string } & Record<string, unknown>) | null {
  if (!(err instanceof Error)) return null;
  const e = err as Error & { status?: unknown; code?: unknown; current?: unknown };
  if (e.status !== 412) return null;
  const c = e.current;
  if (!c || typeof c !== 'object' || typeof (c as { updated_at?: unknown }).updated_at !== 'string') return null;
  return c as { id: string; updated_at: string } & Record<string, unknown>;
}
