/**
 * The "Open a world file" door (1.17 bout 5, contract §5.2): pick a `.zip`
 * Atlas saved, open it as a world in this browser, then open the world. Every
 * browser has it (a file input, no folder picker). The work, refusals and
 * restore rules are `setup/world-file-open.ts`.
 */
import type { ToastManager } from './toast-manager';
import { getState } from '../core/state';
import { hasFolderMode, opfsStatus, NO_BROWSER_STORAGE_LINE } from '../core/capabilities';
import { askWhereWithHome } from './where-choice';
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
  // On Chromium with a home folder set, a NEW world asks where (contract §5.2,
  // §1.4, invariant 12): a folder answer opens it in this browser, then moves
  // it there with the home folder made writable inside the answer's click.
  // Without a home folder it lands in this browser, and Move to a folder is
  // one click away; a restore always lands where the world was.
  let moveTo: { home: FileSystemDirectoryHandle; hint: string } | null = null;
  const chooseWhere = hasFolderMode() && getState().atlasRoot
    ? async (): Promise<'browser' | 'folder' | null> => {
        const answer = await askWhereWithHome({ title: 'Open a world file', action: 'Open it', purpose: 'open this world in a folder on your drive', toasts });
        if (answer?.where === 'folder') moveTo = { home: answer.home, hint: answer.hint };
        return answer?.where ?? null;
      }
    : undefined;
  toasts.info('Opening the world file…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { openWorldFile } = await import('../setup/world-file-open');
    const { activateWorld } = await import('../sidebar/worlds-sidebar');
    const out = await openWorldFile(bytes, { chooseWhere });
    if (out.kind === 'cancelled') {
      toasts.info('The world file was not opened.');
      return;
    }
    if (out.kind === 'already') {
      toasts.show('This world is already in Atlas.', 'info', 8000, {
        actions: [{ label: 'Open it', run: () => { void activateWorld(out.worldId, toasts); } }],
      });
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === out.worldId);
    const opened = await activateWorld(out.worldId, toasts);
    if (opened) {
      completeWaypoint('first-world');
      completeWaypoint('import');
    }
    const name = entry?.name ?? 'The world';
    // (TypeScript cannot see the closure's assignment, hence the cast.)
    const home = moveTo as { home: FileSystemDirectoryHandle; hint: string } | null;
    if (home && entry) {
      if (opened) {
        // The move's own dialog says how it went, either way.
        const { MoveBrowserWorldModal } = await import('./move-browser-world-modal');
        const now = getState().registry.worlds.find(w => w.id === out.worldId) ?? entry;
        await new MoveBrowserWorldModal(now, toasts).start(home);
      } else {
        // The world is whole in this browser; the move is one click away (§7.5's wording).
        toasts.info(`"${name}" is in Atlas and lives in this browser; it did not open, so it was not moved to your folder. Settings, This world, can move it.`);
      }
      return;
    }
    toasts.success(out.kind === 'restored'
      ? `Restored "${name}" from the file.${entry?.state === 'api-linked' ? ' Changes that conflict with OnlyWorlds wait for you.' : ''}`
      : `Opened "${name}". It lives in this browser.`);
  } catch (err) {
    console.warn('[open-world-file] failed:', err);
    showProblem(err, { doing: 'opening the world file', where: 'browser', toasts });
  }
}
