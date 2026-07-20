/**
 * Tour heal kernel — pure array-merge semantics for the resilience pass.
 *
 * THE MERGE RULE (resilience gate, S299): healing a bundle element's array
 * link field must repair the bundle's own weave without ever eating the
 * user's work. Three moves, in order:
 *
 *   1. REMOVE only ids the bundle ITSELF authors for this field that are
 *      currently unrevealed (back-nav shrinks the revealed set; the bundle's
 *      own forward-links retract with it).
 *   2. PRESERVE everything else on disk verbatim, in disk order — including
 *      a user's manual link to a bundle element that happens to be
 *      unrevealed right now (the gate's headline: provenance matters; a
 *      bundle id the bundle does NOT author for this field is user data).
 *   3. APPEND bundle-authored ids that are revealed but missing.
 *
 * Pure and unit-locked; the caller owns reading disk INSIDE the per-id
 * write chain (updateElementWith) so the merge never applies to a stale
 * snapshot.
 */

/**
 * Merge one array link field. `bundleArr` is the bundle's authored value,
 * `diskArr` the value currently on disk (read inside the write chain),
 * `revealed` the ids revealed at the current step.
 *
 * Returns the merged array plus whether it differs from disk.
 */
export function mergeHealArray(
  bundleArr: readonly unknown[],
  diskArr: readonly unknown[],
  revealed: ReadonlySet<string>,
): { merged: unknown[]; changed: boolean } {
  const bundleIds = new Set(bundleArr.filter((v): v is string => typeof v === 'string'));
  // 1 + 2: keep disk order; drop only bundle-authored unrevealed ids.
  const merged = diskArr.filter(v =>
    !(typeof v === 'string' && bundleIds.has(v) && !revealed.has(v)));
  // 3: append revealed bundle ids that are missing (membership-checked —
  // a bundle id already on disk must not duplicate).
  const present = new Set(merged.filter((v): v is string => typeof v === 'string'));
  for (const v of bundleArr) {
    if (typeof v === 'string' && revealed.has(v) && !present.has(v)) {
      merged.push(v);
      present.add(v);
    }
    // Non-string bundle entries are never appended: reference-equality would
    // re-append them every pass (a changed:true churn loop), and bundles
    // author id arrays only.
  }
  const changed = merged.length !== diskArr.length
    || merged.some((v, i) => v !== diskArr[i]);
  return { merged, changed };
}
