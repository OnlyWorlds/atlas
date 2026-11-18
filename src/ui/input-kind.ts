/**
 * Whether the person's last press came from the keyboard. Code that moves or
 * keeps focus after a redraw does so for a key press only: a mouse click that
 * left focus on a control would keep its hover-only neighbours showing (the
 * focus-within reveals: a picture's hide eye, a zone's trash, a map's delete).
 *
 * Read in capture, so it is settled before any handler of the press runs.
 */

let lastWasKey = false;
let installed = false;

function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('pointerdown', () => { lastWasKey = false; }, true);
  window.addEventListener('keydown', (e) => {
    // A modifier alone (Shift held for a click) is no key press.
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return;
    lastWasKey = true;
  }, true);
}

/** True when the last press was a key. Install early (`watchInputKind`) so the first press is seen. */
export function lastPressWasKey(): boolean {
  install();
  return lastWasKey;
}

export function watchInputKind(): void {
  install();
}
