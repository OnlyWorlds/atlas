/**
 * The one progress line for a world coming down from onlyworlds.com (link,
 * view, an account world's open, Bring it down again). A world coming into
 * this browser downloads into memory first and is then saved file by file
 * (`setup/browser-first-download.ts`): the saving is where the time is, since
 * Firefox writes each file of browser storage in about 60 ms against
 * Chromium's few, so a big world says so on that line (contract §2.2, moved
 * to the saving in 1.98.1).
 */
import type { FilesWhere } from '../core/browser-worlds';
import type { InitialDownloadProgress } from '../sync/initial-download';

/** Above this many files a save into this browser says it takes a while. */
export const BIG_BROWSER_DOWNLOAD = 1000;

/** The line for the download and saving phases; the listing phase and an empty world keep each dialog's own words. */
export function progressLine(p: Pick<InitialDownloadProgress, 'phase' | 'done' | 'total'>, where: FilesWhere): string {
  if (p.phase === 'open') return p.done < p.total ? `Opening the world… ${p.done} of ${p.total}` : 'Opening the world…';
  if (p.phase !== 'land') return `Downloading ${p.done} of ${p.total} elements…`;
  if (p.done >= p.total) return 'Opening the world…';
  const line = `Saving ${p.done} of ${p.total} files in this browser…`;
  return where === 'browser' && p.total > BIG_BROWSER_DOWNLOAD
    ? `${line} A world this size takes a while in this browser.`
    : line;
}
