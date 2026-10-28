/**
 * The one progress line for a world coming down from onlyworlds.com (link,
 * view, an account world's open, Bring it down again). A world coming into
 * this browser downloads into memory and opens there; its files are saved
 * behind it and counted on its home (`middle/home-landing.ts`, #865), so the
 * dialog's line ends at the open.
 */
import type { InitialDownloadProgress } from '../sync/initial-download';

/**
 * The line for the download and opening phases; the listing phase and an
 * empty world keep each dialog's own words. A browser world's files land
 * after it opens, counted on its home (#865), so no dialog says saving.
 */
export function progressLine(p: Pick<InitialDownloadProgress, 'phase' | 'done' | 'total'>): string {
  if (p.phase === 'open') return p.done < p.total ? `Opening the world… ${p.done} of ${p.total}` : 'Opening the world…';
  return `Downloading ${p.done} of ${p.total} elements…`;
}
