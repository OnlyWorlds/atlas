/**
 * keel's hidden mark said on the element (keel #537, PR 160; kept as keel's word
 * since 1.70.1, `SERVER_MARK_FIELDS`). keel serves `hidden: true` only to those
 * who can still see a hidden element: the owner, a co-builder and its maker. So
 * the line is for them, and says who else can see it. Only in a synced world: a
 * folder opened as it is, or a world unlinked since, can carry the mark from
 * another time (the agent mark's rule, the S415 gate).
 */
export const HIDDEN_MARK_LINE = 'Hidden on OnlyWorlds: only the owner, co-builders and whoever made it can see it.';

export function hiddenMarkLine(el: unknown, worldState: string | undefined): string | null {
  if (worldState !== 'api-linked') return null;
  if (!el || typeof el !== 'object') return null;
  return (el as Record<string, unknown>).hidden === true ? HIDDEN_MARK_LINE : null;
}
