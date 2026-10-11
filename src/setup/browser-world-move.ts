/**
 * Move a world kept in this browser to a folder on the drive (1.17 bout 4,
 * conv. 129; contract §4, §9 invariants 4-8; S370 gate lens A A1-A3, A7, A10,
 * A13, lens B B3-B5, B26; S373 move gate F1-F10). Chromium only: the
 * destination is the home folder.
 *
 * ONE COPY IS THE WORLD AT EVERY INSTANT, and the registry says which. The
 * whole move holds the world's Web Lock `atlas-world:<dir>` (the one a make
 * holds), so no other tab's recovery, reconciliation or open acts on the
 * world while it moves (S373 gate F1, F2, F8):
 *
 *   2  journal: `move` on the entry (its id and the folder name), saved and
 *      read back BEFORE the folder exists on the drive
 *   3  quiesce: rooms flushed, sync held, edits refused, and the source's
 *      lock KEPT as this tab's, marked `moving` (closing would remove it)
 *   4  copy into a folder that was empty (this move's token first, world.json
 *      last), then verify, then the token read back
 *   5  commit: open the destination store (its lock), store its handle, then
 *      ONE registry save, read back: `where` gone, the folder named,
 *      `moved_from` set, `move` gone. A save that did not land is no commit
 *      (gate F4): the browser copy is still the world.
 *   6  the token removed, the world's store and sync now the folder's
 *   7  the browser copy removed, then `moved_from`
 *
 * A throw before the commit is a failed move: the destination this call
 * made is removed, the handle forgotten, the source taken back; the journal
 * goes only once the destination is gone (gate F6), else recovery finishes it.
 * A crash anywhere is finished by `recoverBrowserMove`, at boot, when the
 * world opens, and at the next Move click: before the commit it removes only
 * a folder that carries this move's token (or nothing else), after it only
 * the browser directory the commit named. It never touches any other folder.
 */

import { getState, patchSlice } from '../core/state';
import { getActiveStore, setActiveStore, evictParkedStore, awaitEviction } from '../core/active-store';
import { enqueueActivationTask } from '../core/activation-chain';
import { flushBeforeLeavingWorld } from '../core/leave-flush';
import { PlainError } from '../core/plain-error';
import { ATLAS_INTERNAL_DIR, ATLAS_ROOT_HANDLE_KEY, LOCK_STALE_MS } from '../core/constants';
import { MOVING_IN_ANOTHER_TAB, deriveBrowserWorldHandle, isBrowserWorld, isGoneError, removeBrowserWorldDir } from '../core/browser-worlds';
import { ifWorldLockFree, withWorldLock } from '../core/browser-home';
import { slugify } from '../store/fs-utils';
import { FsFolderStore, currentTabId } from '../store/folder-store-fs';
import { copyWorldTree, verifyWorldTree, MOVE_INCOMING_FILE } from '../store/world-tree';
import { deleteHandle, loadHandle, queryWritable, storeHandle } from '../store/handle-vault';
import { saveRegistry, storedRegistry, updateWorldEntry } from '../registry/registry';
import { attachSyncEngine, getCurrentSyncEngine, getCurrentSyncWorldId } from '../sync/sync-attach';
import { isRekeyRunning, withIdMoveLock } from '../sync/rekey-run';
import type { WorldRegistryEntry, WorldsRegistry } from '../core/types';

/** Said when a move did not reach its commit: the browser copy is still the world. */
export const MOVE_DID_NOT_FINISH = (name: string) =>
  `Moving "${name}" did not finish, so nothing changed: it is still in this browser.`;

export { MOVING_IN_ANOTHER_TAB };

const REGISTRY_NOT_SAVED =
  'Atlas could not save its list of worlds in this browser, so it stopped before changing anything. Free some space in this browser, then try again.';

export type MoveOutcome =
  | { ok: true; folderName: string; pathHint: string; leftBrowserCopy: boolean }
  | { ok: false; error: unknown };

export interface MoveOpts {
  /** The home folder, made writable inside the click that asked for the move. */
  home: FileSystemDirectoryHandle;
  /** How the home folder is named on screen (`state.atlasRoot.pathHint`). */
  homeHint: string;
  onProgress?: (done: number, total: number) => void;
}

/** World ids this tab is moving now: recovery from anywhere but the move itself stands down. */
const movingHere = new Set<string>();

function saveReg(next: WorldsRegistry): void {
  saveRegistry(next);
  patchSlice('registry', next);
}

/**
 * A save the move cannot go on without (gate F4): it reached storage and
 * reads back as `holds` says, or it throws before the screen changes.
 */
function saveRegOrThrow(next: WorldsRegistry, worldId: string, holds: (stored: WorldRegistryEntry | undefined) => boolean): void {
  if (!saveRegistry(next)) throw new PlainError(REGISTRY_NOT_SAVED);
  let ok = false;
  try { ok = holds(storedRegistry().worlds.find(w => w.id === worldId)); } catch { ok = false; }
  if (!ok) throw new PlainError(REGISTRY_NOT_SAVED);
  patchSlice('registry', next);
}

function entryOf(worldId: string): WorldRegistryEntry | undefined {
  return getState().registry.worlds.find(w => w.id === worldId);
}

/** `<slug>-<id8>`, or the first free `-N`: never into a folder that exists. */
async function freeFolderName(home: FileSystemDirectoryHandle, name: string, worldId: string): Promise<string> {
  const base = `${slugify(name) || 'world'}-${worldId.slice(0, 8)}`;
  for (let n = 1; n <= 20; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    try {
      await home.getDirectoryHandle(candidate);
    } catch (err) {
      if (isGoneError(err)) return candidate;
      throw err;
    }
  }
  throw new PlainError('Your OnlyWorlds folder already holds many folders with this world\'s name. Move or remove old copies there, then try again.');
}

/** Does the folder carry this move's token? */
async function tokenIs(dir: FileSystemDirectoryHandle, moveId: string): Promise<boolean> {
  try {
    const text = await (await (await (await dir.getDirectoryHandle(ATLAS_INTERNAL_DIR)).getFileHandle(MOVE_INCOMING_FILE)).getFile()).text();
    return (JSON.parse(text) as { move_id?: unknown }).move_id === moveId;
  } catch {
    return false;
  }
}

const REMOVE_RETRY_MS = [100, 250, 500, 1000];

/**
 * Remove a destination folder ONLY when it is this move's: it carries the
 * move's token, or it holds no file but the token's own path (a refused write
 * leaves a 0-byte file behind: measured, both engines, gate M5). Any other
 * folder is someone's world and is never touched (gate A1). A busy refusal
 * (OneDrive, antivirus) is retried. Answers whether the folder is gone.
 */
async function removeOwnDestination(home: FileSystemDirectoryHandle, name: string, moveId: string): Promise<boolean> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await home.getDirectoryHandle(name);
  } catch (err) {
    if (isGoneError(err)) return true;
    throw err;
  }
  const ours = await tokenIs(dir, moveId) || await holdsOnly(dir, `${ATLAS_INTERNAL_DIR}/${MOVE_INCOMING_FILE}`);
  if (!ours) return false;
  for (let attempt = 0; ; attempt++) {
    try {
      await home.removeEntry(name, { recursive: true });
      return true;
    } catch (err) {
      if (isGoneError(err)) return true;
      if (attempt >= REMOVE_RETRY_MS.length) throw err;
      await new Promise(r => setTimeout(r, REMOVE_RETRY_MS[attempt]));
    }
  }
}

/** Does `dir` hold no file at all, or none but `onlyPath`? Transient files count: nothing is skipped here. */
async function holdsOnly(dir: FileSystemDirectoryHandle, onlyPath: string): Promise<boolean> {
  const walk = async (d: FileSystemDirectoryHandle, prefix: string): Promise<boolean> => {
    for await (const [name, h] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (h.kind === 'directory') { if (!(await walk(h as FileSystemDirectoryHandle, path))) return false; }
      else if (path !== onlyPath) return false;
    }
    return true;
  };
  return walk(dir, '');
}

/**
 * Move the OPEN browser world to a folder in the home folder. Refusals throw
 * a `PlainError` before anything changes; a move that started and failed
 * answers `{ ok: false }` with everything put back.
 */
export async function moveBrowserWorldToFolder(world: WorldRegistryEntry, opts: MoveOpts): Promise<MoveOutcome> {
  if (!isBrowserWorld(world)) throw new Error('moveBrowserWorldToFolder: not a browser world'); // raw-error-ok: a programming guard, never shown
  if (world.demo === true) throw new PlainError('The tour world can be moved once you keep it at the end of the tour.');
  if (getState().active?.worldId !== world.id) throw new PlainError('Open this world first, then move it.');
  if (isRekeyRunning()) throw new PlainError('Wait for the id update to finish, then move the world.');
  const dir = world.folder.folder_name;
  return withIdMoveLock(() => enqueueActivationTask(() => withWorldLock(dir, async () => {
    movingHere.add(world.id);
    try {
      return await runMove(world.id, dir, opts);
    } finally {
      movingHere.delete(world.id);
    }
  })));
}

async function runMove(worldId: string, lockedDir: string, opts: MoveOpts): Promise<MoveOutcome> {
  const { home } = opts;
  const first = entryOf(worldId);
  const source = getActiveStore();
  const meta = getState().active?.meta;
  if (!first || !isBrowserWorld(first) || first.folder.folder_name !== lockedDir || !source || getState().active?.worldId !== worldId || !meta) {
    throw new PlainError('Open this world first, then move it.');
  }
  if (await source.hasRekeyJournal()) {
    throw new PlainError('An id update in this world did not finish. Finish it in Settings, under This world, then move the world.');
  }
  // An earlier move that never committed: its folder goes first (this click
  // has the home folder's permission and this run holds the world's lock),
  // its journal with it (gate F5). One that cannot go yet stops this move.
  if (first.move) {
    await recoverUnlocked(worldId, { home, self: true });
    const left = entryOf(worldId)?.move;
    if (left) {
      throw new PlainError(`An earlier move left the folder "${left.to_folder_name}" in your OnlyWorlds folder, and Atlas could not remove it. Close any program using it, then try again.`);
    }
  }
  const start = entryOf(worldId)!;

  const fromDir = start.folder.folder_name;
  const toDir = await freeFolderName(home, start.name, String(meta.id ?? worldId));
  const move = { move_id: crypto.randomUUID(), to_folder_name: toDir, started_at: new Date().toISOString() };
  // 2. The journal, before the folder exists on the drive (gate B26), and it
  // must have landed (gate F4).
  saveRegOrThrow(updateWorldEntry(getState().registry, worldId, { move }), worldId, s => s?.move?.move_id === move.move_id);

  // 3. Quiesce, keeping the lock.
  await flushBeforeLeavingWorld();
  const engine = getCurrentSyncWorldId() === worldId ? getCurrentSyncEngine() : null;
  const release = engine ? await engine.hold('move') : () => {};
  let dest: FileSystemDirectoryHandle | null = null;
  let destStore: FsFolderStore | null = null;
  let vaultPut = false;
  let committed: WorldRegistryEntry | null = null;
  try {
    await source.awaitTidies();
    await source.beginMove();
    // 4. Copy into a folder that was empty, then verify.
    const src = await deriveBrowserWorldHandle(start);
    const made = await home.getDirectoryHandle(toDir, { create: true });
    if (!(await holdsOnly(made, ''))) {
      // Someone made a folder of that name since it was found free (gate
      // F10): never write into it, and never remove it.
      throw new PlainError(`A folder named "${toDir}" appeared in your OnlyWorlds folder while moving. Nothing was moved; try again.`);
    }
    dest = made;
    await copyWorldTree(src, dest, { moveId: move.move_id, onProgress: opts.onProgress });
    const check = await verifyWorldTree(src, dest);
    if (!check.ok) throw new PlainError(`The copy in the folder did not match the world. Try again.`);
    if (!(await tokenIs(dest, move.move_id))) throw new PlainError('The copy in the folder changed while moving. Try again.');
    // 5a. The destination's own store, claiming its lock (gate A10).
    destStore = new FsFolderStore();
    await destStore.open(dest);
    // 5b. Its handle, under the world's own key (gate A8: never a rebuilt key).
    await storeHandle(start.folder.handle_key, dest);
    vaultPut = true;
    // 5c. The commit: one registry save that must land.
    const cur = entryOf(worldId)!;
    const next = updateWorldEntry(getState().registry, worldId, {
      where: undefined,
      cleared_at: undefined,
      move: undefined,
      moved_from: fromDir,
      folder: { ...cur.folder, folder_name: toDir, last_path_hint: `${opts.homeHint}/${toDir}` },
    });
    saveRegOrThrow(next, worldId, s => !!s && s.where === undefined && s.folder.folder_name === toDir && s.moved_from === fromDir);
    committed = entryOf(worldId)!;
  } catch (error) {
    // A failure before the commit: everything back as it was.
    if (destStore) await destStore.close().catch(() => {});
    let destGone = true;
    if (dest) {
      destGone = await removeOwnDestination(home, toDir, move.move_id).catch(err => {
        console.warn('[atlas:move] could not remove the unfinished folder', err); // raw-error-ok: a console record
        return false;
      });
    }
    if (vaultPut) await deleteHandle(start.folder.handle_key).catch(() => {});
    // The journal goes only with the folder it names (gate F6): one left on
    // the drive stays recorded, and recovery removes it later.
    if (destGone && entryOf(worldId)?.move?.move_id === move.move_id) saveReg(updateWorldEntry(getState().registry, worldId, { move: undefined }));
    await source.endMove().catch(() => {});
    release();
    return { ok: false, error };
  }

  // 6. The token goes; the world's store and sync are the folder's from here.
  try {
    await (await dest!.getDirectoryHandle(ATLAS_INTERNAL_DIR)).removeEntry(MOVE_INCOMING_FILE);
  } catch { /* a token left in a committed folder names this move only: nothing acts on it */ }
  setActiveStore(destStore);
  // What waits to upload is the user's own editing in the browser, never
  // "files changed on disk" (gate F7).
  if (committed.state === 'api-linked') attachSyncEngine(committed, destStore!, { justMoved: true });
  release();

  // 7. The browser copy goes, then its record. A failure leaves `moved_from`:
  // the next boot or open finishes it. The world's Web Lock is still held.
  await source.close().catch(() => {});
  evictParkedStore(worldId);
  await awaitEviction(worldId);
  let leftBrowserCopy = false;
  try {
    await removeBrowserWorldDir({ where: 'browser', folder: { handle_key: '', folder_name: fromDir } });
    if (entryOf(worldId)?.moved_from === fromDir) saveReg(updateWorldEntry(getState().registry, worldId, { moved_from: undefined }));
  } catch (err) {
    leftBrowserCopy = true;
    console.warn('[atlas:move] the browser copy stays until the next start', err); // raw-error-ok: a console record
  }
  return { ok: true, folderName: toDir, pathHint: `${opts.homeHint}/${toDir}`, leftBrowserCopy };
}

// ---- recovery ----

export type MoveRecovery = 'none' | 'undone' | 'finished' | 'waiting';

const recovering = new Map<string, Promise<MoveRecovery>>();

/**
 * Finish what a crashed move left (contract §4.3), single-flight per world,
 * inside the world's Web Lock: a move live in any tab holds it, so recovery
 * waits ('waiting') instead of acting on a move in progress (gate F1). Before
 * the commit (`move` on a browser world): the destination goes only when it
 * is this move's, then the journal; the browser copy is the world. Without
 * the home folder's permission (no gesture at boot) it waits too; the next
 * Move click resolves it. After the commit (`moved_from` on a folder world):
 * the browser directory the commit named goes, then the record.
 */
export function recoverBrowserMove(worldId: string, opts: { home?: FileSystemDirectoryHandle } = {}): Promise<MoveRecovery> {
  const running = recovering.get(worldId);
  if (running) return running;
  const p = (async (): Promise<MoveRecovery> => {
    if (movingHere.has(worldId)) return 'waiting';
    const entry = entryOf(worldId);
    const dir = entry?.move && isBrowserWorld(entry) ? entry.folder.folder_name : entry?.moved_from;
    if (!entry || !dir) return 'none';
    const r = await ifWorldLockFree(dir, () => recoverUnlocked(worldId, opts));
    return r.ran ? r.value : 'waiting';
  })().finally(() => { recovering.delete(worldId); });
  recovering.set(worldId, p);
  return p;
}

/** Recovery's work, the world's Web Lock already held (by recovery, or by the move itself: `self`). */
async function recoverUnlocked(worldId: string, opts: { home?: FileSystemDirectoryHandle; self?: boolean }): Promise<MoveRecovery> {
  const entry = entryOf(worldId);
  if (!entry) return 'none';
  if (entry.move && isBrowserWorld(entry)) {
    if (!opts.self && await sourceMovingElsewhere(entry)) return 'waiting';
    const home = opts.home ?? await loadHandle(ATLAS_ROOT_HANDLE_KEY).catch(() => undefined);
    if (!home || !(opts.home || await queryWritable(home).catch(() => false))) return 'waiting';
    const { move } = entry;
    let gone: boolean;
    try {
      gone = await removeOwnDestination(home, move.to_folder_name, move.move_id);
    } catch (err) {
      console.warn('[atlas:move] the unfinished folder could not be removed yet', err); // raw-error-ok: a console record
      return 'waiting';
    }
    if (!gone) {
      // A folder by that name that is not this move's: someone's world, left
      // alone. The journal has nothing left to name.
      console.warn('[atlas:move] a folder with the moved world\'s name is not this move\'s: left alone', move.to_folder_name); // raw-error-ok: a console record
    }
    if (entryOf(worldId)?.move?.move_id === move.move_id) saveReg(updateWorldEntry(getState().registry, worldId, { move: undefined }));
    return 'undone';
  }
  if (entry.moved_from && !isBrowserWorld(entry)) {
    const fromDir = entry.moved_from;
    await removeBrowserWorldDir({ where: 'browser', folder: { handle_key: '', folder_name: fromDir } });
    if (entryOf(worldId)?.moved_from === fromDir) saveReg(updateWorldEntry(getState().registry, worldId, { moved_from: undefined }));
    return 'finished';
  }
  return 'none';
}

/**
 * Is another tab moving this world right now (its source lock fresh, marked
 * moving, not ours)? A lock that cannot be read answers yes: recovery waits
 * rather than act on a guess (gate F1, fail closed). No lock at all is no.
 */
async function sourceMovingElsewhere(entry: WorldRegistryEntry): Promise<boolean> {
  try {
    const dir = await deriveBrowserWorldHandle(entry);
    const text = await (await (await (await dir.getDirectoryHandle(ATLAS_INTERNAL_DIR)).getFileHandle('lock')).getFile()).text();
    const lock = JSON.parse(text) as { tab_id?: unknown; last_heartbeat?: unknown; moving?: unknown };
    const beat = Date.parse(String(lock.last_heartbeat));
    return lock.moving === true && lock.tab_id !== currentTabId() && Number.isFinite(beat) && Date.now() - beat < LOCK_STALE_MS;
  } catch (err) {
    return !isGoneError(err);
  }
}
