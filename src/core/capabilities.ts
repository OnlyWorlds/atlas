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
 *     18.2 as this line once said; cited from WebKit). It is
 *     enough for worlds kept in browser storage (1.17, conv. 129): the only
 *     home on Firefox and Safari, a choice on Chromium.
 *
 * The boot gate in main.ts admits a browser with either mode and shows the
 * unsupported page to the rest.
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
 * Can this window actually USE browser storage?
 *
 * `hasOpfsMode` checks the API's shape, never calls it, so it cannot see a
 * window where the call is refused: a Firefox private window throws
 * `SecurityError` from `getDirectory()` (measured, Firefox 150), and the tour
 * then stalled at its first create with that raw message. This probe makes
 * the call and a throwaway write, once per page, and caches the answer.
 *
 * The answer is a reason (1.17, contract §1.2): `absent` (no API),
 * `refused` (a private window), `full` (the origin's quota), or `ok`. A full
 * origin is never cached: freeing space must be able to change the answer,
 * and it must never read as a private window.
 *
 * `refused` is ONE error, `SecurityError` (the measured private-window
 * answer). Any other error (two tabs probing at once, a
 * file the browser holds) is retried once and then reads as usable without
 * being cached: the door stays and the act itself says what went wrong, and
 * the next ask probes again. Each probe writes its own file name, so two
 * tabs booting together never race one file.
 */
export type OpfsStatus = 'ok' | 'refused' | 'full' | 'absent';

type ProbeAnswer = OpfsStatus | 'unsure';

async function probeOnce(): Promise<ProbeAnswer> {
  try {
    const root = await navigator.storage.getDirectory();
    // A real file write (the tour's first act is one), under a reserved
    // name no world folder can take (`.atlas-` prefix; browser worlds live
    // under their own directory), unique to this probe.
    const name = `.atlas-storage-probe-${Array.from(crypto.getRandomValues(new Uint8Array(4)), b => b.toString(16).padStart(2, '0')).join('')}`;
    const file = await root.getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write('ok');
    await w.close();
    await root.removeEntry(name).catch(() => {});
    return 'ok';
  } catch (err) {
    const name = (err as { name?: unknown } | null)?.name;
    if (name === 'QuotaExceededError') return 'full';
    if (name === 'SecurityError') return 'refused';
    return 'unsure';
  }
}

let opfsStatusCache: Promise<OpfsStatus> | null = null;
/** The last answer the probe settled on, for a synchronous reader (null until one has). */
let opfsStatusKnown: OpfsStatus | null = null;
export function opfsStatus(): Promise<OpfsStatus> {
  if (!opfsStatusCache) {
    let unsure = false;
    const probe = (async (): Promise<OpfsStatus> => {
      if (!hasOpfsMode()) return 'absent';
      let answer = await probeOnce();
      if (answer === 'unsure') answer = await probeOnce();
      if (answer !== 'unsure') return answer;
      unsure = true;
      return 'ok';
    })();
    opfsStatusCache = probe;
    void probe.then(s => {
      opfsStatusKnown = s;
      if ((s === 'full' || unsure) && opfsStatusCache === probe) opfsStatusCache = null;
    });
  }
  return opfsStatusCache;
}

/**
 * The probe's last answer without waiting, for a synchronous surface (the
 * palette's search, the chooser's rows): null while nothing has settled yet,
 * which such a surface reads as "offer it" (the door says why on the click).
 * Calling it starts a probe when none has run.
 */
export function knownOpfsStatus(): OpfsStatus | null {
  void opfsStatus();
  return opfsStatusKnown;
}

/** May a door that needs browser storage be offered? Only a settled refusal says no. */
export function browserStorageDoorOpen(): boolean {
  const known = knownOpfsStatus();
  return hasOpfsMode() && (known === null || known === 'ok');
}

/** Can this window use browser storage right now? `opfsStatus` says why not. */
export async function opfsUsable(): Promise<boolean> {
  return (await opfsStatus()) === 'ok';
}

/** Test seam: forget the cached answer. */
export function __resetOpfsStatusForTests(): void {
  opfsStatusCache = null;
  opfsStatusKnown = null;
}

/** The one plain line for a window that refuses browser storage. */
export const NO_BROWSER_STORAGE_LINE =
  'This window does not allow browser storage, so no world can be kept here. If it is a private window, open Atlas in a normal one.';

/** The plain line for a full origin, where no act is under way (the landing, Settings). */
export const BROWSER_STORAGE_FULL_LINE =
  "This browser's storage for Atlas is full, so no world can be made in this browser now. Free some space, then reload.";
