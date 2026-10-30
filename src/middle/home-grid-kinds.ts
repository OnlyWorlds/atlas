/**
 * The plain + square's list (the home that grows): which kind to add.
 *
 *   A popover anchored to the square, laid over the grid (never part of its
 *   height): "a character", "a location", "an event", "a story" and
 *   "Another kind…", a menu named "Add which kind". Arrows move, Enter picks,
 *   Escape or a press outside closes it with the focus on the +, Tab closes
 *   it and moves on from the +.
 *
 *   While it is open the host carries `data-grid-open` (as the name box
 *   does), so a resize or a sync redraw waits until it closes; closing tells
 *   the page with `GRID_CLOSED`.
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

/** Open the list under the + square `cell` (in the grid's `host`). `pick` runs after it closed. */
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
  const close = (focusPlus: boolean): void => {
    if (!open) return;
    open = false;
    document.removeEventListener('pointerdown', outside, true);
    menu.remove();
    cell.setAttribute('aria-expanded', 'false');
    if (focusPlus) cell.focus({ preventScroll: true });
    gridClosed(host);
  };
  const outside = (e: PointerEvent): void => {
    const t = e.target as Node;
    if (menu.contains(t)) return;
    // A press on the + itself closes the list (its click handler sees it closed and leaves it so).
    if (cell.contains(t)) cell.setAttribute('data-kinds-just-closed', '');
    close(true);
  };
  document.addEventListener('pointerdown', outside, true);

  menu.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-kind]');
    if (!b) return;
    e.stopPropagation();
    const kind = b.getAttribute('data-kind') as KindPick;
    close(false);
    pick(kind);
  });
  menu.addEventListener('keydown', e => {
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number): void => { items[(i + items.length) % items.length].focus(); };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(items.length - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); markEscapeOwned(e); close(true); }
    // Tab: closed, the focus on the +, and the browser's own Tab moves on from there.
    else if (e.key === 'Tab') close(true);
  });
  items[0].focus({ preventScroll: true });
  return menu;
}
