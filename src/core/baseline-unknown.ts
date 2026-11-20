/**
 * A copy with no record of what OnlyWorlds held (DESIGN_LAWS conv. 192).
 *
 * A file with no `server_updated_at` whose id keel already holds, with other
 * content, cannot say which side is newer: a backup restored, a folder copied
 * to a second computer, a world file opened again, an outside writer putting
 * back its own earlier bytes. Sync writes keel's stamp as the file's baseline
 * and this mark beside it, in the same write, so the stamp is never read as a
 * known history: every reading of the baseline takes it as one that cannot be
 * read (conv. 190, R3), the copy reads as changed, and the push holds a review
 * row under every policy until the person chooses.
 *
 * Local-only (never sent, `ATLAS_LOCAL_ONLY_FIELDS`). Written only through a
 * stamp's `kept` (`stampedBody`), so every later push stamp drops it; never
 * kept by a pull (`applyServerRecord`), so Keep the OnlyWorlds copy drops it;
 * dropped with the baseline (`clearServerBaseline`).
 */
import type { Element } from './types';

export const BASELINE_UNKNOWN = 'atlas_baseline_unknown';

/** The copy carries keel's stamp with no record of what OnlyWorlds held. */
export function isBaselineUnknown(el: unknown): boolean {
  return !!el && typeof el === 'object' && (el as Record<string, unknown>)[BASELINE_UNKNOWN] === true;
}

/** No baseline that can say which side is newer: none at all, or one marked unknown. */
export function hasNoBaseline(el: Element): boolean {
  return !el.server_updated_at || isBaselineUnknown(el);
}

/** The baseline a comparison may read: none when the copy has no record of what OnlyWorlds held. */
export function readableBaseline(el: Element): string | undefined {
  return isBaselineUnknown(el) ? undefined : el.server_updated_at;
}
