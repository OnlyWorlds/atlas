/**
 * A rebuild gate (conv. 146, S422). A surface that rebuilds its clickable
 * nodes on every store change or hashchange loses any click whose press and
 * release straddle a rebuild: the click goes to the old and new nodes' common
 * ancestor, or nowhere. The gate lets a render run only when its inputs moved.
 *
 * The inputs are everything the render draws AND everything its handlers
 * capture at render; anything a handler reads at the click may stay out.
 * Parts compare with `Object.is`, so a store slice (replaced whole on every
 * patch) is a part as it is, and a part made fresh per call (an array, an
 * object) defeats the gate: give such a part as a string.
 */
export interface RenderGate {
  /** True when any part differs from the last call's (the render should run); records them. */
  changed(parts: readonly unknown[]): boolean;
  /** Forget the last parts, so the next `changed` is true. */
  reset(): void;
}

export function renderGate(): RenderGate {
  let last: readonly unknown[] | null = null;
  return {
    changed(parts) {
      if (last && last.length === parts.length && parts.every((p, i) => Object.is(p, last![i]))) return false;
      last = parts.slice();
      return true;
    },
    reset() { last = null; },
  };
}
