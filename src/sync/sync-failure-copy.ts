/**
 * What to tell the user when elements fail to sync (S360).
 *
 * The old toast said "Check console or test connection in settings" for every
 * failure. For the commonest persistent ones that advice is wrong (the
 * connection test passes) and the real cause sat in the console:
 *   - an element id that already belongs to ANOTHER OnlyWorlds world (a copied
 *     or imported folder, the tour world, a world unlinked and taken online
 *     again). keel answers 409 and a read-back in this world 404s.
 *   - more than 64 KB of extension fields on one element (keel's cap).
 * Both repeat every round until the user acts, so each distinct set is
 * toasted once per session, not on every autosave.
 */
import type { PerElementFailure } from '../core/types';

export type FailureKind = 'foreign_id' | 'too_large' | 'other';

export function classifyFailure(f: PerElementFailure): FailureKind {
  const m = f.message ?? '';
  if (/already exists in another world|could not be read back|a copied world folder needs fresh ids/i.test(m)) return 'foreign_id';
  if (/Extension fields may hold at most/i.test(m)) return 'too_large';
  return 'other';
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One plain sentence per failure kind present, most actionable first. */
export function describeFailures(failures: readonly PerElementFailure[]): string {
  const byKind = new Map<FailureKind, PerElementFailure[]>();
  for (const f of failures) {
    const k = classifyFailure(f);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(f);
  }
  const parts: string[] = [];
  const foreign = byKind.get('foreign_id');
  if (foreign) {
    parts.push(`${plural(foreign.length, 'element', 'elements')} could not upload because ${foreign.length === 1 ? 'its id already belongs' : 'their ids already belong'} to another OnlyWorlds world. This happens with a copied or imported folder, or a world taken online a second time. They stay safe on your disk.`);
  }
  const large = byKind.get('too_large');
  if (large) {
    parts.push(`${plural(large.length, 'element holds', 'elements hold')} more than 64 KB of custom fields, which is more than OnlyWorlds accepts per element. Shorten a custom field to let ${large.length === 1 ? 'it' : 'them'} sync.`);
  }
  const other = byKind.get('other');
  if (other) {
    const first = other[0].message?.replace(/^API Error \d+:\s*/, '').slice(0, 140) || 'unknown error';
    parts.push(`${plural(other.length, 'change', 'changes')} could not sync (${first}).`);
  }
  return parts.join(' ');
}

const shownThisSession = new Set<string>();

/**
 * The toast text for this round's failures, or null when this exact set was
 * already shown this session (a persistent failure retried every autosave).
 */
export function failureToastOnce(failures: readonly PerElementFailure[]): string | null {
  if (failures.length === 0) return null;
  const key = failures.map(f => `${classifyFailure(f)}:${f.element_id}`).sort().join('|');
  if (shownThisSession.has(key)) return null;
  shownThisSession.add(key);
  return describeFailures(failures);
}

/** Test seam. */
export function __resetFailureToasts(): void {
  shownThisSession.clear();
}
