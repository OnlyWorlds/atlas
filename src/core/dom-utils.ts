/**
 * Tiny DOM helpers shared across UI modules.
 *
 * Centralised here so all renderers use the same escape semantics — previously
 * each room/sidebar/modal had its own copy. Single source of truth keeps the
 * XSS surface uniform (anyone adding a new escape rule does it once).
 */

/** Escape `&`, `<`, `>` for safe interpolation into element text content. */
export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape for safe interpolation into a double-quoted HTML attribute value. */
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

/**
 * Human-readable "time since" for an ISO timestamp. Empty string on bad input.
 * Falls back to `toLocaleDateString` past 1 week.
 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = (Date.now() - then) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Keyboard activation for div-rows that declare `role="button" tabindex="0"`
 * (S309). The role PROMISES Enter/Space work — a promise the innerHTML list
 * rows never kept: a keyboard user tabbed in, heard "button", pressed Enter,
 * nothing. One delegated listener per list root synthesizes the row's click
 * (which the root's existing click delegation then handles normally).
 *
 * Real interactive descendants (button/a/input) keep their native key
 * handling — the helper steps aside for them so nothing double-fires.
 */
export function installRowKeydownActivation(root: HTMLElement, selector = '[role="button"]'): void {
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target as HTMLElement;
    if (target.closest('button, a, input, textarea, select')) return;
    const row = target.closest<HTMLElement>(selector);
    if (!row || !root.contains(row)) return;
    e.preventDefault(); // Space must not scroll the pane.
    row.click();
  });
}
