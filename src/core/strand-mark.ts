/**
 * The strand's mark on the World as stored, `x_strand = {narrative, event, location}` (schema-dist
 * `profiles/strand.md`): the plumbing that moves its ids, never its reading. Whether the mark is a mark,
 * and which slots it fills, is the SDK's `strandOf` alone; this module only carries ids through an id map
 * (a re-key, an import's remap) and leaves every other shape exactly as it found it.
 */

export const STRAND_KEY = 'x_strand';

const MEMBERS = ['narrative', 'event', 'location'] as const;

/**
 * The value with each member that is a string named in `map` replaced by its new id. Any other shape (a
 * bare string, an array, null, a member that is not a string) comes back untouched: a broken mark stays
 * the same broken mark, for the doctor to name.
 */
export function remapStrandMark(value: unknown, map: ReadonlyMap<string, string>): { value: unknown; changed: boolean } {
  if (map.size === 0 || !value || typeof value !== 'object' || Array.isArray(value)) return { value, changed: false };
  const v = value as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...v };
  for (const m of MEMBERS) {
    const id = v[m];
    if (typeof id === 'string' && map.has(id)) {
      next[m] = map.get(id)!;
      changed = true;
    }
  }
  return changed ? { value: next, changed } : { value, changed: false };
}
