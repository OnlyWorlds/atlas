/**
 * Atlas — folder-first OnlyWorlds world browser and editor.
 *
 * Boot order: app shell mounts → registry hydrates from localStorage → router
 * resolves the current hash → middle panel renders for the active mode.
 */

import { FsFolderStore, ELockHeld } from './store/folder-store-fs';
import { startApp } from './app';

function boot(): void {
  const root = document.getElementById('app');
  if (!root) {
    console.error('[atlas] #app element missing');
    return;
  }
  startApp(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// ---- Dev-only test harness ----
//
// Playwright spec drives FsFolderStore against an OPFS-backed directory handle.
// `import.meta.env.DEV` is true under `npm run dev` (vite dev server) and false
// in production builds, so this code is tree-shaken out of `dist/`.
//
// `OPFS` (origin-private filesystem) uses the SAME FileSystemDirectoryHandle
// interface as the user-chosen folder, so the test exercises the real impl
// end-to-end — only the handle source differs.
if (import.meta.env.DEV) {
  // Stash on window without polluting the type system in production.
  (window as unknown as Record<string, unknown>).__atlasTestApi = {
    FsFolderStore,
    ELockHeld,
    /** Get a fresh OPFS root, optionally cleared first. */
    async opfsRoot(opts: { clear?: boolean } = {}): Promise<FileSystemDirectoryHandle> {
      const root = await navigator.storage.getDirectory();
      if (opts.clear) {
        // @ts-expect-error values() is FS Access API, not in lib.dom yet
        for await (const entry of root.values()) {
          await root.removeEntry(entry.name, { recursive: true }).catch(() => {});
        }
      }
      return root;
    },
    /**
     * Set the next directory `pickDirectory()` will return. Tests inject an
     * OPFS-backed subdirectory so the create-world flow can run without a
     * user-gesture file picker.
     */
    setNextDirectory(handle: FileSystemDirectoryHandle | null): void {
      const api = (window as unknown as { __atlasTestApi: Record<string, unknown> }).__atlasTestApi;
      api.pickDirectory = async () => handle;
    },
    /**
     * Reset everything Atlas owns: localStorage (registry, ui prefs), IDB
     * (handle-vault), OPFS. Lets each Playwright test start clean.
     */
    async resetAll(): Promise<void> {
      localStorage.clear();
      // wipe IDB databases atlas knows about
      const dbs = ['atlas-handles'];
      for (const name of dbs) {
        await new Promise<void>((res) => {
          const req = indexedDB.deleteDatabase(name);
          req.onsuccess = () => res();
          req.onerror = () => res();
          req.onblocked = () => res();
        });
      }
      // wipe OPFS
      const root = await navigator.storage.getDirectory();
      // @ts-expect-error values() is FS Access API
      for await (const entry of root.values()) {
        await root.removeEntry(entry.name, { recursive: true }).catch(() => {});
      }
    },
  };
}
