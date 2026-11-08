import type { Element } from '../core/types';

/**
 * The keys a sync round writes into an element without changing what a person reads or edits
 * there: keel's stamp, the edit stamp moved past it, the last writer's words (dropped by a push
 * that landed) and the door record (`store/sync-stamp.ts`). No press on the element page writes
 * them or decides a write by them: the page shows them as text (the meta lines, the Files card's
 * not-yet-online line, the agent mark's words), and the trail box repaints itself.
 */
const STAMP_KEYS = new Set<string>([
  'server_updated_at',
  'local_updated_at',
  'changed_by',
  'changed_via',
  'changed_client',
  'doors',
]);

/**
 * True when `now` is `drawn` again but for its stamps. The element page holds its redraw for a
 * press only then: every handler on the held picture captured `drawn`, so a press may land there
 * only while `drawn` still says what the element says (a held picture keeps its old handlers).
 */
export function sameButStamps(drawn: Element, now: Element): boolean {
  if (drawn === now) return true;
  if (drawn.id !== now.id) return false;
  const a = drawn as unknown as Record<string, unknown>;
  const b = now as unknown as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (STAMP_KEYS.has(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false;
  }
  return true;
}
