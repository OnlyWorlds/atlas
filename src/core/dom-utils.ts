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
