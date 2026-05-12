/**
 * Directory-picker indirection.
 *
 * Production calls `window.showDirectoryPicker()` (FS Access API, requires
 * user gesture). Tests inject an override via `window.__atlasTestApi.pickDirectory`
 * to return an OPFS handle without the picker dialog.
 *
 * Returns null if the user cancels (AbortError).
 */

interface TestApiPick {
  pickDirectory?: () => Promise<FileSystemDirectoryHandle | null>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
  }
}

export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  const test = (window as unknown as { __atlasTestApi?: TestApiPick }).__atlasTestApi;
  if (test?.pickDirectory) {
    return test.pickDirectory();
  }
  if (!window.showDirectoryPicker) {
    throw new Error('File System Access API is not available. Atlas requires Chromium.');
  }
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return null;
    throw err;
  }
}
