/**
 * Atlas — folder-first OnlyWorlds world browser and editor.
 *
 * Boot order: app shell mounts → registry hydrates from localStorage → router
 * resolves the current hash → middle panel renders for the active mode.
 */

// Self-host the Material Symbols icon font (vs Google Fonts CDN) so the app
// works offline. The CSS rule references the woff2 shipped by the package;
// Vite copies it into the bundle and the @font-face URL resolves locally.
import 'material-symbols/outlined.css';

import { FsFolderStore, ELockHeld } from './store/folder-store-fs';
import { startApp } from './app';
import { getState as _getState, patchSlice as _patchSlice } from './core/state';
import { getActiveStore as _getActiveStore } from './core/active-store';
import { registerServiceWorker } from './core/offline';

function isFolderModeSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

function renderUnsupportedPage(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atlas-unsupported';
  wrap.innerHTML = `
    <div class="atlas-unsupported-panel">
      <div class="atlas-unsupported-icon">
        <span class="material-symbols-outlined">folder_special</span>
      </div>
      <h1>Atlas needs a Chromium browser</h1>
      <p>
        Atlas stores your worlds as real files on your computer using the
        <b>File System Access API</b>, which is currently only available in Chrome
        and Edge (and other Chromium-based browsers).
      </p>
      <p>
        Open this page in <b>Chrome</b> or <b>Edge</b> to use Atlas. Firefox and
        Safari can browse but not edit local worlds.
      </p>
      <div class="atlas-unsupported-actions">
        <a href="https://www.google.com/chrome/" target="_blank" rel="noopener">Download Chrome →</a>
        <a href="https://www.microsoft.com/edge" target="_blank" rel="noopener">Download Edge →</a>
      </div>
    </div>
  `;
  root.appendChild(wrap);
}

function boot(): void {
  const root = document.getElementById('app');
  if (!root) {
    console.error('[atlas] #app element missing');
    return;
  }
  if (!isFolderModeSupported()) {
    renderUnsupportedPage(root);
    return;
  }
  startApp(root);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

// Register the PWA service worker (production builds only — vite-plugin-pwa
// emits a no-op SW in dev unless explicitly enabled). The SW precaches the
// app shell so atlas works offline after first load.
registerServiceWorker();

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
    /** Tests use these to read state and refresh the elements cache after direct store edits. */
    getState: () => _getState(),
    getActiveStore: () => _getActiveStore(),
    patchData: (elements: unknown[]) => _patchSlice('data', { elements: elements as never }),
  };
}
