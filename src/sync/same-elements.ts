import type { Element } from '../core/types';

/**
 * True when a fresh read of the folder holds exactly what the store already holds, element by element
 * and in the same order. A pull that changed nothing on disk then keeps the store's array: a new one
 * would redraw every surface keyed on it (the element list, the element page) under a press in flight,
 * and a click whose press and release straddle that redraw is lost (conv. 146).
 */
export function sameElements(held: readonly Element[], fresh: readonly Element[]): boolean {
  if (held === fresh) return true;
  if (held.length !== fresh.length) return false;
  for (let i = 0; i < held.length; i++) {
    const a = held[i];
    const b = fresh[i];
    if (a === b) continue;
    if (a.id !== b.id || JSON.stringify(a) !== JSON.stringify(b)) return false;
  }
  return true;
}
