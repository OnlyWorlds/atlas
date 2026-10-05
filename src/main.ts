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
import { installStaleCodeRecovery } from './core/reload-offer';
import { hasFolderMode, hasOpfsMode } from './core/capabilities';
import { installPlacementHintWatcher } from './tabs/right/map-placement-hint';
import { installIconA11y } from './ui/icon-a11y';
import { installDocumentTitle } from './ui/document-title';
import { installTruncationTitles } from './ui/truncation-title';
import { applyTheme } from './core/theme';
import { installUnexpectedErrorReporter } from './ui/unexpected-errors';

function renderUnsupportedPage(root: HTMLElement): void {
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'atlas-unsupported';
  wrap.innerHTML = `
    <div class="atlas-unsupported-panel">
      <div class="atlas-unsupported-icon">
        <span class="material-symbols-outlined">public</span>
      </div>
      <h1>Atlas needs a newer browser</h1>
      <p>
        Atlas keeps your worlds as files: in a folder on your drive in
        <b>Chrome</b>, <b>Edge</b> or <b>Brave</b>, or in the browser's own
        storage in a recent <b>Firefox</b> or <b>Safari</b>. This browser can
        do neither.
      </p>
      <div class="atlas-unsupported-actions">
        <a href="https://www.google.com/chrome/" target="_blank" rel="noopener">Download Chrome →</a>
        <a href="https://brave.com/" target="_blank" rel="noopener">Download Brave →</a>
      </div>
    </div>
  `;
  root.appendChild(wrap);
}

function boot(): void {
  // Re-assert the theme (index.html's pre-paint script stamped it; this keeps
  // the meta theme-color in sync and covers any embed that skipped the inline
  // script).
  applyTheme();
  const root = document.getElementById('app');
  if (!root) {
    console.error('[atlas] #app element missing');
    return;
  }
  // Folder-mode browsers (Chromium) get the full app. OPFS-only browsers
  // (Safari 26+, Firefox 111+) get it with every world in browser storage
  // (1.17, conv. 129): the folder-only doors are hidden there.
  if (!hasFolderMode() && !hasOpfsMode()) {
    renderUnsupportedPage(root);
    return;
  }
  startApp(root);
  // A failure nothing caught says so once, with details (S369).
  installUnexpectedErrorReporter();
  // Pin-placement feedback (crosshair + map banner + Esc). State-driven, one
  // subscriber; safe to install once here after the app mounts.
  installPlacementHintWatcher();
  // Material Symbols render their NAME as text, so assistive tech announced
  // "add cloud_upload" and "wall_art pages" for our controls. 253 render sites,
  // no shared icon helper to fix at — so the boundary is one observer. See
  // ui/icon-a11y.ts for the demolition plan.
  installIconA11y();
  // The tab title follows the route; clipped names show whole on hover (S360).
  installDocumentTitle();
  installTruncationTitles();
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
// A tab from before a deploy asks for code files the deploy replaced (S366).
installStaleCodeRecovery();

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
     * Wait until any in-flight guided-tour step has finished revealing,
     * healing and routing. The `data-tour-step` attribute flips before that
     * work runs, so it is not a valid sync point for anything that inspects
     * the world after a step change (S301).
     */
    async awaitTourSettled(): Promise<void> {
      const { awaitTourSettled } = await import('./tour/tour-engine');
      await awaitTourSettled();
    },
    /**
     * The active world's meta as it sits ON DISK, for tests that assert the
     * in-memory `state.active.meta` mirror has not drifted from it. The tour
     * scaffold used to hand-build that mirror from a subset of the fields it
     * had just written, so `time_current` was missing for a whole run.
     */
    async worldMetaOnDisk(): Promise<unknown> {
      const { getActiveStore } = await import('./core/active-store');
      const store = getActiveStore();
      return store ? await store.readWorldMeta() : null;
    },
    /**
     * Reset everything Atlas owns: localStorage (registry, ui prefs), IDB
     * (handle-vault), OPFS. Lets each Playwright test start clean.
     */
    async resetAll(): Promise<void> {
      // Parked stores hold handles into the OPFS being wiped — drop them
      // first (their heartbeats are already stopped by park()).
      const { clearParkedStores } = await import('./core/active-store');
      clearParkedStores();
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
    /**
     * Set up a home folder from the next picked directory, through the same
     * door code the landing's old "set up a folder" button ran (1.17 removed
     * that button: the home folder is asked for at a world's first make). For
     * specs whose setup needs a home folder and is not about the landing.
     */
    async setupHomeFolder(): Promise<void> {
      const { setupAtlasRoot } = await import('./setup/atlas-root-flow');
      const { finishSetupDoor } = await import('./setup/world-doors');
      const { toastManager } = await import('./ui/toast-manager');
      await finishSetupDoor(await setupAtlasRoot(), toastManager);
    },
    /** Tests use these to read state and refresh the elements cache after direct store edits. */
    getState: () => _getState(),
    getActiveStore: () => _getActiveStore(),
    patchData: (elements: unknown[]) => _patchSlice('data', { elements: elements as never }),
    /** Generic slice patch — tests that write world meta directly to the store
     *  mirror it here (the room reads the slice, not the disk). */
    patchSlice: (slice: string, value: unknown) => _patchSlice(slice as never, value as never),
    /** The live folder (S364): one pass now, no throttle; resolves with the changes it applied. */
    async rescanNow(): Promise<unknown> {
      const { rescanNow } = await import('./core/live-folder');
      return rescanNow({ force: true });
    },
  };
}
