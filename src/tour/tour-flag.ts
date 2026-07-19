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
