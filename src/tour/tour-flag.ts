/**
 * The tour's presence flag — a pure localStorage read with NO tour-engine
 * import, for chrome that must know "is the tour running" without pulling
 * the tour chunk into its bundle (welcome panel, world home, worlds sidebar).
 */

export function isTourFlagActive(): boolean {
  try {
    const tour = JSON.parse(localStorage.getItem('atlas_tour_v1') ?? 'null') as { active?: boolean } | null;
    return !!tour?.active;
  } catch {
    return false;
  }
}

/**
 * Machinery elements the tour never spotlights (Captain, S316): they exist so
 * a surface works (markers trace the zone; the calendar construct feeds the
 * chart's axis), not as vocabulary being taught. Excluded from the preview
 * stack, the reveal flash, AND hidden from the elements sidebar while
 * touring. They live HERE rather than tour-data so the sidebar's static
 * import stays outside the lazy tour chunk (this module's whole reason to
 * exist); tour-data re-exports them.
 */
export const TOUR_QUIET_TYPES: readonly string[] = ['marker'];
export const TOUR_QUIET_REFS: readonly string[] = ['construct:Hegemony Standard'];

/** `ref` is the tour's "type:Name" shape. */
export function isQuietRef(ref: string): boolean {
  const type = ref.slice(0, ref.indexOf(':'));
  return TOUR_QUIET_TYPES.includes(type) || TOUR_QUIET_REFS.includes(ref);
}
