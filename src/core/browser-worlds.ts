/**
 * Worlds in this browser's storage (1.17, DESIGN_LAWS conv. 129).
 *
 * A browser world is a folder of files like any other world; it lives in the
 * origin-private file system (OPFS) under ONE directory, `browser-worlds/`,
 * and its registry entry says `where: 'browser'`. Its handle is DERIVED from
 * that path every time (`worldHandleFor`), never kept in the handle vault:
 * OPFS needs no permission, and a path cannot go stale the way a stored
 * handle can (OPFS handles are path-based: a held one sees a re-created
 * same-name directory, measured S370 gate lens B M2).
 *
 * Gone = `NotFoundError` on the derive, and nothing else (measured in
 * Chromium 148 and Firefox 150; Firefox's `UnknownError` comes only from a
 * stale handle's create and is a problem, not a cleared world).
 *
 * Contract: `Forge/Notes/2026-10-04-browser-worlds-contract.md` §1.
 */

import type { WorldRegistryEntry, WorldsRegistry } from './types';
import { updateWorldEntry } from '../registry/registry';
import { loadHandle } from '../store/handle-vault';

/** The one OPFS directory every browser world lives in. */
export const BROWSER_HOME = 'browser-worlds';

/** Does this world live in this browser's storage? The ONE predicate. */
export function isBrowserWorld(entry: Pick<WorldRegistryEntry, 'where'> | null | undefined): boolean {
  return entry?.where === 'browser';
}

/**
 * Is this world Atlas-only storage, for the readers that care where the files
 * can be reached from (the live folder's rescans, the AI-folder line)? A
 * browser world, or the tour sandbox: a 1.16 tour entry has no `where` and
 * sits at the OPFS root, and must stay covered (S370 gate B14).
 */
export function isAtlasOnlyStorage(entry: Pick<WorldRegistryEntry, 'where' | 'demo'> | null | undefined): boolean {
  return isBrowserWorld(entry) || entry?.demo === true;
}

/** Where a world's files are, as the copy says it: this browser, or a folder (the default). */
export type FilesWhere = 'folder' | 'browser';

export function filesWhereOf(entry: Pick<WorldRegistryEntry, 'where' | 'demo'> | null | undefined): FilesWhere {
  return isAtlasOnlyStorage(entry) ? 'browser' : 'folder';
}

type RootGetter = () => Promise<FileSystemDirectoryHandle>;
let rootGetter: RootGetter = () => navigator.storage.getDirectory();

/** Tests point the OPFS root at a fake file system. */
export function setOpfsRootForTests(get: RootGetter | null): void {
  rootGetter = get ?? (() => navigator.storage.getDirectory());
}

export function opfsRoot(): Promise<FileSystemDirectoryHandle> {
  return rootGetter();
}

/** The browser home. `create: false` throws NotFoundError when none exists yet. */
export async function browserHome(opts: { create?: boolean } = {}): Promise<FileSystemDirectoryHandle> {
  const root = await rootGetter();
  return root.getDirectoryHandle(BROWSER_HOME, { create: opts.create === true });
}

/** A browser world's directory, derived from its registry entry. Throws NotFoundError when gone. */
export async function deriveBrowserWorldHandle(
  entry: Pick<WorldRegistryEntry, 'folder'>,
): Promise<FileSystemDirectoryHandle> {
  const home = await browserHome();
  return home.getDirectoryHandle(entry.folder.folder_name, { create: false });
}

export function isGoneError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === 'NotFoundError';
}

export type WorldHandleResult =
  | { kind: 'ok'; handle: FileSystemDirectoryHandle }
  /** A browser world whose directory the browser no longer holds. */
  | { kind: 'gone' }
  /** A folder world whose vault handle is missing (the files may be fine). */
  | { kind: 'lost' };

/**
 * The world's directory handle: derived for a browser world, from the vault
 * for a folder world. Errors other than "gone" are thrown for the caller to
 * word (`showProblem`).
 */
export async function worldHandleFor(entry: WorldRegistryEntry): Promise<WorldHandleResult> {
  if (isBrowserWorld(entry)) {
    try {
      return { kind: 'ok', handle: await deriveBrowserWorldHandle(entry) };
    } catch (err) {
      if (isGoneError(err)) return { kind: 'gone' };
      throw err;
    }
  }
  const handle = await loadHandle(entry.folder.handle_key);
  return handle ? { kind: 'ok', handle } : { kind: 'lost' };
}

const REMOVE_RETRY_MS = [100, 250, 500, 1000];

/**
 * Remove a browser world's directory (contract §1.2). Only the directory the
 * entry names, and only once `resolve()` places it exactly one level under
 * the browser home: never chosen by name, prefix or listing. The caller has
 * closed the world's store and evicted any parked one first; a writable still
 * open anywhere inside makes the removal fail WHOLE (measured, both engines),
 * so a busy refusal is retried, then reported. A directory already gone
 * counts as removed.
 */
export async function removeBrowserWorldDir(
  entry: Pick<WorldRegistryEntry, 'folder' | 'where'>,
  wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<void> {
  if (!isBrowserWorld(entry)) throw new Error('removeBrowserWorldDir: not a browser world'); // raw-error-ok: a programming guard, never shown
  let home: FileSystemDirectoryHandle;
  let dir: FileSystemDirectoryHandle;
  try {
    home = await browserHome();
    dir = await home.getDirectoryHandle(entry.folder.folder_name, { create: false });
  } catch (err) {
    if (isGoneError(err)) return;
    throw err;
  }
  const path = await home.resolve(dir);
  if (!path || path.length !== 1 || path[0] !== entry.folder.folder_name) {
    throw new Error('removeBrowserWorldDir: the directory is not where the entry says'); // raw-error-ok: a programming guard
  }
  for (let attempt = 0; ; attempt++) {
    try {
      await home.removeEntry(entry.folder.folder_name, { recursive: true });
      return;
    } catch (err) {
      if (isGoneError(err)) return;
      const busy = (err as { name?: string })?.name === 'NoModificationAllowedError';
      if (!busy || attempt >= REMOVE_RETRY_MS.length) throw err;
      await wait(REMOVE_RETRY_MS[attempt]);
    }
  }
}

/** Mark a browser world as cleared by the browser. Pure; the caller saves. */
export function markWorldCleared(reg: WorldsRegistry, worldId: string, at = new Date().toISOString()): WorldsRegistry {
  return updateWorldEntry(reg, worldId, { cleared_at: at });
}

/** Clear the mark (its directory is back, or a restore finished). Pure. */
export function unmarkWorldCleared(reg: WorldsRegistry, worldId: string): WorldsRegistry {
  return updateWorldEntry(reg, worldId, { cleared_at: undefined });
}
