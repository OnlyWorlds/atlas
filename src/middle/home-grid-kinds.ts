/**
 * The plain + square's list (the home that grows): which kind to add.
 *
 *   A popover anchored to the square, laid over the grid (never part of its
 *   height): "a character", "a location", "an event", "a story" and
 *   "Another kind…", a menu named "Add which kind". Arrows move, Enter picks,
 *   Escape or a press outside closes it with the focus on the +, Tab closes
 *   it and moves on from the +, and the focus leaving it any other way
 *   closes it too.
 *
 *   While it is open the host carries `data-grid-open` (as the name box
 *   does), so a resize or a sync redraw waits until it closes; closing tells
 *   the page with `GRID_CLOSED`. A hold never outlives the person's
 *   attention: a press outside or the focus leaving ends it (`watchLeave`),
 *   and the redraw that waited runs only after that press has landed
 *   (`afterPress`), so the press acts on the square it was made on.
 */

import { markEscapeOwned } from '../core/escape-mark';

/** Told (bubbling, on the grid's host) when a name box or the kind list closed: a redraw that waited may run. */
export const GRID_CLOSED = 'atlas:grid-closed';
/** The attribute an open name box or kind list carries: a redraw skips while one is in the page. */
export const GRID_OPEN_ATTR = 'data-grid-open';

export type KindPick = 'character' | 'location' | 'event' | 'narrative' | 'other';

export const KIND_ROWS: readonly { kind: KindPick; word: string }[] = [
  { kind: 'character', word: 'a character' },
  { kind: 'location', word: 'a location' },
  { kind: 'event', word: 'an event' },
  { kind: 'narrative', word: 'a story' },
  { kind: 'other', word: 'Another kind…' },
];

export function gridClosed(from: HTMLElement): void {
  from.dispatchEvent(new CustomEvent(GRID_CLOSED, { bubbles: true }));
}

/** How long a press may be held before what waited on it runs anyway. */
const PRESS_LIMIT_MS = 3000;

/**
 * Run `fn` once the pointer press under way has landed: after its release and the click that
 * follows it (a redraw run inside the press would take the square it was made on), or when the
 * browser takes the pointer, or after a limit.
 */
export function afterPress(fn: () => void): void {
  let done = false;
  const run = (): void => {
    if (done) return;
    done = true;
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', run, true);
    clearTimeout(limit);
    fn();
  };
  // The click follows the release in the same turn: a timer set at the release runs after it.
  const onUp = (): void => { setTimeout(run, 0); };
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', run, true);
  const limit = setTimeout(run, PRESS_LIMIT_MS);
}

/**
 * Watch an open box or list: `leave` runs once a pointer press lands outside it (`inside` says
 * what counts as in), or the focus leaves it while the page keeps the focus (another window
 * taking it is not leaving). Returns the unwatch.
 */
export function watchLeave(el: HTMLElement, inside: (t: Node) => boolean, leave: (how: 'press' | 'blur', target: Node | null) => void): () => void {
  const onDown = (e: Event): void => {
    const t = e.target as Node;
    if (!inside(t)) leave('press', t);
  };
  const onOut = (): void => {
    setTimeout(() => {
      if (!el.isConnected || !document.hasFocus()) return;
      const now = document.activeElement;
      if (now && now !== document.body && inside(now)) return;
      leave('blur', now);
    }, 0);
  };
  document.addEventListener('pointerdown', onDown, true);
  el.addEventListener('focusout', onOut);
  return () => {
    document.removeEventListener('pointerdown', onDown, true);
    el.removeEventListener('focusout', onOut);
  };
}

/**
 * Open the list under the + square `cell` (in the grid's `host`). `pick` runs while the list
 * still holds the grid: a kind that opens a name box takes the hold over before the list goes,
 * so no redraw that waited can take the square the box opens on.
 */
export function openKindList(host: HTMLElement, cell: HTMLElement, pick: (kind: KindPick) => void): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'atlas-home-grid-kinds';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Add which kind');
  menu.setAttribute(GRID_OPEN_ATTR, '');
  const items = KIND_ROWS.map(r => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-home-grid-kind';
    b.setAttribute('role', 'menuitem');
    b.setAttribute('data-kind', r.kind);
    b.tabIndex = -1;
    b.textContent = r.word;
    menu.appendChild(b);
    return b;
  });

  // Anchored under the square and its word, kept inside the grid's width.
  menu.style.top = `${cell.offsetTop + cell.offsetHeight + 4}px`;
  host.appendChild(menu);
  const width = menu.offsetWidth;
  const centre = cell.offsetLeft + cell.offsetWidth / 2;
  const left = Math.max(0, Math.min(centre - width / 2, host.clientWidth - width));
  menu.style.left = `${left}px`;
  cell.setAttribute('aria-expanded', 'true');

  let open = true;
  /** Close the list; `then` says when a redraw that waited may run (now, after the press, or never here). */
  const close = (focusPlus: boolean, then: 'now' | 'after-press' | 'soon'): void => {
    if (!open) return;
    open = false;
    unwatch();
    menu.remove();
    cell.setAttribute('aria-expanded', 'false');
    if (focusPlus) cell.focus({ preventScroll: true });
    if (then === 'now') gridClosed(host);
    else if (then === 'soon') setTimeout(() => gridClosed(host), 0);
    else afterPress(() => { cell.removeAttribute('data-kinds-just-closed'); gridClosed(host); });
  };
  const unwatch = watchLeave(menu, t => menu.contains(t), (how, target) => {
    if (how === 'press') {
      // A press on the + itself closes the list (its click handler sees it closed and leaves it so).
      if (target && cell.contains(target)) cell.setAttribute('data-kinds-just-closed', '');
      close(true, 'after-press');
    } else close(false, 'soon');
  });

  menu.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
    if (!b) return;
    e.stopPropagation();
    const kind = b.getAttribute('data-kind') as KindPick;
    // "Another kind…" leaves the grid for a dialog: the redraw that waited runs first, and the
    // dialog is opened from the + as it is drawn then. A kind opens its box first: the box holds.
    if (kind === 'other') { close(false, 'now'); pick(kind); return; }
    pick(kind);
    close(false, 'now');
  });
  menu.addEventListener('keydown', e => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number): void => { items[(i + items.length) % items.length].focus(); };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); markEscapeOwned(e); close(true, 'now'); }
    // Tab: closed, the focus on the +, and the browser's own Tab moves on from there.
    else if (e.key === 'Tab') close(true, 'now');
  });
  items[0].focus({ preventScroll: true });
  return menu;
}
