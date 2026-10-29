/**
 * #856: the person asked to bring something in as a world (Other ways in's
 * row, or the site's #/bring-in) while a world was open, so app.ts sent them to
 * that world's Data room. Its next mount reads this once: loose JSON then
 * defaults to a new world instead of a merge into the world they happened to
 * have open. A plain module flag, so the door needs no import room chunk.
 */

let wanted = false;

export function markBringInAsWorld(): void {
  wanted = true;
}

/** Read once, by the Data room's mount. */
export function takeBringInAsWorld(): boolean {
  const was = wanted;
  wanted = false;
  return was;
}
