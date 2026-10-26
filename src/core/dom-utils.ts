/**
 * Tiny DOM helpers shared across UI modules.
 *
 * Centralised here so all renderers use the same escape semantics — previously
 * each room/sidebar/modal had its own copy. Single source of truth keeps the
 * XSS surface uniform (anyone adding a new escape rule does it once).
 */

/**
 * Escape for safe interpolation into HTML: text content AND quoted attribute
 * values. Escapes `& < > " '` and is TOTAL: a non-string (a number, null, an
 * object from a foreign folder) is stringified instead of throwing.
 *
 * This used to escape only `& < >`, and it is used inside `attr="…"` in
 * dozens of places, so a world file carrying a `"` in a name, url or unit could
 * break out of the attribute (a stored XSS from a folder anyone can write). The
 * quote escapes are harmless in text context, so one helper serves both.
 */
export function escapeText(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for a quoted HTML attribute value. Same as `escapeText`. */
export function escapeAttr(s: unknown): string {
  return escapeText(s);
}

/** A `#rrggbb` colour, the only shape atlas stores or renders for user colours. */
export function isHexColour(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);
}

/**
 * Read a colour from untrusted data: the value when it is a `#rrggbb` hex,
 * else the fallback. Colours from world files reach `style="…"` and `value="…"`,
 * so anything else (a CSS declaration list, a quote breakout) is dropped here.
 */
export function hexColourOr(v: unknown, fallback: string): string {
  return isHexColour(v) ? v : fallback;
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
 * The role PROMISES Enter/Space work — a promise the innerHTML list
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

/**
 * A number from untrusted data (a world file): the value when it is a finite
 * number or a numeric string, else the fallback. A string `order` from a
 * foreign folder was concatenated straight into HTML before this.
 */
export function finiteOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}
