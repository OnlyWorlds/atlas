/**
 * An Escape a small surface used to close itself (a list opened from a chip):
 * marked, never stopped, so every other listener still runs, and the drawer's
 * close and the global deselect-to-home read the mark and step aside.
 */
const owned = new WeakSet<Event>();

export function markEscapeOwned(e: Event): void {
  owned.add(e);
}

export function escapeOwned(e: Event): boolean {
  return owned.has(e);
}
