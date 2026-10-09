/**
 * The newcomer's "What do you have?" (#127, the Captain's Q1, h37 #2015:
 * optional, never blocking, subtle and minimal). The empty world home asks it
 * as three quiet rows; a world started from a deep link (`#/start`,
 * `#/bring-in`) was already answered on onlyworlds.com, so its home asks
 * nothing (Skeld, h37 #2008: never ask a visitor twice).
 *
 * In memory, this page session only: the answer matters for the minutes
 * between the link and the first element, and nothing about it persists.
 * Design: `Forge/Notes/2026-10-09-s383-newcomer-flow-design.md`.
 */

const answered = new Set<string>();

export function markNewcomerAnswered(worldId: string): void {
  answered.add(worldId);
}

export function isNewcomerAnswered(worldId: string): boolean {
  return answered.has(worldId);
}
