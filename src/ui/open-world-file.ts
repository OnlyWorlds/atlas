/**
 * The "Open a world file" door (1.17 bout 5, contract §5.2): pick a `.zip`
 * Atlas saved, open it as a world in this browser, then open the world. Every
 * browser has it (a file input, no folder picker). The work, refusals and
 * restore rules are `setup/world-file-open.ts`.
 */
import type { ToastManager } from './toast-manager';
import { getState } from '../core/state';
import { opfsStatus, NO_BROWSER_STORAGE_LINE } from '../core/capabilities';
import { browserStorageFullSentence } from '../core/problems';
import { showProblem } from './problem-fixes';
import { completeWaypoint } from '../core/waypoints';
import { WORLD_FILE_MAX_BYTES } from '../store/world-tree';

/**
 * The file picker, opened SYNCHRONOUSLY inside the caller's click (a file
 * input needs the gesture). Resolves the picked file, or null when the user
 * closed it.
 */
export function pickWorldFile(): Promise<File | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip';
  return new Promise(resolve => {
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** A file that is a world file (a `.zip`), not a JSON export: it opens as its own world. */
export function isWorldFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/** Open a picked world file: a new world in this browser, a cleared one restored, or the one already here offered. */
export async function openWorldFileFrom(file: File, toasts: ToastManager): Promise<void> {
  const status = await opfsStatus();
  if (status !== 'ok') {
    toasts.error(status === 'full' ? browserStorageFullSentence('opening the world file') : NO_BROWSER_STORAGE_LINE);
    return;
  }
  // Past the budget, refused before the file is read into memory (S373 gate F4).
  if (file.size > WORLD_FILE_MAX_BYTES) {
    toasts.error('That file is too big to open in this browser.');
    return;
  }
  toasts.info('Opening the world file…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { openWorldFile } = await import('../setup/world-file-open');
    const { activateWorld } = await import('../sidebar/worlds-sidebar');
    const out = await openWorldFile(bytes);
    if (out.kind === 'already') {
      toasts.show('This world is already in Atlas.', 'info', 8000, {
        actions: [{ label: 'Open it', run: () => { void activateWorld(out.worldId, toasts); } }],
      });
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === out.worldId);
    if (await activateWorld(out.worldId, toasts)) {
      completeWaypoint('first-world');
      completeWaypoint('import');
    }
    const name = entry?.name ?? 'The world';
    toasts.success(out.kind === 'restored'
      ? `Restored "${name}" from the file.${entry?.state === 'api-linked' ? ' Changes that conflict with OnlyWorlds wait for you.' : ''}`
      : `Opened "${name}". It lives in this browser.`);
  } catch (err) {
    console.warn('[open-world-file] failed:', err);
    showProblem(err, { doing: 'opening the world file', where: 'browser', toasts });
  }
}
