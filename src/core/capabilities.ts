/**
 * Browser capability detection — runtime feature checks, never UA sniffing.
 *
 * Two tiers (2026-07-19, the Safari question):
 *   - FOLDER mode: the File System Access API picker (`showDirectoryPicker`).
 *     Chromium-only today. Everything atlas promises about "your worlds live
 *     in a folder you choose" rides this.
 *   - OPFS mode: origin-private file system with main-thread writes
 *     (`navigator.storage.getDirectory` + `createWritable`). Safari 26+ and
 *     Firefox 111+ have this (Safari's `createWritable` arrived in 26, not
 *     18.2 as this line once said; S366 lane A, cited from WebKit). It is
 *     enough for the guided tour (the tour world lives in browser storage by
 *     design) and, later, for a full
 *     "atlas without a folder" mode.
 *
 * The boot gate in main.ts admits folder-mode browsers fully, admits
 * OPFS-only browsers in tour-capable mode, and shows the unsupported page
 * to the rest.
 */

export function hasFolderMode(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export function hasOpfsMode(): boolean {
  if (typeof navigator === 'undefined') return false;
  const storage = navigator.storage as StorageManager | undefined;
  if (!storage || typeof storage.getDirectory !== 'function') return false;
  // Main-thread writes need createWritable on file handles (Safari 26+).
  // The prototype check avoids an async probe at boot.
  const fh = (window as unknown as { FileSystemFileHandle?: { prototype?: Record<string, unknown> } })
    .FileSystemFileHandle;
  return typeof fh?.prototype?.createWritable === 'function';
}

/**
 * Can this window actually USE browser storage? (S366, lane A H4.)
 *
 * `hasOpfsMode` checks the API's shape, never calls it, so it cannot see a
 * window where the call is refused: a Firefox private window throws
 * `SecurityError` from `getDirectory()` (measured, Firefox 150), and the tour
 * then stalled at its first create with that raw message. This probe makes
 * the call and a throwaway write, once per page, and caches the answer.
 *
 * The answer is a reason (1.17, contract §1.2, gate B20): `absent` (no API),
 * `refused` (a private window), `full` (the origin's quota), or `ok`. A full
 * origin is never cached: freeing space must be able to change the answer,
 * and it must never read as a private window.
 */
export type OpfsStatus = 'ok' | 'refused' | 'full' | 'absent';

let opfsStatusCache: Promise<OpfsStatus> | null = null;
export function opfsStatus(): Promise<OpfsStatus> {
  if (!opfsStatusCache) {
    const probe = (async (): Promise<OpfsStatus> => {
      if (!hasOpfsMode()) return 'absent';
      try {
        const root = await navigator.storage.getDirectory();
        // A real file write (the tour's first act is one), under a reserved
        // name no world folder can take (`.atlas-` prefix; browser worlds
        // live under their own directory).
        const name = '.atlas-storage-probe';
        const file = await root.getFileHandle(name, { create: true });
        const w = await file.createWritable();
        await w.write('ok');
        await w.close();
        await root.removeEntry(name).catch(() => {});
        return 'ok';
      } catch (err) {
        return (err as { name?: unknown } | null)?.name === 'QuotaExceededError' ? 'full' : 'refused';
      }
    })();
    opfsStatusCache = probe;
    void probe.then(s => { if (s === 'full' && opfsStatusCache === probe) opfsStatusCache = null; });
  }
  return opfsStatusCache;
}

/** Can this window use browser storage right now? `opfsStatus` says why not. */
export async function opfsUsable(): Promise<boolean> {
  return (await opfsStatus()) === 'ok';
}

/** Test seam: forget the cached answer. */
export function __resetOpfsStatusForTests(): void {
  opfsStatusCache = null;
}

/** The one plain line for a window that refuses browser storage (lens C R3-h). */
export const NO_BROWSER_STORAGE_LINE =
  'This window does not allow browser storage, so no world can live in this browser here. If it is a private window, open Atlas in a normal one.';
