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

/**
 * What a cancelled pick says (S354). A cancel is usually just a cancel, but
 * Chrome also refuses to hand out the top of Desktop, Documents, Downloads
 * and the user's home folder: the dialog shows its own refusal and then
 * returns exactly like a cancel, so "Change folder" looked like it did
 * nothing at all. One quiet line covers both readings.
 */
export const PICKER_CANCELLED_HINT =
  'No folder chosen. If the picker refused one, choose a subfolder: the browser does not open the top of Desktop, Documents or Downloads.';

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
