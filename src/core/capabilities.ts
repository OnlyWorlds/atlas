/**
 * Browser capability detection — runtime feature checks, never UA sniffing.
 *
 * Two tiers (2026-07-19, the Safari question):
 *   - FOLDER mode: the File System Access API picker (`showDirectoryPicker`).
 *     Chromium-only today. Everything atlas promises about "your worlds live
 *     in a folder you choose" rides this.
 *   - OPFS mode: origin-private file system with main-thread writes
 *     (`navigator.storage.getDirectory` + `createWritable`). Safari 18.2+ and
 *     Firefox 111+ have this. It is enough for the guided tour (the tour
 *     world lives in browser storage by design) and, later, for a full
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
  // Main-thread writes need createWritable on file handles (Safari 18.2+).
  // The prototype check avoids an async probe at boot.
  const fh = (window as unknown as { FileSystemFileHandle?: { prototype?: Record<string, unknown> } })
    .FileSystemFileHandle;
  return typeof fh?.prototype?.createWritable === 'function';
}
