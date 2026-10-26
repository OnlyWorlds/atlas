/**
 * A rebuild gate (conv. 146). A surface that rebuilds its clickable
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

/**
 * True while someone is typing in a text field inside `root`. A surface whose
 * markup carries saved values rebuilds when a save lands, and a rebuild then
 * replaces the field being typed in: its text and its focus go (the units race:
 * a unit's save landed while the next unit was being typed). Such a
 * surface waits while this is true and catches up when focus leaves.
 */
export function typingInside(root: Element): boolean {
  const el = document.activeElement;
  if (!el || !root.contains(el)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * Draw a surface that rebuilds its own search field, keeping the field's focus
 * and caret when it had them (a data tick that landed mid-typing left
 * the writing and map searches unfocused, and the next keys went to the page).
 * For a field whose results should follow every tick; a form whose saved
 * values are in its markup waits instead (`typingInside`).
 */
export function keepingFocus(root: Element, selector: string, draw: () => void): void {
  const before = root.querySelector<HTMLInputElement>(selector);
  const had = !!before && document.activeElement === before;
  const start = had ? before!.selectionStart : null;
  const end = had ? before!.selectionEnd : null;
  draw();
  if (!had) return;
  const fresh = root.querySelector<HTMLInputElement>(selector);
  if (!fresh || document.activeElement === fresh) return;
  fresh.focus();
  if (start !== null) fresh.setSelectionRange(start, end ?? start);
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
