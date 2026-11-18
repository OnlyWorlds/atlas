/**
 * A press that opens another page from inside the page it replaces (a link
 * chip on an element's page) takes its own control away: focus falls to the
 * page and a keyboard user starts again from the top. This puts focus on the
 * new page's heading once it has drawn, the way a page load lands a reader at
 * its start.
 *
 * Only while focus is on the page itself: a person who has moved on keeps
 * their place. It watches for a short while, since a route change draws on
 * the hashchange, a lazy room a little later, and a page can draw twice (the
 * selection, then the address): a heading that is replaced while it holds
 * focus hands it to the one that replaced it.
 */

const HEADING = '[data-role="element-name"], h1, h2';
const WAIT_MS = 1500;

/** The heading of the element page that shows `id`, once it has drawn. */
export function elementPageHeading(id: string): () => HTMLElement | null {
  return () => {
    const body = document.querySelector(`.atlas-middle-body[data-element-id="${CSS.escape(id)}"]`);
    return body?.parentElement?.querySelector<HTMLElement>('[data-role="element-name"]') ?? null;
  };
}

/** The arrival being watched: a new press ends the one before (its page is gone). */
let watching = 0;

export function focusArrival(find?: () => HTMLElement | null): void {
  const mine = ++watching;
  const middle = (): Element | null => document.querySelector('.atlas-middle');
  const before = middle()?.querySelector(HEADING) ?? null;
  const findHeading = find ?? ((): HTMLElement | null => {
    const h = middle()?.querySelector<HTMLElement>(HEADING) ?? null;
    return h && h !== before ? h : null;
  });
  // The pressed control may hold focus until its page goes: it counts as the page.
  const pressed = document.activeElement;
  const until = performance.now() + WAIT_MS;
  let placed: HTMLElement | null = null;
  // Where focus was at the last look: focus that falls from a control of the
  // person's own (one they moved to meanwhile) is theirs to lose, not ours to move.
  let last: Element | null = pressed;
  const look = (): void => {
    if (mine !== watching) return;
    const now = document.activeElement;
    const fell = !now || now === document.body || !now.isConnected;
    if (!fell && now !== pressed && now !== placed) return;
    if (fell && last && last !== document.body && last !== pressed && last !== placed) return;
    if (fell || now === pressed) {
      const heading = findHeading();
      if (heading && heading.isConnected) {
        // A heading that is no control takes focus from a script only.
        if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
        heading.focus();
        placed = heading;
      }
    }
    last = document.activeElement;
    if (performance.now() < until) requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
}
