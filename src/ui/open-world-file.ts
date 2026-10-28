/**
 * The "Open a world file" door (1.17, contract §5.2): pick a world
 * file (the standard's `.owworld`, or the `.zip` Atlas saves: folder spec 4.7
 * OW-1, the same file), open it as a world in this browser, then open the world. Every
 * browser has it (a file input, no folder picker). The work, refusals and
 * restore rules are `setup/world-file-open.ts`.
 */
import type { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { setSidebarModePref } from '../core/ui-prefs';
import { hasFolderMode, opfsStatus, NO_BROWSER_STORAGE_LINE } from '../core/capabilities';
import { askWhereWithHome } from './where-choice';
import { browserStorageFullSentence } from '../core/problems';
import { showProblem } from './problem-fixes';
import { WORLD_FILE_MAX_BYTES } from '../store/world-tree';
import { worldAlreadyHere } from '../core/browser-home';
import { buildDemoWorldFile, DEMO_WORLD_ID, DEMO_WORLD_NAME } from '../setup/demo-copy';
import type { WorldRegistryEntry } from '../core/types';
import { isCodeLoadError } from '../core/reload-offer';
import { showLoadingOverlay, type LoadingOverlayHandle } from './loading-overlay';
import { progressLine } from './download-progress';

/**
 * The file picker, opened SYNCHRONOUSLY inside the caller's click (a file
 * input needs the gesture). Resolves the picked file, or null when the user
 * closed it.
 */
export function pickWorldFile(): Promise<File | null> {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = WORLD_FILE_ACCEPT;
  return new Promise(resolve => {
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

/** What a file input offers for a world file: the standard's `.owworld` and the `.zip` Atlas saves (OW-1: the same file). */
export const WORLD_FILE_ACCEPT = '.owworld,.zip,application/zip';

/** A file whose name or type says world file (`.owworld`, `.zip`): it opens as its own world, never as JSON. */
export function isWorldFile(file: Pick<File, 'name' | 'type'>): boolean {
  return /\.(owworld|zip)$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/**
 * The content decides, never the name (folder spec 4.7 OW-1): a file whose
 * first bytes are a zip's (a local file header, or an empty archive's end
 * record) is a world file whatever it is called, so a renamed one opens as a
 * world rather than failing as JSON. A read that fails says no.
 */
export async function startsLikeWorldFile(file: Pick<Blob, 'slice'>): Promise<boolean> {
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return head.length === 4 && head[0] === 0x50 && head[1] === 0x4b
      && ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06));
  } catch {
    return false;
  }
}

/** What a door that opens world-file bytes says (the file door; the demo world, #113). */
interface OpenWords {
  /** For `showProblem` and the storage line: "opening the world file". */
  doing: string;
  /** The where-question's title. */
  title: string;
  /** Said while the bytes are made and opened; the demo shows its own progress instead. */
  opening?: string;
  cancelled: string;
  already: string;
  opened: (name: string) => string;
  restored: (name: string, linked: boolean) => string;
  /** A world already here can open beside itself as a view-only copy (conv. 177): the file door's, never the demo's. */
  offerCopy?: boolean;
}

const FILE_WORDS: OpenWords = {
  doing: 'opening the world file',
  title: 'Open a world file',
  opening: 'Opening the world file…',
  cancelled: 'The world file was not opened.',
  already: 'This world is already in Atlas.',
  opened: name => `Opened "${name}". It lives in this browser.`,
  restored: (name, linked) => `Restored "${name}" from the file.${linked ? ' Changes that conflict with OnlyWorlds wait for you.' : ''}`,
  offerCopy: true,
};

/** Open a picked world file: a new world in this browser, a cleared one restored, or the one already here offered. */
export async function openWorldFileFrom(file: File, toasts: ToastManager): Promise<void> {
  if (!(await storageReady(toasts, FILE_WORDS))) return;
  // Past the budget, refused before the file is read into memory.
  if (file.size > WORLD_FILE_MAX_BYTES) {
    toasts.error('That file is too big to open in this browser.');
    return;
  }
  await openWorldBytes(async () => new Uint8Array(await file.arrayBuffer()), toasts, FILE_WORDS);
}

/**
 * Try the demo world (#113): Moppetopia brought down by its demo key, then
 * opened as a world file of the user's own (`setup/demo-copy.ts`).
 */
export async function openDemoWorld(toasts: ToastManager): Promise<void> {
  // One at a time in this tab: a second click while it comes down is the same ask.
  if (demoRunning) {
    toasts.info(`${DEMO_WORLD_NAME} is still downloading.`);
    return;
  }
  demoRunning = true;
  try {
    await openDemoWorldOnce(toasts);
    // Moppetopia opens onto its elements, not the worlds list (Titus,
    // 2026-10-09): the world is the thing to look at, as after start a world.
    if (getState().active?.meta.id === DEMO_WORLD_ID) {
      patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
      setSidebarModePref('elements');
    }
  } catch (err) {
    // The door's callers do not catch (the #/try-demo link fires it and
    // forgets), and opening a copy already here runs outside the download's
    // own catch: a failure there became "a problem it did not expect while
    // working in the background" (Boss 2026-10-14). Said here, as what it is.
    console.warn('[open-world-file] demo failed:', err);
    if (!isCodeLoadError(err)) showProblem(err, { doing: DEMO_WORDS.doing, where: 'browser', toasts });
  } finally {
    demoRunning = false;
  }
}

let demoRunning = false;

const DEMO_WORDS: OpenWords = {
  doing: `downloading ${DEMO_WORLD_NAME}`,
  title: `Try ${DEMO_WORLD_NAME}`,
  cancelled: `${DEMO_WORLD_NAME} was not opened.`,
  already: `${DEMO_WORLD_NAME} is already in Atlas.`,
  opened: name => `Opened "${name}": your own copy, in this browser. Nothing you change goes back to OnlyWorlds.`,
  restored: name => `Brought back a fresh copy of "${name}" in this browser.`,
};

/**
 * The demo world already here, as the user would mean it: their copy, or a
 * link to the live world (view-only, or one the browser cleared). A copy the
 * browser cleared is not "here": the world-file door restores it.
 */
function demoHere(worldId: string): WorldRegistryEntry | null {
  const e = worldAlreadyHere(getState().registry, worldId);
  if (!e) return null;
  return e.api || e.state === 'api-linked' || !e.cleared_at ? e : null;
}

/** Answer a demo world already here; false when there is none. */
async function answerDemoHere(worldId: string, toasts: ToastManager): Promise<boolean> {
  const e = demoHere(worldId);
  if (!e) return false;
  const { activateWorld } = await import('../sidebar/worlds-sidebar');
  if (e.api || e.state === 'api-linked') {
    // A copy cannot sit beside a link to the same world (one identity, one row).
    toasts.show(`${DEMO_WORLD_NAME} is already in Atlas, linked to OnlyWorlds. To try your own copy, remove that one first: Settings, This world.`, 'info', 12_000,
      e.cleared_at ? undefined : { actions: [{ label: 'Open it', run: () => { void activateWorld(e.id, toasts); } }] });
    return true;
  }
  if (await activateWorld(e.id, toasts)) toasts.success(`Opened your copy of ${DEMO_WORLD_NAME}.`);
  return true;
}

async function openDemoWorldOnce(toasts: ToastManager): Promise<void> {
  if (!(await storageReady(toasts, DEMO_WORDS))) return;
  // The copy's id is the live world's, known ahead: a copy already here opens
  // with no download and no connection.
  if (await answerDemoHere(DEMO_WORLD_ID, toasts)) return;
  // The download takes seconds on a good line and longer on a weak one: a
  // toast that left after four of them said nothing for the rest (Boss
  // 2026-10-14). The overlay stays until the world is open (Boss 2026-10-14: closed
  // at the download's end, the unpacking after it was two quiet seconds), and
  // gives way to the where-question when there is one.
  const overlay = showLoadingOverlay(`Downloading ${DEMO_WORLD_NAME}`);
  overlay.update('Asking OnlyWorlds for it…');
  // Opening counts its files: Firefox writes each in about 40 ms, so the
  // demo's 320 sat on one quiet line for 14 s (Boss 2026-10-14).
  let openingName = DEMO_WORLD_NAME;
  const openingLine = (done: number, total: number) => `Opening ${openingName}… ${done} of ${total} files`;
  try {
    await openWorldBytes(async () => {
      const built = await buildDemoWorldFile({
        isHere: id => demoHere(id) !== null,
        onProgress: p => { if (p.phase === 'write') overlay.update(progressLine(p, 'browser')); },
      });
      if (built.kind === 'file') {
        openingName = built.name;
        overlay.update(`Opening ${built.name}…`);
        return built.bytes;
      }
      overlay.close();
      await answerDemoHere(built.worldId, toasts);
      return null;
    }, toasts, DEMO_WORDS, overlay, openingLine);
  } finally {
    overlay.close();
  }
}

async function storageReady(toasts: ToastManager, words: OpenWords): Promise<boolean> {
  const status = await opfsStatus();
  if (status === 'ok') return true;
  toasts.error(status === 'full' ? browserStorageFullSentence(words.doing) : NO_BROWSER_STORAGE_LINE);
  return false;
}

/**
 * `getBytes` resolving null means it answered the user itself: nothing to open.
 * `overlay` (the demo's) is closed before anything else is said or asked, and
 * once the world is open. `openingLine`, with the overlay, counts the files
 * as they are written.
 */
/**
 * The file's world, already here, opened beside itself as a view-only copy
 * (conv. 177): always in this browser, never a restore, the world it copies
 * untouched. The same copy already here is opened instead.
 */
async function openCopyBeside(bytes: Uint8Array, toasts: ToastManager): Promise<void> {
  try {
    const { openWorldFile } = await import('../setup/world-file-open');
    const { activateWorld } = await import('../sidebar/worlds-sidebar');
    const { copyLine } = await import('../core/world-copy');
    const out = await openWorldFile(bytes, { asCopy: true });
    if (out.kind === 'already') {
      toasts.show('This copy is already in Atlas.', 'info', 8000, {
        actions: [{ label: 'Open it', run: () => { void activateWorld(out.worldId, toasts); } }],
      });
      return;
    }
    if (out.kind !== 'copied') return;
    const entry = getState().registry.worlds.find(w => w.id === out.worldId);
    if (await activateWorld(out.worldId, toasts) && entry?.copy_of) {
      toasts.success(`Opened ${copyLine(entry.name, entry.copy_of, false).replace(/^A copy/, 'a copy')}`);
    }
  } catch (err) {
    console.warn('[open-world-file] copy failed:', err);
    if (isCodeLoadError(err)) return;
    showProblem(err, { doing: 'opening a copy of the world file', where: 'browser', toasts });
  }
}

async function openWorldBytes(getBytes: () => Promise<Uint8Array | null>, toasts: ToastManager, words: OpenWords, overlay?: LoadingOverlayHandle, openingLine?: (done: number, total: number) => string): Promise<void> {
  // On Chromium with a home folder set, a NEW world asks where (contract §5.2,
  // §1.4, invariant 12): a folder answer opens it in this browser, then moves
  // it there with the home folder made writable inside the answer's click.
  // Without a home folder it lands in this browser, and Move to a folder is
  // one click away; a restore always lands where the world was.
  let moveTo: { home: FileSystemDirectoryHandle; hint: string } | null = null;
  const chooseWhere = hasFolderMode() && getState().atlasRoot
    ? async (): Promise<'browser' | 'folder' | null> => {
        overlay?.close();
        const answer = await askWhereWithHome({ title: words.title, action: 'Open it', purpose: 'Opening a world file puts it in a new folder.', toasts });
        if (answer?.where === 'folder') moveTo = { home: answer.home, hint: answer.hint };
        return answer?.where ?? null;
      }
    : undefined;
  if (words.opening) toasts.info(words.opening);
  try {
    const bytes = await getBytes();
    if (!bytes) return;
    const { openWorldFile } = await import('../setup/world-file-open');
    const { activateWorld } = await import('../sidebar/worlds-sidebar');
    const onWritten = overlay && openingLine ? (done: number, total: number) => overlay.update(openingLine(done, total)) : undefined;
    const out = await openWorldFile(bytes, { chooseWhere, onWritten });
    if (out.kind !== 'opened' && out.kind !== 'restored') overlay?.close();
    if (out.kind === 'cancelled') {
      toasts.info(words.cancelled);
      return;
    }
    if (out.kind === 'already') {
      const openIt = { label: 'Open it', run: () => { void activateWorld(out.worldId, toasts); } };
      toasts.show(words.already, 'info', words.offerCopy ? 12_000 : 8000, {
        actions: words.offerCopy
          ? [openIt, { label: 'Open a copy beside it', run: () => { void openCopyBeside(bytes, toasts); } }]
          : [openIt],
      });
      return;
    }
    const entry = getState().registry.worlds.find(w => w.id === out.worldId);
    const opened = await activateWorld(out.worldId, toasts);
    overlay?.close();
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
      ? words.restored(name, entry?.state === 'api-linked')
      : words.opened(name));
  } catch (err) {
    overlay?.close();
    console.warn('[open-world-file] failed:', err);
    // A code file this tab could not load already has its reload banner
    // (conv. 121); as a problem it read "OnlyWorlds could not be reached".
    if (isCodeLoadError(err)) return;
    showProblem(err, { doing: words.doing, where: 'browser', toasts });
  }
}
