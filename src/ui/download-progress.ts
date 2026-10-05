/**
 * The one progress line for a world coming down from onlyworlds.com (link,
 * view, an account world's open, Bring it down again). A big world coming
 * into this browser's storage says, once the count is known, that it takes a
 * while: Firefox writes browser storage slower than Chromium writes a folder,
 * and a world of thousands of elements takes minutes (contract §2.2; the
 * Captain's d-1000, built as the walk page's lean pending his ruling: S377).
 */
import type { FilesWhere } from '../core/browser-worlds';

/** Above this many elements a download into this browser says it takes a while. */
export const BIG_BROWSER_DOWNLOAD = 1000;

export function downloadingLine(done: number, total: number, where: FilesWhere): string {
  const line = `Downloading ${done} of ${total} elements…`;
  return where === 'browser' && total > BIG_BROWSER_DOWNLOAD
    ? `${line} A world this size takes a while in this browser.`
    : line;
}
