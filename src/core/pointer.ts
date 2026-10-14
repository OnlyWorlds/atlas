/**
 * Which hand the copy speaks to (#279). A touch screen has no keys to name,
 * no right-click, no hover and no drop (conv. 141), so copy that names one
 * picks its touch line here. CSS swaps static copy with `(pointer: coarse)`;
 * this is the same query for strings built in code.
 */

/** True when the primary pointer is a finger (phones, most tablets). */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
}

/** The mouse line, or the touch line on a touch screen. */
export function forPointer<T>(mouse: T, touch: T): T {
  return isCoarsePointer() ? touch : mouse;
}
